import { getSettings } from "./store";

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type SearchEngine = "duckduckgo" | "yandex" | "auto";

const PUBLIC_CORS_PROXIES = [
  (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u: string) => `https://cors.eu.org/${u}`,
];

async function fetchWithProxies(target: string): Promise<Response> {
  const userProxy = getSettings().github.proxy?.trim();
  const urls: string[] = [];
  if (userProxy) {
    if (userProxy.includes("{url}")) urls.push(userProxy.replace("{url}", encodeURIComponent(target)));
    else if (/[?=&]$/.test(userProxy)) urls.push(`${userProxy}${encodeURIComponent(target)}`);
    else urls.push(`${userProxy.replace(/\/+$/, "")}/${target}`);
  }
  // direct first (might fail by CORS for HTML endpoints)
  urls.push(target);
  for (const fn of PUBLIC_CORS_PROXIES) urls.push(fn(target));

  let lastErr: Error | null = null;
  for (const u of urls) {
    try {
      const res = await fetch(u);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr || new Error("Сеть: все прокси не ответили");
}

// ─── DuckDuckGo ───────────────────────────────────────────────────────────────
// Источники: Instant Answer API (json, без ключей) + HTML-фолбэк через прокси
export async function searchDuckDuckGo(query: string, limit = 5): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  // 1) Instant Answer — даёт быстрые ответы, но не всегда есть веб-результаты
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetchWithProxies(url);
    const data = await res.json();
    const out: SearchResult[] = [];
    if (data?.AbstractText && data?.AbstractURL) {
      out.push({ title: data.Heading || q, url: data.AbstractURL, snippet: data.AbstractText });
    }
    const related: Array<{ Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }> = data?.RelatedTopics || [];
    for (const r of related) {
      if (out.length >= limit) break;
      if (r.Topics) {
        for (const t of r.Topics) {
          if (out.length >= limit) break;
          if (t.FirstURL && t.Text) out.push({ title: t.Text.slice(0, 90), url: t.FirstURL, snippet: t.Text });
        }
      } else if (r.FirstURL && r.Text) {
        out.push({ title: r.Text.slice(0, 90), url: r.FirstURL, snippet: r.Text });
      }
    }
    if (out.length > 0) return out.slice(0, limit);
  } catch {/* fall through to HTML */}

  // 2) HTML-страница DuckDuckGo — парсим результаты
  try {
    const htmlUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const res = await fetchWithProxies(htmlUrl);
    const html = await res.text();
    return parseDuckDuckGoHtml(html, limit);
  } catch (e) {
    throw new Error(`DuckDuckGo недоступен: ${e instanceof Error ? e.message : "сеть"}`);
  }
}

function parseDuckDuckGoHtml(html: string, limit: number): SearchResult[] {
  const out: SearchResult[] = [];
  // Result block: <a class="result__a" href="...">Title</a> ... <a class="result__snippet" ...>Snippet</a>
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < limit) {
    const rawUrl = decodeURIComponent(m[1].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, "").split("&")[0]);
    const title = stripTags(m[2]).trim();
    const snippet = stripTags(m[3]).trim();
    if (title && rawUrl.startsWith("http")) {
      out.push({ title, url: rawUrl, snippet });
    }
  }
  return out;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

