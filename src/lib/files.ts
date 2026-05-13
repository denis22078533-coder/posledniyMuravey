import JSZip from "jszip";
import { saveAs } from "file-saver";

export type ProjectFiles = Record<string, string>;

const KEY = "muravey_project_files_v1";
const META_KEY = "muravey_project_meta_v1";

export type ProjectSource = "zip" | "generated" | "self-edit" | "empty";
export type ProjectMeta = { source: ProjectSource; name: string; ts: number };

export function loadFiles(): ProjectFiles {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveFiles(files: ProjectFiles) {
  localStorage.setItem(KEY, JSON.stringify(files));
}

export function loadMeta(): ProjectMeta {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) return JSON.parse(raw);
  } catch {/* ignore */}
  return { source: "empty", name: "", ts: 0 };
}

export function saveMeta(meta: ProjectMeta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

export function clearProject() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(META_KEY);
  window.dispatchEvent(new Event("muravey:project-updated"));
}

const TEXT_EXT = new Set(["html", "htm", "css", "js", "ts", "tsx", "jsx", "json", "md", "txt", "svg", "xml", "yml", "yaml", "mjs", "cjs", "vue", "py", "env", "gitignore", "lock"]);

// Бинарные ассеты, которые конвертируем в data URL (для отображения в iframe)
const BINARY_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", ico: "image/x-icon", bmp: "image/bmp",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  mp3: "audio/mpeg", ogg: "audio/ogg",
  mp4: "video/mp4", webm: "video/webm",
};

export async function importZip(file: File): Promise<ProjectFiles> {
  const zip = await JSZip.loadAsync(file);
  const out: ProjectFiles = {};
  const entries = Object.values(zip.files);
  for (const entry of entries) {
    if (entry.dir) continue;
    if (entry.name.startsWith("__MACOSX")) continue;
    if (entry.name.includes("/.DS_Store")) continue;
    const path = entry.name;
    const ext = path.split(".").pop()?.toLowerCase() || "";
    if (TEXT_EXT.has(ext)) {
      out[path] = await entry.async("string");
    } else if (BINARY_MIME[ext]) {
      // Бинарный ассет → data URL (чтобы iframe мог его показать без сетевых запросов)
      const b64 = await entry.async("base64");
      out[path] = `data:${BINARY_MIME[ext]};base64,${b64}`;
    }
    // остальные расширения пропускаем
  }
  // remove common single top-level folder prefix
  const normalized = stripCommonPrefix(out);
  saveFiles(normalized);
  saveMeta({ source: "zip", name: file.name.replace(/\.zip$/i, ""), ts: Date.now() });
  return normalized;
}

function stripCommonPrefix(files: ProjectFiles): ProjectFiles {
  const keys = Object.keys(files);
  if (keys.length === 0) return files;
  const firsts = new Set(keys.map((k) => k.split("/")[0]));
  if (firsts.size !== 1) return files;
  const prefix = [...firsts][0] + "/";
  if (!keys.every((k) => k.startsWith(prefix))) return files;
  const out: ProjectFiles = {};
  for (const k of keys) out[k.slice(prefix.length)] = files[k];
  return out;
}

export async function exportZip(files: ProjectFiles, name = "muravey-project.zip") {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  saveAs(blob, name);
}

export function findIndexHtml(files: ProjectFiles): string | null {
  const keys = Object.keys(files);
  // приоритет: корневой index.html → public/index.html → любой html
  const preferred = ["index.html", "public/index.html", "src/index.html"];
  for (const p of preferred) {
    const k = keys.find((x) => x.toLowerCase() === p);
    if (k) return files[k];
  }
  const anyHtml = keys.find((k) => k.toLowerCase().endsWith(".html"));
  return anyHtml ? files[anyHtml] : null;
}

export function findFile(files: ProjectFiles, ...names: string[]): { path: string; content: string } | null {
  const keys = Object.keys(files);
  for (const n of names) {
    const exact = keys.find((k) => k.toLowerCase() === n.toLowerCase());
    if (exact) return { path: exact, content: files[exact] };
  }
  for (const n of names) {
    const ends = keys.find((k) => k.toLowerCase().endsWith("/" + n.toLowerCase()));
    if (ends) return { path: ends, content: files[ends] };
  }
  return null;
}

