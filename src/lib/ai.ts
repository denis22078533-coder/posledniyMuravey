
import { getSettings, setSettings, getActiveProviderConfig } from "./store";
import { getCurrentAccount } from "./auth"; // Используем правильную функцию
import { extractSearchCommand, searchWeb, formatResultsForLlm, extractReadCommands, extractWriteCommands } from "./search";
import { readFileByPath, writeFileByPath, type ProjectFiles } from "./files";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export function extractHtml(text: string): string | null {
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const lower = text.toLowerCase();
  if (lower.includes("<!doctype") || lower.includes("<html")) return text.trim();
  return null;
}

async function nativeFs(operation: "read" | "write", path: string, content?: string): Promise<string | null> {
  // Проверка прав ПЕРЕД отправкой запроса на сервер
  const account = getCurrentAccount();
  const settings = getSettings();
  if (!settings.system.selfEdit || !account || account.role !== "superadmin") {
    throw new Error("Доступ к редактированию файлов платформы запрещён.");
  }

  const remoteUrl = settings.regru.serverUrl;
  const url = remoteUrl ? `${remoteUrl}/api/fs` : "/api/fs";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation, path, content }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`API error ${res.status}: ${errText}`);
    }
    if (operation === "read") {
      const { content } = await res.json();
      return content;
    }
    return null;
  } catch (e) {
    console.error(`[Native FS Error] ${operation} ${path}:`, e);
    throw e;
  }
}

export async function callLlmOnce(history: ChatMessage[], systemPromptOverride?: string): Promise<string> {
  const s = getSettings();
  const cfg = getActiveProviderConfig(s);
  const { provider, apiKey, baseUrl, model } = cfg;
  const { temperature, systemPrompt } = s.ai;

  if (!apiKey) throw new Error(`Не задан API-ключ для ${provider}. Откройте «Мозг → ИИ» и введите ключ.`);
  if (!baseUrl) throw new Error(`Не задан Base URL для ${provider}. Откройте «Мозг → ИИ».`);

  const finalSystemPrompt = systemPromptOverride ?? systemPrompt;

  const base = baseUrl.replace(/\/+$/, "");
  const isAnthropic = provider === "Claude";
  const url = isAnthropic ? `${base}/messages` : `${base}/chat/completions`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (isAnthropic) {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  } else {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const messages: ChatMessage[] = isAnthropic ? history : [{ role: "system", content: finalSystemPrompt }, ...history];

  const body: Record<string, unknown> = isAnthropic
    ? { model, max_tokens: 4096, temperature: parseFloat(temperature) || 0.7, system: finalSystemPrompt, messages: history }
    : { model, temperature: parseFloat(temperature) || 0.7, messages, stream: false };

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Ошибка ${provider} ${res.status}: ${errText.slice(0, 200) || res.statusText}`);
  }
  const data = await res.json();
  if (isAnthropic) return data?.content?.[0]?.text || "";
  return data?.choices?.[0]?.message?.content || "";
}

export type ChatProgress =
  | { stage: "thinking" }
  | { stage: "searching"; note: string }
  | { stage: "reading"; paths: string[] }
  | { stage: "writing"; paths: string[] }
  | { stage: "done" };

export type ChatOpts = {
  files?: ProjectFiles;
  onFilesChange?: (next: ProjectFiles) => void;
};

const MAX_HOPS = 6;

export async function chat(
  history: ChatMessage[],
  onDelta?: (delta: string) => void,
  onProgress?: (p: ChatProgress) => void,
  opts: ChatOpts = {},
): Promise<string> {
  const s = getSettings();
  const searchEnabled = s.ai.search.enabled && s.ai.search.autoMode;
  const selfEditMode = s.system.selfEdit;

  let working: ChatMessage[] = [...history];
  let currentFiles: ProjectFiles = opts.files ? { ...opts.files } : {};
  const hasFiles = Object.keys(currentFiles).length > 0;
  let hop = 0;

  while (true) {
    onProgress?.({ stage: "thinking" });
    const text = await callLlmOnce(working, s.ai.systemPrompt);

    // 1) WRITE: применяем сразу
    const writes = extractWriteCommands(text);
    if (writes.length > 0 && hop < MAX_HOPS) {
      const applied: string[] = [];
      try {
        if (selfEditMode) {
          for (const w of writes) {
            await nativeFs("write", w.path, w.content);
            applied.push(w.path);
          }
        } else if (hasFiles) {
          for (const w of writes) {
            currentFiles = writeFileByPath(currentFiles, w.path, w.content);
            applied.push(w.path);
          }
          opts.onFilesChange?.(currentFiles);
        }
        if (applied.length > 0) onProgress?.({ stage: "writing", paths: applied });
        if (onDelta) onDelta(text);
        setSettings((cur) => ({ ...cur, tokens: Math.max(0, cur.tokens - 1) }));
        return text; // Терминальное действие
      } catch (e: any) {
        console.error("WRITE error", e);
        working.push({ role: "assistant", content: text });
        working.push({ role: "user", content: `[SYSTEM] Ошибка при записи файла: ${e.message}. Сообщи пользователю.` });
        hop += 1;
        continue;
      }
    }

    // 2) READ: подгружаем содержимое и продолжаем
    const reads = extractReadCommands(text);
    if (reads.length > 0 && hop < MAX_HOPS) {
      onProgress?.({ stage: "reading", paths: reads });
      const chunks: string[] = [];
      try {
        if (selfEditMode) {
          for (const p of reads) {
            const content = await nativeFs("read", p);
            chunks.push(`--- ${p} ---\n${content !== null ? content.slice(0, 8000) : "[не удалось прочитать]"}`);
          }
        } else if (hasFiles) {
          for (const p of reads) {
            const f = readFileByPath(currentFiles, p);
            chunks.push(`--- ${p} ---\n${f ? f.content.slice(0, 8000) : "[файл не найден в проекте]"}`);
          }
        } else {
          chunks.push("[Чтение не активно, т.к. нет файлов в проекте и выключен self-edit режим]")
        }

        working.push({ role: "assistant", content: text });
        working.push({ role: "user", content: `[Содержимое запрошенных файлов]\n\n${chunks.join("\n\n")}\n\nПродолжай. Для правок — WRITE.` });
        hop += 1;
        continue;
      } catch (e: any) {
        console.error("READ error", e);
        working.push({ role: "assistant", content: text });
        working.push({ role: "user", content: `[SYSTEM] Ошибка при чтении файла: ${e.message}. Сообщи пользователю.` });
        hop += 1;
        continue;
      }
    }

    // 3) SEARCH: интернет
    const searchQ = searchEnabled && hop < MAX_HOPS ? extractSearchCommand(text) : null;
    if (searchQ) {
      onProgress?.({ stage: "searching", note: searchQ });
      let toolMsg = "";
      try {
        const { engine, results } = await searchWeb(searchQ, 5);
        toolMsg = formatResultsForLlm(searchQ, engine, results);
      } catch (e) {
        toolMsg = `[Поиск "${searchQ}"] — ошибка: ${e instanceof Error ? e.message : "сеть"}. Отвечай по своим знаниям.`;
      }
      working = [
        ...working,
        { role: "assistant", content: text },
        { role: "user", content: toolMsg + "\n\nИспользуй найденную информацию. Больше команд SEARCH: не вызывай." },
      ];
      hop += 1;
      continue;
    }

    // 4) Финал
    onProgress?.({ stage: "done" });
    if (onDelta) onDelta(text);
    setSettings((cur) => ({ ...cur, tokens: Math.max(0, cur.tokens - 1) }));
    return text;
  }
}
