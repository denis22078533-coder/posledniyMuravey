import { getSettings } from "./store";
import type { ProjectFiles } from "./files";

const PROXY_FALLBACKS = [
  (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u: string) => `https://cors.eu.org/${u}`,
];

function applyCustomProxy(proxy: string, target: string): string {
  const p = proxy.trim();
  // Шаблон с {url} — заменим
  if (p.includes("{url}")) return p.replace("{url}", encodeURIComponent(target));
  // Шаблон вида corsproxy.io/?... → дописываем urlencoded
  if (p.endsWith("?") || p.endsWith("=") || p.endsWith("&")) return `${p}${encodeURIComponent(target)}`;
  // По умолчанию — конкатенация со слэшем
  return `${p.replace(/\/+$/, "")}/${target}`;
}

function buildUrl(path: string, customProxy?: string): { url: string; mode: "direct" | "proxy"; tryNext?: (i: number) => string | null } {
  const base = `https://api.github.com${path}`;
  if (customProxy && customProxy.trim()) {
    return { url: applyCustomProxy(customProxy, base), mode: "proxy" };
  }
  return {
    url: base,
    mode: "direct",
    tryNext: (i: number) => (i < PROXY_FALLBACKS.length ? PROXY_FALLBACKS[i](base) : null),
  };
}

async function gh<T = unknown>(path: string, token: string, init?: RequestInit): Promise<T> {
  const customProxy = getSettings().github.proxy;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) || {}),
  };

  const first = buildUrl(path, customProxy);
  const urls: string[] = [first.url];
  if (first.tryNext) {
    for (let i = 0; i < PROXY_FALLBACKS.length; i++) {
      const u = first.tryNext(i);
      if (u) urls.push(u);
    }
  }

  let lastErr: Error | null = null;
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    try {
      const res = await fetch(u, { ...init, headers, mode: "cors" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        if (res.status === 401) throw new Error("GitHub 401: токен недействителен или нет прав 'repo'");
        if (res.status === 404) throw new Error("GitHub 404: репозиторий или ветка не найдены");
        if (res.status === 403) throw new Error("GitHub 403: нет доступа (проверь scope токена)");
        throw new Error(`GitHub ${res.status}: ${t.slice(0, 200) || res.statusText}`);
      }
      return (await res.json()) as T;
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      lastErr = err;
      const isNetwork = err.message.includes("Failed to fetch") || err.message.includes("NetworkError") || err.name === "TypeError";
      if (!isNetwork) throw err;
    }
  }
  throw new Error(`Сеть/CORS: не удалось достучаться до GitHub. ${lastErr?.message || ""}. Укажите свой CORS-прокси в «Мозг → GitHub → CORS-прокси» (форматы: https://my-proxy.ru/?, https://my-proxy.ru/{url}).`);
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

type RefRes = { object: { sha: string } };
type CommitRes = { sha: string; tree: { sha: string } };
type BlobRes = { sha: string };
type TreeRes = { sha: string };

export async function commitToGitHub(files: ProjectFiles, message = "Коммит из Муравей 2.0"): Promise<string> {
  const s = getSettings().github;
  if (!s.token) throw new Error("Не задан токен GitHub. Откройте «Мозг → GitHub».");
  if (!s.repo || !s.repo.includes("/")) throw new Error("Укажите путь репозитория в формате «пользователь/репо».");

  const branch = s.branch || "main";
  const [owner, repo] = s.repo.split("/");

  const ref = await gh<RefRes>(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, s.token);
  const latestSha = ref.object.sha;

  const baseCommit = await gh<CommitRes>(`/repos/${owner}/${repo}/git/commits/${latestSha}`, s.token);
  const baseTree = baseCommit.tree.sha;

  const blobs = await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const blob = await gh<BlobRes>(`/repos/${owner}/${repo}/git/blobs`, s.token, {
        method: "POST",
        body: JSON.stringify({ content: utf8ToBase64(content), encoding: "base64" }),
      });
      return { path, mode: "100644" as const, type: "blob" as const, sha: blob.sha };
    })
  );

  const newTree = await gh<TreeRes>(`/repos/${owner}/${repo}/git/trees`, s.token, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTree, tree: blobs }),
  });

  const newCommit = await gh<CommitRes>(`/repos/${owner}/${repo}/git/commits`, s.token, {
    method: "POST",
    body: JSON.stringify({ message, tree: newTree.sha, parents: [latestSha] }),
  });

  await gh<RefRes>(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, s.token, {
    method: "PATCH",
    body: JSON.stringify({ sha: newCommit.sha }),
  });

  return newCommit.sha;
}

export async function pingGitHub(): Promise<{ login: string }> {
  const s = getSettings().github;
  if (!s.token) throw new Error("Не задан токен GitHub");
  const user = await gh<{ login: string }>("/user", s.token);
  return { login: user.login };
}