// Полный список файлов в виде плоского дерева для контекста ИИ
export function flatTreeList(files: ProjectFiles): string {
  const keys = Object.keys(files).sort();
  if (keys.length === 0) return "(пусто)";
  return keys.map((k) => `  ${k}  (${files[k].length} b)`).join("\n");
}

// On-demand чтение файла по пути с авто-нормализацией
export function readFileByPath(files: ProjectFiles, path: string): { path: string; content: string } | null {
  if (!path) return null;
  const norm = path.replace(/^[./]+/, "").trim();
  if (files[norm]) return { path: norm, content: files[norm] };
  const keys = Object.keys(files);
  // case-insensitive
  const ci = keys.find((k) => k.toLowerCase() === norm.toLowerCase());
  if (ci) return { path: ci, content: files[ci] };
  // endsWith match
  const ends = keys.find((k) => k.toLowerCase().endsWith("/" + norm.toLowerCase()));
  if (ends) return { path: ends, content: files[ends] };
  // basename match (если ИИ дал только имя файла)
  const baseOnly = norm.split("/").pop()?.toLowerCase();
  if (baseOnly) {
    const byName = keys.find((k) => k.toLowerCase().endsWith("/" + baseOnly) || k.toLowerCase() === baseOnly);
    if (byName) return { path: byName, content: files[byName] };
  }
  return null;
}

// Запись/обновление файла. Возвращает мутированную копию files.
export function writeFileByPath(files: ProjectFiles, path: string, content: string): ProjectFiles {
  const norm = path.replace(/^[./]+/, "").trim();
  if (!norm) return files;
  return { ...files, [norm]: content };
}

// Экспорт parser для использования снаружи
export function parsePackageDeps(pkgJson: string): string[] {
  try {
    const p = JSON.parse(pkgJson);
    return Object.keys({ ...(p.dependencies || {}), ...(p.devDependencies || {}) });
  } catch {
    return [];
  }
}

export function filesContextForAi(files: ProjectFiles, maxChars = 14000): string {
  const entries = Object.entries(files);
  if (entries.length === 0) return "";
  let out = `В проект уже загружены ${entries.length} файлов. Структура:\n${flatTreeList(files)}\n\nСодержимое ключевых файлов:\n\n`;
  // приоритезируем index.html, App.tsx, package.json, *.tsx/jsx/css
  const priority = entries.sort(([a], [b]) => {
    const score = (k: string) => {
      const l = k.toLowerCase();
      if (l.endsWith("index.html")) return 0;
      if (l.endsWith("app.tsx") || l.endsWith("app.jsx")) return 1;
      if (l.endsWith("main.tsx") || l.endsWith("main.jsx")) return 2;
      if (l.endsWith("package.json")) return 3;
      if (l.endsWith(".tsx") || l.endsWith(".jsx")) return 4;
      if (l.endsWith(".css")) return 5;
      if (l.endsWith(".html")) return 6;
      return 9;
    };
    return score(a) - score(b);
  });
  for (const [path, content] of priority) {
    const chunk = `--- ${path} ---\n${content.slice(0, 4000)}\n\n`;
    if (out.length + chunk.length > maxChars) {
      out += `... (остальные файлы опущены, всего ${entries.length})\n`;
      break;
    }
    out += chunk;
  }
  return out;
}

// ── Virtual Mounting: построение HTML-превью из произвольного проекта ────────
// Если есть готовый index.html — берём его и инжектим зависимости (Tailwind/React CDN, import-map для пакетов).
// Если основной точкой входа является App.tsx/App.jsx — обёртываем в шаблон с Babel Standalone.
const KNOWN_DEPS: Record<string, string> = {
  react: "https://esm.sh/react@18",
  "react-dom": "https://esm.sh/react-dom@18",
  "react-dom/client": "https://esm.sh/react-dom@18/client",
  "react-router-dom": "https://esm.sh/react-router-dom@6",
  "lucide-react": "https://esm.sh/lucide-react@0.460.0",
  clsx: "https://esm.sh/clsx@2",
  sonner: "https://esm.sh/sonner@1",
};

