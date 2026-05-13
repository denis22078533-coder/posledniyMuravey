import { getSettings, setSettings, getActiveProviderConfig } from "./store";
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

  let working: ChatMessage[] = [...history];
  let currentFiles: ProjectFiles = opts.files ? { ...opts.files } : {};
  const hasFiles = Object.keys(currentFiles).length > 0;
  let hop = 0;

  while (true) {
    onProgress?.({ stage: "thinking" });
    const text = await callLlmOnce(working, s.ai.systemPrompt);

    // 1) WRITE: применяем сразу (даже если есть и READ) — это терминальное действие
    const writes = hasFiles ? extractWriteCommands(text) : [];
    if (writes.length > 0 && hop < MAX_HOPS) {
      const applied: string[] = [];
      for (const w of writes) {
        currentFiles = writeFileByPath(currentFiles, w.path, w.content);
        applied.push(w.path);
      }
      onProgress?.({ stage: "writing", paths: applied });
      opts.onFilesChange?.(currentFiles);
      if (onDelta) onDelta(text);
      setSettings((cur) => ({ ...cur, tokens: Math.max(0, cur.tokens - 1) }));
      return text;
    }

    // 2) READ: подгружаем содержимое файлов и продолжаем диалог
    const reads = hasFiles ? extractReadCommands(text) : [];
    if (reads.length > 0 && hop < MAX_HOPS) {
      onProgress?.({ stage: "reading", paths: reads });
      const chunks: string[] = [];
      for (const p of reads) {
        const f = readFileByPath(currentFiles, p);
        if (f) chunks.push(`--- ${f.path} (${f.content.length} b) ---\n${f.content.slice(0, 8000)}`);
        else chunks.push(`--- ${p} ---\n[файл не найден в проекте]`);
      }
      working = [
        ...working,
        { role: "assistant", content: text },
        { role: "user", content: `[Содержимое запрошенных файлов]\n\n${chunks.join("\n\n")}\n\nПродолжай выполнение задачи. Когда готов внести правки — используй формат:\nWRITE: путь/к/файлу.ext\n\`\`\`\nновое содержимое\n\`\`\`` },
      ];
      hop += 1;
      continue;
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