// ─── Yandex Search API ────────────────────────────────────────────────────────
// Документация: https://yandex.cloud/ru/docs/search-api/
export async function searchYandex(query: string, limit = 5): Promise<SearchResult[]> {
  const s = getSettings().ai.search;
  if (!s.yandexApiKey) throw new Error("Yandex Search: не задан API Key");
  if (!s.yandexFolderId) throw new Error("Yandex Search: не задан Folder ID");

  const body = {
    query: { searchType: "SEARCH_TYPE_RU", queryText: query, familyMode: "FAMILY_MODE_MODERATE", page: "0" },
    sortSpec: { sortMode: "SORT_MODE_BY_RELEVANCE" },
    groupSpec: { groupMode: "GROUP_MODE_FLAT", groupsOnPage: String(limit), docsInGroup: "1" },
    folderId: s.yandexFolderId,
    responseFormat: "FORMAT_XML",
  };

  const url = "https://searchapi.api.cloud.yandex.net/v2/web/searchAsync";
  const start = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Api-Key ${s.yandexApiKey}` },
    body: JSON.stringify(body),
  });
  if (!start.ok) throw new Error(`Yandex Search ${start.status}: ${(await start.text()).slice(0, 200)}`);
  const op = await start.json();
  const opId = op?.id;
  if (!opId) throw new Error("Yandex Search: пустой operation id");

  // Опрашиваем операцию
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const r = await fetch(`https://operation.api.cloud.yandex.net/operations/${opId}`, {
      headers: { Authorization: `Api-Key ${s.yandexApiKey}` },
    });
    const st = await r.json();
    if (st?.error) throw new Error(`Yandex Search: ${st.error.message || "сбой"}`);
    if (st?.done) {
      // Ответ приходит base64 XML
      const b64 = st?.response?.rawData;
      if (!b64) return [];
      const xml = atobUtf8(b64);
      return parseYandexXml(xml, limit);
    }
  }
  throw new Error("Yandex Search: таймаут");
}

function atobUtf8(b64: string): string {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

function parseYandexXml(xml: string, limit: number): SearchResult[] {
  const out: SearchResult[] = [];
  const re = /<doc[\s\S]*?<url>([\s\S]*?)<\/url>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<passages>([\s\S]*?)<\/passages>[\s\S]*?<\/doc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && out.length < limit) {
    const url = stripTags(m[1]).trim();
    const title = stripTags(m[2]).trim();
    const snippet = stripTags(m[3]).trim().slice(0, 240);
    if (url && title) out.push({ title, url, snippet });
  }
  return out;
}

// ─── Универсальный поиск ──────────────────────────────────────────────────────
export async function searchWeb(query: string, limit = 5): Promise<{ engine: string; results: SearchResult[] }> {
  const s = getSettings().ai.search;
  if (!s.enabled) throw new Error("Поиск в сети выключен в настройках («Мозг → ИИ → Поиск»)");

  const want = s.engine;
  // Yandex если выбран и настроен
  if (want === "yandex") {
    const r = await searchYandex(query, limit);
    return { engine: "Yandex", results: r };
  }
  // Auto: пробуем Yandex (если ключи), иначе DDG
  if (want === "auto" && s.yandexApiKey && s.yandexFolderId) {
    try {
      const r = await searchYandex(query, limit);
      if (r.length) return { engine: "Yandex", results: r };
    } catch {/* fall to DDG */}
  }
  const r = await searchDuckDuckGo(query, limit);
  return { engine: "DuckDuckGo", results: r };
}

// Форматирование результатов в plain text для LLM
export function formatResultsForLlm(query: string, engine: string, results: SearchResult[]): string {
  if (results.length === 0) return `[Поиск "${query}" через ${engine}] — ничего не найдено`;
  const lines = results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`);
  return `[Поиск "${query}" через ${engine}, ${results.length} результат(а)]\n\n${lines.join("\n\n")}`;
}

// Извлекает команду SEARCH:<query> из ответа LLM. Поддерживает несколько форматов:
// SEARCH: react 19 release notes
// [SEARCH] react 19 release notes
// 🔎 SEARCH: react 19
export function extractSearchCommand(text: string): string | null {
  const m = text.match(/(?:^|\n)\s*(?:🔎\s*)?\[?SEARCH\]?:\s*(.+?)(?:\n|$)/i);
  if (m) return m[1].trim().slice(0, 200);
  return null;
}

// READ: <path>
export function extractReadCommands(text: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:📖\s*)?\[?READ\]?:\s*(.+?)(?:\n|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const p = m[1].trim().replace(/[`"']/g, "").slice(0, 300);
    if (p) out.push(p);
  }
  return out;
}

// WRITE: <path>\n```...content...```
export function extractWriteCommands(text: string): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];
  const re = /(?:^|\n)\s*(?:💉\s*)?\[?(?:WRITE|EDIT)\]?:\s*([^\n`]+)\s*\n+```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const path = m[1].trim().replace(/[`"']/g, "");
    const content = m[2];
    if (path) out.push({ path, content });
  }
  return out;
}