// Лёгкий инжектор: только логгер ошибок. Tailwind и Babel — опционально.
const LOGGER_INJECTOR = `<script>
  window.__MURAVEY_LOG__ = function(level, msg){
    try{ parent.postMessage({ type:'muravey:log', level: level, msg: String(msg) }, '*'); }catch(e){}
  };
  window.addEventListener('error', function(e){ window.__MURAVEY_LOG__('error', (e.message||'') + ' @ ' + (e.filename||'')+ ':' + (e.lineno||'')); });
  window.addEventListener('unhandledrejection', function(e){ window.__MURAVEY_LOG__('error', 'Promise: ' + (e.reason && e.reason.message || e.reason)); });
  (function(){
    var orig = console.error;
    console.error = function(){ window.__MURAVEY_LOG__('error', Array.from(arguments).join(' ')); orig.apply(console, arguments); };
    var w = console.warn;
    console.warn = function(){ window.__MURAVEY_LOG__('warn', Array.from(arguments).join(' ')); w.apply(console, arguments); };
    var l = console.log;
    console.log = function(){ window.__MURAVEY_LOG__('log', Array.from(arguments).join(' ')); l.apply(console, arguments); };
  })();
</script>`;

const TAILWIND_TAG = `<script src="https://cdn.tailwindcss.com"></script>`;

// ── Inline Virtual Module System ─────────────────────────────────────────────
// Вместо blob URL (которые не работают в srcDoc из-за нулевого origin) —
// вшиваем ВСЕ модули как строки внутрь одного <script> через синтетическую
// систему define/require. Babel запускается ВНУТРИ iframe после загрузки.
function buildInlineModuleBundle(files: ProjectFiles, deps: string[], entryPath: string): string {
  const codeFiles = Object.entries(files).filter(([k]) => /\.(jsx?|tsx?|mjs)$/i.test(k));
  const normalize = (p: string) => "./" + p.replace(/^[./]+/, "");

  const moduleSources: Record<string, string> = {};
  for (const [path, src] of codeFiles) moduleSources[normalize(path)] = src;

  const assetMap: Record<string, string> = {};
  for (const [path, val] of Object.entries(files)) {
    if (val.startsWith("data:")) assetMap[normalize(path)] = val;
  }

  const cdnImports: Record<string, string> = {};
  for (const d of deps) cdnImports[d] = KNOWN_DEPS[d] || `https://esm.sh/${d}`;
  cdnImports["react"] = KNOWN_DEPS.react;
  cdnImports["react-dom"] = KNOWN_DEPS["react-dom"];
  cdnImports["react-dom/client"] = KNOWN_DEPS["react-dom/client"];

  // import-map должен идти ДО любых module-скриптов
  const importMapTag = `<script type="importmap">${JSON.stringify({ imports: cdnImports })}</script>`;
  // Babel CDN — синхронная загрузка, ставим прямо перед VFS-runtime
  const babelTag = `<script src="https://unpkg.com/@babel/standalone@7.24.0/babel.min.js"></script>`;

  // Синтетическая система require/define — работает без fetch, без blob URL
  const runtimeScript = `<script>
(function(){
  var __modules = ${JSON.stringify(moduleSources)};
  var __assets  = ${JSON.stringify(assetMap)};
  var __cache   = {};
  var __entry   = ${JSON.stringify(normalize(entryPath))};

  function resolveSpec(from, spec) {
    if (!spec || (!spec.startsWith('.') && !spec.startsWith('/'))) return null;
    var fromParts = from.split('/'); fromParts.pop();
    var specParts = spec.replace(/^\\//, '').split('/');
    for (var i = 0; i < specParts.length; i++) {
      if (specParts[i] === '..') { fromParts.pop(); }
      else if (specParts[i] !== '.') { fromParts.push(specParts[i]); }
    }
    var base = fromParts.filter(Boolean).join('/');
    var exts = ['', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];
    for (var e = 0; e < exts.length; e++) {
      var candidate = './' + base + exts[e];
      if (__modules[candidate]) return candidate;
      if (__assets[candidate]) return candidate;
    }
    return null;
  }

  function requireModule(path) {
    if (__cache[path]) return __cache[path].exports;
    if (__assets[path]) return { default: __assets[path] };
    var src = __modules[path];
    if (!src) { console.warn('[VFS] module not found:', path); return {}; }

    // Babel-транспиляция внутри iframe
    if (!window.Babel) { console.error('[VFS] Babel not loaded'); return {}; }
    try {
      src = window.Babel.transform(src, {
        presets: ['typescript', ['react', { runtime: 'classic' }]],
        plugins: [['transform-modules-commonjs', { strictMode: false }]],
        filename: path
      }).code;
    } catch(e) { console.error('[VFS] Babel error in', path, e && e.message); return {}; }

    src = src.replace(/require\\(["']([^"']+)["']\\)/g, function(m, spec){
      if (spec.startsWith('.') || spec.startsWith('/')) {
        var resolved = resolveSpec(path, spec);
        if (resolved) return '__vfsReq(' + JSON.stringify(resolved) + ')';
      }
      return m;
    });

    var mod = { exports: {} };
    __cache[path] = mod;
    try {
      var fn = new Function('module', 'exports', 'require', '__vfsReq', src);
      fn(mod, mod.exports, function(spec){
        if (spec.startsWith('.') || spec.startsWith('/')) {
          var r = resolveSpec(path, spec);
          if (r) return requireModule(r);
        }
        console.warn('[VFS] sync require for external module', spec);
        return {};
      }, requireModule);
    } catch(e) { console.error('[VFS] runtime error in', path, e); }
    return mod.exports;
  }

  window.__VFS_require__ = requireModule;
  window.__VFS_entry__   = __entry;
})();
</script>`;

  const bootScript = `<script type="module">
(async function boot() {
  if (document.readyState === 'loading') {
    await new Promise(function(r){ document.addEventListener('DOMContentLoaded', r); });
  }
  var t0 = Date.now();
  while ((!window.Babel || typeof window.__VFS_require__ !== 'function') && Date.now() - t0 < 5000) {
    await new Promise(function(r){ setTimeout(r, 30); });
  }
  if (!window.Babel) { console.error('[VFS] Babel timeout'); return; }
  if (typeof window.__VFS_require__ !== 'function') { console.error('[VFS] runtime not initialized'); return; }
  try {
    var m = window.__VFS_require__(window.__VFS_entry__);
    var App = m && (m.default || m.App || m);
    if (App && typeof App === 'function' && document.getElementById('root')) {
      var R  = await import('react');
      var RD = await import('react-dom/client');
      RD.createRoot(document.getElementById('root')).render(R.createElement(App));
    }
  } catch(e) { console.error('[VFS] mount error', e); }
})();
</script>`;

  return importMapTag + "\n" + babelTag + "\n" + runtimeScript + "\n" + bootScript;
}

// Старый API — возвращаем совместимый объект (blobMap теперь пустой — не нужен)
function buildLocalModuleMap(files: ProjectFiles, deps: string[]): { blobMap: Record<string, string>; importMap: string } {
  // Находим entry point
  const entry = findFile(files, "src/main.tsx", "src/main.jsx", "main.tsx", "main.jsx", "src/index.tsx", "index.tsx", "src/App.tsx", "App.tsx");
  if (!entry) {
    // нет entry — только CDN import-map
    const cdnImports: Record<string, string> = {};
    for (const d of deps) cdnImports[d] = KNOWN_DEPS[d] || `https://esm.sh/${d}`;
    cdnImports["react"] = KNOWN_DEPS.react;
    cdnImports["react-dom"] = KNOWN_DEPS["react-dom"];
    cdnImports["react-dom/client"] = KNOWN_DEPS["react-dom/client"];
    return { blobMap: {}, importMap: `<script type="importmap">${JSON.stringify({ imports: cdnImports })}</script>` };
  }
  const bundle = buildInlineModuleBundle(files, deps, entry.path);
  return { blobMap: {}, importMap: bundle };
}

function resolveImport(fromFile: string, spec: string, files: ProjectFiles): string | null {
  const fromDir = fromFile.split("/").slice(0, -1).join("/");
  const candidates = [
    `${fromDir}/${spec}`,
    `${fromDir}/${spec}.tsx`,
    `${fromDir}/${spec}.ts`,
    `${fromDir}/${spec}.jsx`,
    `${fromDir}/${spec}.js`,
    `${fromDir}/${spec}/index.tsx`,
    `${fromDir}/${spec}/index.ts`,
    `${fromDir}/${spec}/index.jsx`,
    `${fromDir}/${spec}/index.js`,
  ].map((p) => p.replace(/\/+/g, "/").replace(/^\//, ""));
  for (const c of candidates) if (files[c]) return c;
  return null;
}

// Детектор: SPA (React/Vite/TSX) или Plain HTML
function detectProjectMode(files: ProjectFiles): "plain" | "spa" {
  const keys = Object.keys(files);
  const hasPkg = keys.some((k) => k.toLowerCase().endsWith("package.json"));
  const hasTsx = keys.some((k) => /\.(tsx|jsx)$/i.test(k));
  const hasReactSrc = keys.some((k) => {
    if (!/\.(tsx?|jsx?|mjs)$/i.test(k)) return false;
    const src = files[k] || "";
    if (src.startsWith("data:")) return false;
    return /\b(import\s+[^;]*from\s+["']react|require\(["']react)/.test(src);
  });
  if (hasPkg || hasTsx || hasReactSrc) return "spa";
  return "plain";
}

export function buildVirtualPreview(files: ProjectFiles): string {
  const indexHtml = findIndexHtml(files);
  const pkgFile = findFile(files, "package.json");
  const deps = pkgFile ? parsePackageDeps(pkgFile.content) : [];
  const mode = detectProjectMode(files);

  // Инлайн ассетов в HTML/CSS: подмена локальных путей на data URL
  // ВАЖНО: не трогаем http://, https://, // (CDN), data:, blob:, #, mailto:, tel:
  const inlineAssetHtml = (html: string) => {
    return html.replace(/\b(src|href|url)\s*(?:=\s*(["'])([^"']+)\2|\(([^)'"]+)\))/gi, (m, attr, q, val1, val2) => {
      const v = (val1 || val2 || "").trim();
      if (
        !v ||
        v.startsWith("data:") || v.startsWith("blob:") ||
        v.startsWith("http://") || v.startsWith("https://") || v.startsWith("//") ||
        v.startsWith("#") || v.startsWith("mailto:") || v.startsWith("tel:") ||
        v.startsWith("javascript:")
      ) return m;
      const norm = v.replace(/^[./]+/, "").replace(/^\//, "").split("?")[0].split("#")[0];
      const found = Object.entries(files).find(([k]) => k === norm || k.endsWith("/" + norm));
      if (found && found[1].startsWith("data:")) {
        if (val2 !== undefined) return `${attr}(${found[1]})`;
        return `${attr}=${q}${found[1]}${q}`;
      }
      // Текстовый CSS — встраиваем как <link rel=stylesheet>? Пропускаем — link обработается отдельно
      return m;
    });
  };

  // Инлайн локальных <link rel=stylesheet href="style.css"> и <script src="app.js">
  // ВАЖНО: только если файл реально лежит в проекте — иначе оставляем как есть
  const inlineLocalAssets = (html: string) => {
    // <link rel=stylesheet href="...">
    html = html.replace(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi, (m, href) => {
      if (/^(https?:)?\/\//.test(href) || href.startsWith("data:")) return m; // не трогаем CDN
      const norm = href.replace(/^[./]+/, "").replace(/^\//, "").split("?")[0];
      const found = Object.entries(files).find(([k]) => k === norm || k.endsWith("/" + norm));
      if (found && !found[1].startsWith("data:")) {
        return `<style>${inlineAssetHtml(found[1])}</style>`;
      }
      return m;
    });
    // <script src="local.js"> — встраиваем содержимое (только если файл локальный и текстовый)
    html = html.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (m, pre, src, post) => {
      if (/^(https?:)?\/\//.test(src) || src.startsWith("data:")) return m; // CDN/data — НЕ ТРОГАЕМ
      const norm = src.replace(/^[./]+/, "").replace(/^\//, "").split("?")[0];
      const found = Object.entries(files).find(([k]) => k === norm || k.endsWith("/" + norm));
      if (found && !found[1].startsWith("data:")) {
        const attrs = (pre + " " + post).replace(/\bsrc=["'][^"']+["']/i, "").trim();
        return `<script ${attrs}>\n${found[1]}\n</script>`;
      }
      return m;
    });
    return html;
  };

  // ── PLAIN HTML MODE ────────────────────────────────────────────────────────
  // Никакого VFS, никакого Babel. Только инлайн ассетов + логгер.
  if (mode === "plain" && indexHtml) {
    let html = rewriteAbsolutePaths(indexHtml);
    html = inlineLocalAssets(html);
    html = inlineAssetHtml(html);
    const baseTag = `<base href="./">`;
    const headInject = `${baseTag}\n${LOGGER_INJECTOR}`;
    if (html.includes("</head>")) html = html.replace("</head>", `${headInject}\n</head>`);
    else if (html.includes("<head>")) html = html.replace("<head>", `<head>${headInject}`);
    else html = `<!doctype html><html><head>${headInject}</head><body>${html}</body></html>`;
    return html;
  }

  // ── SPA MODE ───────────────────────────────────────────────────────────────
  // Babel + VFS + Tailwind
  const buildCssInline = () => {
    const cssFiles = Object.entries(files).filter(([k]) => k.endsWith(".css"));
    return cssFiles.map(([, css]) => `<style>${inlineAssetHtml(css)}</style>`).join("\n");
  };

  if (indexHtml) {
    let html = rewriteAbsolutePaths(indexHtml);
    html = inlineAssetHtml(html);
    const cssInline = buildCssInline();

    // SPA: удаляем <script src="local.{tsx,jsx,ts,js}"> — они подгрузятся VFS
    // НО только локальные! CDN-скрипты сохраняем.
    html = html.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi, (m, _pre, src) => {
      if (/^(https?:)?\/\//.test(src) || src.startsWith("data:")) return m;
      // только локальные tsx/jsx — удаляем
      if (/\.(tsx?|jsx?|mjs)(\?|$)/i.test(src)) return "<!-- vfs-replaced -->";
      return m;
    });

    const { importMap } = buildLocalModuleMap(files, deps);
    const baseTag = `<base href="./">`;
    const headInject = `${baseTag}\n${LOGGER_INJECTOR}\n${TAILWIND_TAG}\n${cssInline}\n${importMap}`;
    if (html.includes("</head>")) html = html.replace("</head>", `${headInject}\n</head>`);
    else if (html.includes("<head>")) html = html.replace("<head>", `<head>${headInject}`);
    else html = `<!doctype html><html><head>${headInject}</head><body>${html}</body></html>`;
    return html;
  }

  // Чистый React-проект без index.html
  const appFile = findFile(files, "src/App.tsx", "src/App.jsx", "App.tsx", "App.jsx");
  if (appFile) {
    const { importMap } = buildLocalModuleMap(files, deps);
    const cssInline = buildCssInline();
    return `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<base href="./">
${LOGGER_INJECTOR}
${TAILWIND_TAG}
${cssInline}
${importMap}
</head><body>
<div id="root"></div>
</body></html>`;
  }

  return "";
}

// Заменяет абсолютные пути (/foo.png) на относительные (./foo.png) в атрибутах src/href.
// CDN (//cdn..., http://, https://) и data:/blob:/mailto:/tel: не трогаем.
function rewriteAbsolutePaths(html: string): string {
  return html.replace(/\b(src|href|action|poster)\s*=\s*(["'])([^"']+)\2/gi, (m, attr, q, val) => {
    const v = String(val).trim();
    if (
      v.startsWith("http://") || v.startsWith("https://") || v.startsWith("//") ||
      v.startsWith("data:") || v.startsWith("blob:") || v.startsWith("#") ||
      v.startsWith("mailto:") || v.startsWith("tel:") || v.startsWith("./") || v.startsWith("../")
    ) return m;
    if (v.startsWith("/")) return `${attr}=${q}.${v}${q}`;
    return m;
  });
}