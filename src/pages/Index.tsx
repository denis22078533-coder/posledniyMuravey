import { useState, useRef, useEffect } from "react";
import Icon from "@/components/ui/icon";
import {
  useSettings, getSettings, type AiProvider, getActiveProviderConfig,
  MODELS_BY_PROVIDER, PROVIDER_DEFAULTS,
  IMAGE_ENGINE_DEFAULTS, MEDIA_ENGINE_DEFAULTS,
  DESIGNER_PROMPT, ENGINEER_PROMPT, type PromptPreset,
} from "@/lib/store";
import { chat, callLlmOnce, extractHtml, type ChatMessage } from "@/lib/ai";
import {
  importZip, exportZip, findIndexHtml, loadFiles, saveFiles, filesContextForAi,
  loadMeta, saveMeta, clearProject, buildVirtualPreview, parsePackageDeps,
  type ProjectFiles, type ProjectMeta,
} from "@/lib/files";
import { commitToGitHub, pingGitHub } from "@/lib/github";
import { toast } from "sonner";
import { AntTyping } from "@/components/AntTyping";
import { BackgroundAnt } from "@/components/BackgroundAnt";
import { detectIntent, generateImage, generateVideo, generateAudio, fileToBase64 } from "@/lib/media";
import { pingSupabase, applySql } from "@/lib/supabase";
import { AuthGate } from "@/components/AuthGate";
import { SupportWidget } from "@/components/SupportWidget";
import {
  useAuth, signOut, addModerator, removeModerator, transferOwnership,
  setTokensFor, banUser, deleteUser, checkContent, logAudit, clearAudit, consumeToken, syncTopBalance,
} from "@/lib/auth";
import { useSupport, addMessage, resolveThread, markReadForAdmin } from "@/lib/support";
import {
  useIntegrations, addIntegration, updateIntegration, removeIntegration,
  pingIntegration, buildLeadInjector, getIntegrationsSnapshot, KIND_LABEL, KIND_HINT, type IntegrationKind,
} from "@/lib/integrations";

type Tab = "chat" | "core" | "projects";
type CoreTab = "ai" | "github" | "payments" | "system" | "logs" | "users" | "dialogs" | "integrations";
type Device = "desktop" | "mobile";
type Msg = {
  role: "user" | "ai";
  text: string;
  image?: string;
  video?: string;
  audio?: string;
  status?: "loading";
  actions?: string[];
  progress?: number;
  sql?: string;
};

function stripToolCmds(text: string): string {
  let t = text;
  // WRITE/EDIT блоки с кодом — целиком
  t = t.replace(/(?:^|\n)\s*(?:💉\s*)?\[?(?:WRITE|EDIT)\]?:\s*[^\n`]+\s*\n+```(?:[a-zA-Z]+)?\n[\s\S]*?\n```/g, "\n");
  // SEARCH-команды
  t = t.replace(/(?:^|\n)\s*(?:🔎\s*)?\[?SEARCH\]?:\s*.+?(?:\n|$)/gi, "\n");
  // READ-команды
  t = t.replace(/(?:^|\n)\s*(?:📖\s*)?\[?READ\]?:\s*.+?(?:\n|$)/gi, "\n");
  return t.trim();
}

function extractActions(text: string): { actions: string[]; rest: string } {
  const firstLine = text.split("\n").find((l) => l.trim().length > 0) || "";
  if (firstLine.includes("·") && firstLine.length < 240) {
    const actions = firstLine.split("·").map((s) => s.trim()).filter(Boolean);
    if (actions.length >= 2 && actions.length <= 8) {
      return { actions, rest: text.replace(firstLine, "").trim() };
    }
  }
  return { actions: [], rest: text };
}

function injectSupabase(html: string, url: string, anonKey: string): string {
  if (!html.toLowerCase().includes("supabase")) return html;
  const inject = `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script>window.__SUPABASE_URL__=${JSON.stringify(url)};window.__SUPABASE_ANON_KEY__=${JSON.stringify(anonKey)};window.supabaseClient=window.supabase&&window.supabase.createClient(window.__SUPABASE_URL__,window.__SUPABASE_ANON_KEY__);</script>`;
  if (html.includes("</head>")) return html.replace("</head>", `${inject}\n</head>`);
  return inject + html;
}

const TEMPLATES = [
  { id: 1, title: "Магазин продуктов", desc: "Онлайн-магазин с корзиной", emoji: "🛒", tag: "Электронная коммерция", color: "purple", prompt: "Сделай красивый магазин продуктов с карточками товаров, корзиной и итоговой суммой." },
  { id: 2, title: "Портфолио", desc: "Минималистичное портфолио", emoji: "🎨", tag: "Личное", color: "orange", prompt: "Создай минималистичное портфолио дизайнера с шапкой, проектами в сетке и контактами." },
  { id: 3, title: "SaaS Лендинг", desc: "Посадочная страница для стартапа", emoji: "🚀", tag: "Маркетинг", color: "purple", prompt: "Создай SaaS-лендинг с hero, фичами в 3 колонки, тарифами и формой подписки." },
  { id: 4, title: "Блог-журнал", desc: "Редакторский блог со статьями", emoji: "📰", tag: "Контент", color: "orange", prompt: "Сделай блог-журнал с крупным заголовком, обложкой статьи и сеткой превью записей." },
  { id: 5, title: "Запись на услуги", desc: "Бронирование и календарь", emoji: "📅", tag: "Сервис", color: "purple", prompt: "Создай страницу записи на услуги с выбором даты, времени и формой контактов." },
  { id: 6, title: "Ресторан", desc: "Сайт ресторана с меню", emoji: "🍝", tag: "Еда и напитки", color: "orange", prompt: "Создай сайт ресторана: hero с фото, разделы меню по категориям, бронирование столика." },
];

export default function Index() {
  return (
    <AuthGate>
      <IndexInner />
    </AuthGate>
  );
}

function IndexInner() {
  const [tab, setTab] = useState<Tab>("chat");
  const [presetPrompt, setPresetPrompt] = useState("");
  const { isModerator } = useAuth();

  useEffect(() => { syncTopBalance(); }, []);

  // Если не модератор/админ — насильно прячем «Мозг»
  useEffect(() => {
    if (tab === "core" && !isModerator) setTab("chat");
  }, [isModerator, tab]);

  return (
    <div className="min-h-screen bg-background text-foreground grid-bg relative">
      <BackgroundAnt />
      <div className="relative z-10">
        <TopBar />
        <main className="pb-24">
          {tab === "chat" && <ChatTab presetPrompt={presetPrompt} clearPreset={() => setPresetPrompt("")} />}
          {tab === "core" && isModerator && <CoreTab />}
          {tab === "projects" && (
            <ProjectsTab onUse={(p) => { setPresetPrompt(p); setTab("chat"); }} />
          )}
        </main>
        <BottomNav tab={tab} setTab={setTab} />
        <SupportWidget />
      </div>
    </div>
  );
}

// ─── Top Bar ──────────────────────────────────────────────────────────────────
function TopBar() {
  const [s] = useSettings();
  const { session } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const initials = session?.email ? session.email.slice(0, 2).toUpperCase() : "??";
  const roleColor = session?.role === "superadmin" ? "text-orange-400" : session?.role === "moderator" ? "text-purple-400" : "text-muted-foreground";
  const roleLabel = session?.role === "superadmin" ? "OWNER" : session?.role === "moderator" ? "MOD" : "USER";
  const activeCfg = getActiveProviderConfig(s);

  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/70 border-b border-border">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-orange-500 flex items-center justify-center font-heading font-bold text-sm text-black">
            М
          </div>
          <div className="leading-tight">
            <div className="font-heading text-base tracking-wider uppercase">Муравей</div>
            <div className="text-[10px] text-muted-foreground font-mono -mt-0.5">v2.0 · БЕТА</div>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary border border-border">
            <span className={`w-1.5 h-1.5 rounded-full ${activeCfg.apiKey ? "bg-green-500" : "bg-muted-foreground"} animate-pulse-dot`} />
            <span className="font-mono text-muted-foreground">{activeCfg.provider} · {activeCfg.model}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary border border-border">
            <Icon name="Coins" size={12} className="text-orange-500" />
            <span className="font-mono font-medium">{(session?.tokens ?? s.tokens).toLocaleString("ru-RU")}</span>
            <span className="text-muted-foreground">токенов</span>
          </div>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full bg-secondary border border-border hover:border-purple-500/50 transition"
            >
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-orange-500 flex items-center justify-center text-[10px] font-bold text-black">
                {initials}
              </div>
              <span className={`font-mono text-[10px] uppercase tracking-wider ${roleColor}`}>{roleLabel}</span>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-12 w-64 bg-card border border-border rounded-xl shadow-2xl p-2 z-50 animate-fade-up">
                <div className="px-3 py-2 border-b border-border mb-1">
                  <div className="font-mono text-xs truncate">{session?.email}</div>
                  <div className={`text-[10px] font-mono uppercase tracking-wider mt-0.5 ${roleColor}`}>{roleLabel}</div>
                </div>
                <button
                  onClick={() => { signOut(); setMenuOpen(false); toast.success("Вы вышли"); }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-secondary transition text-left"
                >
                  <Icon name="LogOut" size={14} /> Выйти
                </button>
              </div>
            )}
          </div>
        </div>

        <button onClick={() => setMenuOpen((v) => !v)} className="md:hidden w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-orange-500 flex items-center justify-center text-xs font-bold text-black">
          {initials}
        </button>
      </div>
    </header>
  );
}

// ─── Bottom Nav ───────────────────────────────────────────────────────────────
function BottomNav({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const { isModerator } = useAuth();
  const { pendingCount, totalUnread } = useSupport();
  const items: { id: Tab; label: string; icon: string; dot?: number }[] = [
    { id: "chat", label: "Чат", icon: "MessageSquare" },
    ...(isModerator ? [{ id: "core" as Tab, label: "Мозг", icon: "Brain", dot: pendingCount + totalUnread }] : []),
    { id: "projects", label: "Проекты", icon: "LayoutGrid" },
  ];

  return (
    <nav className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-1 p-1.5 rounded-full bg-card/90 backdrop-blur-xl border border-border shadow-2xl">
        {items.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`relative flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all ${
                active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              <Icon name={item.icon} fallback="Circle" size={15} />
              <span className="font-heading uppercase tracking-wider text-xs">{item.label}</span>
              {item.dot ? (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {item.dot}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ─── Chat Tab ─────────────────────────────────────────────────────────────────
function ChatTab({ presetPrompt, clearPreset }: { presetPrompt: string; clearPreset: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "ai", text: "[Система] Готов. Опишите задачу — сайт, БД, медиа.", actions: ["⚡ Готов к работе", "🧠 Контекст пуст", "🔌 Жду команды"] },
  ]);
  const [input, setInput] = useState("");
  const [device, setDevice] = useState<Device>("desktop");
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [files, setFilesState] = useState<ProjectFiles>(() => loadFiles());
  const [meta, setMeta] = useState<ProjectMeta>(() => loadMeta());
  const [attached, setAttached] = useState<{ name: string; data: string } | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [logs, setLogs] = useState<{ level: string; msg: string; ts: number }[]>([]);
  const photoRef = useRef<HTMLInputElement>(null);
  const auth = useAuth();

  function rebuildPreview(nextFiles: ProjectFiles) {
    if (Object.keys(nextFiles).length === 0) { setPreviewHtml(""); return; }
    const built = buildVirtualPreview(nextFiles) || findIndexHtml(nextFiles) || "";
    setPreviewHtml(built);
  }

  useEffect(() => {
    rebuildPreview(files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const d = ev.data;
      if (d && typeof d === "object" && d.type === "muravey:log") {
        setLogs((prev) => [...prev.slice(-199), { level: d.level || "log", msg: String(d.msg || ""), ts: Date.now() }]);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    if (presetPrompt) {
      setInput(presetPrompt);
      clearPreset();
    }
  }, [presetPrompt, clearPreset]);

  useEffect(() => {
    const fn = () => {
      const f = loadFiles();
      const m = loadMeta();
      setFilesState(f);
      setMeta(m);
      rebuildPreview(f);
    };
    window.addEventListener("muravey:project-updated", fn);
    return () => window.removeEventListener("muravey:project-updated", fn);
  }, []);

  function onResetAll() {
    if (!confirm("Полностью стереть текущий проект и превью?")) return;
    clearProject();
    setFilesState({});
    setMeta({ source: "empty", name: "", ts: 0 });
    setPreviewHtml("");
    setLogs([]);
    setMessages([{ role: "ai", text: "[Система] Проект очищен. Готов к новой задаче.", actions: ["🧹 Память очищена", "🧠 Контекст пуст"] }]);
    toast.success("Проект очищен");
  }

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const data = await fileToBase64(f);
      setAttached({ name: f.name, data });
      toast.success("Фото прикреплено. Опишите, что с ним сделать.");
    } catch {
      toast.error("Не удалось загрузить фото");
    } finally {
      if (photoRef.current) photoRef.current.value = "";
    }
  }

  async function send() {
    const text = input.trim();
    if ((!text && !attached) || busy) return;

    // Content filter
    const check = checkContent(text);
    const sessEmail = auth.session?.email || "anonymous";
    const sessRole = auth.session?.role || "user";

    if (!check.ok) {
      setMessages((m) => [...m, { role: "user", text }]);
      setMessages((m) => [...m, { role: "ai", text: "[Система] Запрос отклонён политикой безопасности", actions: ["🚫 Контент-фильтр", check.reason || "Стоп-слово"] }]);
      logAudit({ email: sessEmail, role: sessRole, intent: "blocked", text, blocked: true, reason: check.reason });
      setInput("");
      setAttached(null);
      return;
    }

    const userMsg: Msg = { role: "user", text: text || "(без текста)", image: attached?.data };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    const currentAttached = attached;
    setAttached(null);
    setBusy(true);

    const intent = detectIntent(text, !!currentAttached);
    logAudit({ email: sessEmail, role: sessRole, intent: intent || "web", text });
    consumeToken();

    // ── МЕДИА-ВЕТКА ─────────────────────────────────────────────
    if (intent === "image" || intent === "image-edit") {
      const statusText = currentAttached ? "[Система] Обработка графических ресурсов..." : "[Система] Синтез изображения...";
      setMessages((m) => [...m, { role: "ai", text: statusText, status: "loading", progress: 10 }]);
      const tick = setInterval(() => {
        setMessages((m) => { const n = [...m]; const last = n[n.length - 1]; if (last?.status === "loading") last.progress = Math.min(92, (last.progress || 10) + 7); return [...n]; });
      }, 600);
      try {
        const url = await generateImage(text || "красивое фото", currentAttached ? { image: currentAttached.data } : undefined);
        clearInterval(tick);
        setMessages((m) => { const n = [...m]; n[n.length - 1] = { role: "ai", text: "[Система] Изображение готово.", image: url, actions: ["📸 Графика синтезирована", "💾 Сохранено в ленту"] }; return n; });
      } catch (e: unknown) {
        clearInterval(tick);
        const msg = e instanceof Error ? e.message : "Ошибка";
        toast.error(msg);
        setMessages((m) => { const n = [...m]; n[n.length - 1] = { role: "ai", text: `[Ошибка] ${msg}` }; return n; });
      } finally {
        setBusy(false);
      }
      return;
    }

    if (intent === "audio") {
      setMessages((m) => [...m, { role: "ai", text: "[Система] Синтез аудио-дорожки...", status: "loading", progress: 8 }]);
      const tick = setInterval(() => {
        setMessages((m) => { const n = [...m]; const last = n[n.length - 1]; if (last?.status === "loading") last.progress = Math.min(90, (last.progress || 8) + 5); return [...n]; });
      }, 800);
      try {
        const url = await generateAudio(text);
        clearInterval(tick);
        setMessages((m) => { const n = [...m]; n[n.length - 1] = { role: "ai", text: "[Система] Аудио готово.", audio: url, actions: ["🎵 Дорожка собрана", "▶ Готово к воспроизведению"] }; return n; });
      } catch (e: unknown) {
        clearInterval(tick);
        const msg = e instanceof Error ? e.message : "Ошибка";
        toast.error(msg);
        setMessages((m) => { const n = [...m]; n[n.length - 1] = { role: "ai", text: `[Ошибка] ${msg}` }; return n; });
      } finally {
        setBusy(false);
      }
      return;
    }

    if (intent === "video") {
      setMessages((m) => [...m, { role: "ai", text: "[Система] Рендеринг видео-потока...", status: "loading", progress: 5 }]);
      const tick = setInterval(() => {
        setMessages((m) => { const n = [...m]; const last = n[n.length - 1]; if (last?.status === "loading") last.progress = Math.min(88, (last.progress || 5) + 4); return [...n]; });
      }, 900);
      try {
        const url = await generateVideo(text);
        clearInterval(tick);
        setMessages((m) => { const n = [...m]; n[n.length - 1] = { role: "ai", text: "[Система] Видео готово.", video: url, actions: ["🎬 Видео рендеринг завершён", "▶ Доступно для просмотра"] }; return n; });
      } catch (e: unknown) {
        clearInterval(tick);
        const msg = e instanceof Error ? e.message : "Ошибка";
        toast.error(msg);
        setMessages((m) => { const n = [...m]; n[n.length - 1] = { role: "ai", text: `[Ошибка] ${msg}` }; return n; });
      } finally {
        setBusy(false);
      }
      return;
    }

    // ── ВЕБ-ВЕТКА (HTML-сайт + опц. Supabase) ───────────────────
    const hasZip = loadMeta().source === "zip";
    const initStatus = hasZip
      ? "🔍 Анализ структуры проекта · 💉 Подготовка инъекции в App.tsx..."
      : "🏗️ Сборка структуры · 🎨 Применение тем...";
    setMessages((m) => [...m, { role: "ai", text: initStatus, status: "loading", progress: 6 }]);
    const tick = setInterval(() => {
      setMessages((m) => { const n = [...m]; const last = n[n.length - 1]; if (last?.status === "loading") last.progress = Math.min(94, (last.progress || 6) + 6); return [...n]; });
    }, 500);

    const ctx = filesContextForAi(files);
    const history: ChatMessage[] = [];
    if (ctx) history.push({ role: "user", content: ctx });
    const prior = messages.filter((_, i) => i > 0);
    for (const m of prior) history.push({ role: m.role === "user" ? "user" : "assistant", content: m.text });
    history.push({ role: "user", content: text });

    let multiFileApplied: string[] = [];
    try {
      const reply = await chat(history, undefined, (p) => {
        setMessages((m) => {
          const n = [...m];
          const last = n[n.length - 1];
          if (!last || last.status !== "loading") return n;
          if (p.stage === "searching") last.text = `🔎 Поиск в сети · «${p.note}»...`;
          else if (p.stage === "reading") last.text = `📖 Чтение файлов · ${p.paths.slice(0, 3).join(", ")}${p.paths.length > 3 ? "..." : ""}`;
          else if (p.stage === "writing") {
            multiFileApplied = p.paths;
            last.text = `💉 Запись ${p.paths.length} файл(ов)...`;
          }
          return [...n];
        });
      }, {
        files,
        onFilesChange: (next) => {
          setFilesState(next);
          saveFiles(next);
          const nextMeta: ProjectMeta = {
            source: meta.source === "zip" ? "self-edit" : meta.source === "empty" ? "generated" : meta.source,
            name: meta.name || "Новая генерация",
            ts: Date.now(),
          };
          saveMeta(nextMeta);
          setMeta(nextMeta);
          rebuildPreview(next);
        },
      });
      clearInterval(tick);

      // Если ИИ применил WRITE-команды — это финал, выводим список
      if (multiFileApplied.length > 0) {
        const cleanText = stripToolCmds(reply);
        const actsW = ["💉 Изменено файлов: " + multiFileApplied.length, "🚀 Превью обновлено"];
        setMessages((m) => { const n = [...m]; n[n.length - 1] = { role: "ai", text: cleanText || "[Система] Файлы обновлены.", actions: actsW, progress: 100 }; return n; });
        return;
      }

      const cleanReply = stripToolCmds(reply);
      const { actions, rest } = extractActions(cleanReply);
      const html = extractHtml(rest || cleanReply);
      if (html) {
        const sb = getSettings().supabase;
        let finalHtml = sb.url && sb.anonKey ? injectSupabase(html, sb.url, sb.anonKey) : html;
        const leadScript = buildLeadInjector(getIntegrationsSnapshot());
        if (leadScript) {
          finalHtml = finalHtml.includes("</body>")
            ? finalHtml.replace("</body>", `${leadScript}\n</body>`)
            : finalHtml + leadScript;
        }
        const nextFiles = { ...files, "index.html": finalHtml };
        setFilesState(nextFiles);
        saveFiles(nextFiles);
        const nextMeta: ProjectMeta = {
          source: meta.source === "zip" ? "self-edit" : "generated",
          name: meta.source === "zip" ? meta.name : "Новая генерация",
          ts: Date.now(),
        };
        saveMeta(nextMeta);
        setMeta(nextMeta);
        rebuildPreview(nextFiles);
        const finalActions = actions.length ? actions : ["🔨 Структура собрана", "🎨 Стили применены", "🚀 Превью обновлено"];
        setMessages((m) => { const n = [...m]; n[n.length - 1] = { role: "ai", text: "[Система] Сборка завершена.", actions: finalActions, progress: 100 }; return n; });
      } else {
        setMessages((m) => { const n = [...m]; n[n.length - 1] = { role: "ai", text: cleanReply, actions }; return n; });
      }
    } catch (e: unknown) {
      clearInterval(tick);
      const msg = e instanceof Error ? e.message : "Неизвестная ошибка";
      toast.error(msg);
      setMessages((m) => { const n = [...m]; n[n.length - 1] = { role: "ai", text: `[Ошибка] ${msg}` }; return n; });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 pt-6 animate-fade-up">
      <div className="grid lg:grid-cols-[40%_60%] gap-4 h-[calc(100vh-180px)]">
        {/* CHAT LEFT */}
        <div className="bg-card border border-border rounded-2xl flex flex-col overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon name="Sparkles" size={14} className="text-purple-500" />
              <h2 className="font-heading uppercase tracking-wider text-sm">Рабочее пространство</h2>
            </div>
            <button
              onClick={() => setMessages([{ role: "ai", text: "Чат очищен. Опиши новый сайт." }])}
              className="text-xs text-muted-foreground hover:text-foreground transition"
              title="Очистить чат"
            >
              <Icon name="RotateCcw" size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} animate-fade-up`}>
                <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                  m.role === "user"
                    ? "bg-foreground text-background rounded-br-md"
                    : "bg-secondary text-foreground rounded-bl-md border border-border"
                }`}>
                  {m.status === "loading" ? (
                    <div className="space-y-2 min-w-[220px]">
                      <div className="flex items-center gap-2.5">
                        <AntTyping size={42} />
                        <span className="font-mono text-xs">{m.text}<span className="animate-cursor">|</span></span>
                      </div>
                      <div className="h-1 rounded-full bg-background overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-purple-500 to-orange-500 transition-all duration-500" style={{ width: `${m.progress || 0}%` }} />
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground text-right">{m.progress || 0}%</div>
                    </div>
                  ) : (
                    <>{m.text}</>
                  )}
                  {m.actions && m.actions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.actions.map((a, k) => (
                        <span key={k} className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-background/60 border border-purple-500/30 text-purple-300">
                          {a}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.image && (
                    <div className="mt-2 rounded-lg overflow-hidden border border-border">
                      <img src={m.image} alt="media" className="w-full max-h-80 object-contain bg-black/40" />
                    </div>
                  )}
                  {m.video && (
                    <div className="mt-2 rounded-lg overflow-hidden border border-border">
                      <video src={m.video} controls className="w-full max-h-80 bg-black" />
                    </div>
                  )}
                  {m.audio && (
                    <div className="mt-2">
                      <audio src={m.audio} controls className="w-full" />
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && messages[messages.length - 1]?.status !== "loading" && (
              <div className="flex justify-start animate-fade-up">
                <div className="bg-secondary text-muted-foreground border border-border rounded-2xl rounded-bl-md px-4 py-3 text-sm flex items-center gap-3">
                  <AntTyping size={48} />
                  <div className="flex flex-col">
                    <span className="font-heading text-xs uppercase tracking-wider text-foreground">Муравей печатает</span>
                    <span className="text-[11px] font-mono text-muted-foreground">
                      компилирует код<span className="animate-cursor">_</span>
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-border p-3">
            {attached && (
              <div className="mb-2 flex items-center gap-2 p-2 rounded-lg bg-secondary border border-purple-500/30 animate-fade-up">
                <img src={attached.data} alt="вложение" className="w-12 h-12 rounded object-cover border border-border" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{attached.name}</div>
                  <div className="text-[10px] font-mono text-muted-foreground">фото для трансформации</div>
                </div>
                <button onClick={() => setAttached(null)} className="w-6 h-6 rounded hover:bg-background flex items-center justify-center text-muted-foreground hover:text-foreground transition">
                  <Icon name="X" size={12} />
                </button>
              </div>
            )}
            <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
            <div className="bg-secondary border border-border rounded-xl p-2.5 focus-within:border-purple-500/50 transition-all">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={attached ? "Что сделать с фото? Например: «на фоне гор»" : "Опишите сайт, изображение, видео или музыку..."}
                rows={2}
                className="w-full bg-transparent text-sm placeholder:text-muted-foreground resize-none focus:outline-none"
                disabled={busy}
              />
              <div className="flex items-center justify-between mt-1.5">
                <div className="flex gap-1">
                  <button
                    onClick={() => photoRef.current?.click()}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition ${
                      attached ? "bg-purple-500/20 text-purple-400" : "hover:bg-background text-muted-foreground hover:text-foreground"
                    }`}
                    title="Фото"
                  >
                    <Icon name="Camera" size={14} />
                  </button>
                  <button
                    onClick={() => setInput((v) => (v ? v + " " : "") + "сгенерируй изображение ")}
                    className="w-7 h-7 rounded-lg hover:bg-background flex items-center justify-center text-muted-foreground hover:text-foreground transition"
                    title="Картинка"
                  >
                    <Icon name="Image" size={14} />
                  </button>
                  <button
                    onClick={() => setInput((v) => (v ? v + " " : "") + "создай музыку ")}
                    className="w-7 h-7 rounded-lg hover:bg-background flex items-center justify-center text-muted-foreground hover:text-foreground transition"
                    title="Музыка"
                  >
                    <Icon name="Music" size={14} />
                  </button>
                  <button
                    onClick={() => setInput((v) => (v ? v + " " : "") + "сгенерируй видео ")}
                    className="w-7 h-7 rounded-lg hover:bg-background flex items-center justify-center text-muted-foreground hover:text-foreground transition"
                    title="Видео"
                  >
                    <Icon name="Film" size={14} />
                  </button>
                </div>
                <button
                  onClick={send}
                  disabled={busy || (!input.trim() && !attached)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-500 to-orange-500 text-black text-xs font-bold hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Icon name="Send" size={12} />
                  За работу
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* PREVIEW RIGHT */}
        <div className="bg-card border border-border rounded-2xl flex flex-col overflow-hidden">
          {/* Source Indicator Bar */}
          <SourceBar meta={meta} fileCount={Object.keys(files).length} onReset={onResetAll} />
          <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500/40" />
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/40" />
                <span className="w-2.5 h-2.5 rounded-full bg-green-500/40" />
              </div>
              <div className="ml-3 flex-1 min-w-0 font-mono text-xs text-muted-foreground truncate">
                muravey.app/проекты/{previewHtml ? "активный" : "новый"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex p-0.5 rounded-lg bg-secondary border border-border">
                <button onClick={() => setDevice("desktop")} className={`px-2 py-1 rounded-md transition ${device === "desktop" ? "bg-foreground text-background" : "text-muted-foreground"}`}>
                  <Icon name="Monitor" size={13} />
                </button>
                <button onClick={() => setDevice("mobile")} className={`px-2 py-1 rounded-md transition ${device === "mobile" ? "bg-foreground text-background" : "text-muted-foreground"}`}>
                  <Icon name="Smartphone" size={13} />
                </button>
              </div>
              <button
                onClick={() => {
                  if (!previewHtml) return toast.error("Сайт пока пустой");
                  const w = window.open();
                  if (w) { w.document.write(previewHtml); w.document.close(); }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary border border-border text-xs font-medium hover:bg-foreground hover:text-background transition"
              >
                <Icon name="ExternalLink" size={12} />
                Открыть сайт
              </button>
            </div>
          </div>

          <div className="flex-1 bg-secondary/30 flex items-center justify-center p-4 overflow-hidden">
            <div className={`bg-background border border-border rounded-xl h-full transition-all duration-500 ${
              device === "mobile" ? "w-[380px] max-w-full" : "w-full"
            } overflow-hidden relative`}>
              {previewHtml ? (
                <>
                  <iframe
                    title="превью"
                    srcDoc={previewHtml}
                    sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-popups allow-popups-to-escape-sandbox"
                    className="w-full h-full border-0 bg-white"
                  />
                  {busy && (
                    <div className="absolute inset-0 bg-background/85 backdrop-blur-sm flex flex-col items-center justify-center animate-fade-up">
                      <AntTyping size={140} />
                      <div className="mt-6 text-center">
                        <h3 className="font-heading text-2xl text-gradient mb-1">Муравей за работой</h3>
                        <p className="text-sm font-mono text-muted-foreground">
                          печатает код<span className="animate-cursor">|</span>
                        </p>
                      </div>
                    </div>
                  )}
                </>
              ) : busy ? (
                <div className="w-full h-full flex flex-col items-center justify-center text-center p-8 relative">
                  <div className="absolute inset-0 grid-bg opacity-40" />
                  <div className="relative z-10">
                    <AntTyping size={160} />
                    <h3 className="font-heading text-3xl text-gradient mt-6 mb-1">Муравей за работой</h3>
                    <p className="text-sm font-mono text-muted-foreground">
                      печатает ваш сайт<span className="animate-cursor">|</span>
                    </p>
                  </div>
                </div>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-center p-8 relative">
                  <div className="absolute inset-0 grid-bg opacity-40" />
                  <div className="relative z-10 max-w-md">
                    <div className="mb-4 flex justify-center"><AntTyping size={110} /></div>
                    <h3 className="font-heading text-3xl mb-2 text-gradient">Готов к работе</h3>
                    <p className="text-sm text-muted-foreground mb-6">
                      Напишите запрос в чат слева. Ваш сайт появится здесь в реальном времени.
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {["Лендинг", "Магазин", "Портфолио", "Блог"].map((s) => (
                        <button
                          key={s}
                          onClick={() => setInput(`Сделай красивый ${s.toLowerCase()} с современным дизайном`)}
                          className="px-3 py-1.5 rounded-full bg-secondary border border-border text-xs hover:border-purple-500/50 hover:text-foreground text-muted-foreground transition"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Console (errors / logs from iframe) */}
          <ConsolePanel logs={logs} open={consoleOpen} onToggle={() => setConsoleOpen(!consoleOpen)} onClear={() => setLogs([])} />
        </div>
      </div>
    </div>
  );
}

// ─── Source Indicator Bar ─────────────────────────────────────────────────────
function SourceBar({ meta, fileCount, onReset }: { meta: ProjectMeta; fileCount: number; onReset: () => void }) {
  const map: Record<ProjectMeta["source"], { icon: string; color: string; tone: string }> = {
    zip: { icon: "FolderArchive", color: "text-orange-400 border-orange-500/40 bg-orange-500/5", tone: "ZIP" },
    generated: { icon: "Hammer", color: "text-purple-400 border-purple-500/40 bg-purple-500/5", tone: "Новая генерация" },
    "self-edit": { icon: "Bot", color: "text-green-400 border-green-500/40 bg-green-500/5", tone: "Саморедактирование Core" },
    empty: { icon: "Inbox", color: "text-muted-foreground border-border bg-secondary/40", tone: "пусто" },
  };
  const cur = map[meta.source];

  // Точный формат из ТЗ: 📁 Проект: [Название] | Файлов: [N]
  const projectName =
    meta.source === "zip" ? `${meta.name || "ZIP"}.zip` :
    meta.source === "generated" ? "Новая генерация" :
    meta.source === "self-edit" ? (meta.name ? `${meta.name}.zip` : "Core") :
    "—";

  return (
    <div className={`px-4 py-2.5 border-b border-border flex items-center justify-between gap-2 text-xs ${cur.color}`}>
      <div className="flex items-center gap-3 min-w-0 font-mono">
        <Icon name={cur.icon} fallback="Inbox" size={14} />
        <span className="truncate">📁 Проект: <b className="font-semibold">{projectName}</b></span>
        <span className="opacity-50">|</span>
        <span className="whitespace-nowrap">Файлов: <b className="font-semibold">{fileCount}</b></span>
        {meta.source !== "empty" && (
          <span className="hidden md:inline-flex opacity-50">· режим: {cur.tone}</span>
        )}
      </div>
      <button
        onClick={onReset}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition font-medium"
        title="Полностью очистить проект"
      >
        <Icon name="Trash2" size={11} />
        Сброс
      </button>
    </div>
  );
}

// ─── Console Panel ────────────────────────────────────────────────────────────
function ConsolePanel({
  logs, open, onToggle, onClear,
}: { logs: { level: string; msg: string; ts: number }[]; open: boolean; onToggle: () => void; onClear: () => void }) {
  const errs = logs.filter((l) => l.level === "error").length;
  const warns = logs.filter((l) => l.level === "warn").length;
  return (
    <div className="border-t border-border bg-background/50">
      <button
        onClick={onToggle}
        className="w-full px-4 py-2 flex items-center justify-between text-xs font-mono hover:bg-secondary/40 transition"
      >
        <div className="flex items-center gap-3">
          <Icon name={open ? "ChevronDown" : "ChevronRight"} size={12} />
          <span className="font-medium">Console</span>
          {errs > 0 && <span className="text-red-400">● {errs} err</span>}
          {warns > 0 && <span className="text-yellow-400">● {warns} warn</span>}
          {errs === 0 && warns === 0 && <span className="text-green-500/70">● ok</span>}
        </div>
        <div className="flex items-center gap-2">
          <span
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="px-2 py-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
          >
            очистить
          </span>
          <span className="text-muted-foreground">{logs.length}</span>
        </div>
      </button>
      {open && (
        <div className="max-h-40 overflow-y-auto scrollbar-thin px-4 py-2 font-mono text-[11px] space-y-0.5">
          {logs.length === 0 ? (
            <div className="text-muted-foreground italic">Логи появятся здесь при ошибках в превью...</div>
          ) : (
            logs.map((l, i) => (
              <div
                key={i}
                className={
                  l.level === "error" ? "text-red-400" :
                  l.level === "warn" ? "text-yellow-400" :
                  "text-muted-foreground"
                }
              >
                <span className="opacity-50">[{new Date(l.ts).toLocaleTimeString()}]</span> {l.msg}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Core Tab ─────────────────────────────────────────────────────────────────
function CoreTab() {
  const { isOwner } = useAuth();
  const [sub, setSub] = useState<CoreTab>(isOwner ? "ai" : "logs");

  const { pendingCount, totalUnread } = useSupport();
  const subTabs: { id: CoreTab; label: string; icon: string; owner?: boolean; badge?: number }[] = [
    { id: "ai", label: "Движок", icon: "Brain", owner: true },
    { id: "github", label: "GitHub", icon: "Github" },
    { id: "payments", label: "Платежи", icon: "CreditCard", owner: true },
    { id: "system", label: "Система", icon: "Settings", owner: true },
    { id: "logs", label: "Логи", icon: "ScrollText" },
    { id: "users", label: "Пользователи", icon: "Users", owner: true },
    { id: "dialogs", label: "Диалоги", icon: "MessagesSquare", badge: totalUnread || pendingCount },
    { id: "integrations", label: "Интеграции", icon: "Plug", owner: true },
  ].filter((t) => !t.owner || isOwner);

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 pt-6 animate-fade-up">
      <div className="mb-6">
        <div className="font-mono text-xs text-muted-foreground mb-1">/ админ / мозг</div>
        <h1 className="font-heading text-4xl">Панель мозга</h1>
        <p className="text-muted-foreground text-sm mt-1">Настройки движка, интеграций и системы</p>
      </div>

      <div className="flex gap-1 p-1 bg-card border border-border rounded-xl mb-6 overflow-x-auto scrollbar-hide">
        {subTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setSub(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              sub === t.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            <Icon name={t.icon} fallback="Circle" size={14} />
            <span className="font-heading uppercase tracking-wider text-xs">{t.label}</span>
            {t.badge ? (
              <span className="min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{t.badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      {sub === "ai" && isOwner && <AIPanel />}
      {sub === "github" && <GitHubPanel />}
      {sub === "payments" && isOwner && <PaymentsPanel />}
      {sub === "system" && isOwner && <SystemPanel />}
      {sub === "logs" && <LogsPanel />}
      {sub === "users" && isOwner && <UsersPanel />}
      {sub === "dialogs" && <DialogsPanel />}
      {sub === "integrations" && isOwner && <IntegrationsPanel />}
    </div>
  );
}

function AIPanel() {
  const [s, set] = useSettings();
  const providers: AiProvider[] = ["DeepSeek", "Claude", "OpenAI"];

  function setProviderField(p: AiProvider, key: "apiKey" | "baseUrl" | "model", value: string) {
    set((c) => ({
      ...c,
      ai: { ...c.ai, providers: { ...c.ai.providers, [p]: { ...c.ai.providers[p], [key]: value } } },
    }));
  }

  function pickActive(p: AiProvider) {
    set((c) => ({ ...c, ai: { ...c.ai, activeProvider: p } }));
  }

  function resetProvider(p: AiProvider) {
    set((c) => ({
      ...c,
      ai: { ...c.ai, providers: { ...c.ai.providers, [p]: { ...PROVIDER_DEFAULTS[p], apiKey: c.ai.providers[p].apiKey } } },
    }));
    toast.success(`${p}: Base URL и модель сброшены`);
  }

  function pickPreset(preset: PromptPreset) {
    const map = { designer: DESIGNER_PROMPT, engineer: ENGINEER_PROMPT, custom: s.ai.customPrompt || s.ai.systemPrompt };
    set((c) => ({
      ...c,
      ai: { ...c.ai, promptPreset: preset, systemPrompt: map[preset] },
    }));
  }

  function pickImageEngine(eng: keyof typeof IMAGE_ENGINE_DEFAULTS) {
    const d = IMAGE_ENGINE_DEFAULTS[eng];
    set((c) => ({ ...c, ai: { ...c.ai, image: { ...c.ai.image, engine: eng, baseUrl: d.baseUrl, model: d.model } } }));
  }

  function pickMediaEngine(eng: keyof typeof MEDIA_ENGINE_DEFAULTS) {
    const d = MEDIA_ENGINE_DEFAULTS[eng];
    set((c) => ({ ...c, ai: { ...c.ai, media: { ...c.ai.media, engine: eng, baseUrl: d.baseUrl, videoModel: d.videoModel, audioModel: d.audioModel } } }));
  }

  async function testConnection() {
    try {
      const s = getSettings(); // get fresh settings
      toast.loading(`Проверяем ${s.ai.activeProvider}...`, { id: "test" });
      await callLlmOnce([{ role: "user", content: "Скажи коротко: «Подключение работает»." }]);
      toast.success("Подключение работает", { id: "test" });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Не удалось", { id: "test" });
    }
  }

  return (
    <div className="space-y-4 animate-fade-up">
      <Card title="Активный мозг" accent="purple">
        <div className="grid grid-cols-3 gap-2">
          {providers.map((p) => {
            const cfg = s.ai.providers[p];
            const ready = !!cfg.apiKey;
            const active = s.ai.activeProvider === p;
            return (
              <button
                key={p}
                onClick={() => pickActive(p)}
                className={`flex flex-col items-start gap-1 px-3 py-3 rounded-xl border text-left transition ${
                  active ? "bg-purple-500/10 border-purple-500/60 text-purple-300" : "bg-secondary border-border hover:border-purple-500/30"
                }`}
              >
                <div className="flex items-center gap-2 w-full">
                  <Icon name={p === "DeepSeek" ? "Cpu" : p === "Claude" ? "Sparkles" : "Bot"} size={14} />
                  <span className="font-medium text-sm">{p}</span>
                  <span className={`ml-auto w-1.5 h-1.5 rounded-full ${ready ? "bg-green-500" : "bg-red-500/60"}`} />
                </div>
                <div className="font-mono text-[10px] text-muted-foreground truncate w-full">{cfg.model}</div>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-3 font-mono">↑ Активный мозг используется в чате. Ниже — индивидуальные настройки каждого.</p>
      </Card>

      {providers.map((p) => {
        const cfg = s.ai.providers[p];
        const isActive = s.ai.activeProvider === p;
        return (
          <Card
            key={p}
            title={`${p} · конфиг`}
            accent={p === "Claude" ? "orange" : "purple"}
            badge={isActive ? "АКТИВЕН" : undefined}
          >
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="API Key">
                <Input value={cfg.apiKey} onChange={(v) => setProviderField(p, "apiKey", v)} placeholder={p === "OpenAI" ? "sk-..." : p === "Claude" ? "sk-ant-..." : "sk-..."} type="password" mono />
              </Field>
              <Field label="Base URL" hint="Адрес API или российский прокси-шлюз">
                <Input value={cfg.baseUrl} onChange={(v) => setProviderField(p, "baseUrl", v)} placeholder={PROVIDER_DEFAULTS[p].baseUrl} mono />
              </Field>
              <Field label="Модель">
                <div className="flex gap-2">
                  <select
                    value={cfg.model}
                    onChange={(e) => setProviderField(p, "model", e.target.value)}
                    className="flex-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:border-purple-500/50 focus:outline-none"
                  >
                    {MODELS_BY_PROVIDER[p].map((m) => <option key={m} value={m}>{m}</option>)}
                    {!MODELS_BY_PROVIDER[p].includes(cfg.model) && <option value={cfg.model}>{cfg.model} (кастом)</option>}
                  </select>
                </div>
              </Field>
              <div className="flex items-end">
                <button onClick={() => resetProvider(p)} className="text-xs text-muted-foreground hover:text-foreground underline">
                  Сбросить URL и модель к дефолту
                </button>
              </div>
            </div>
          </Card>
        );
      })}

      <Card title="Температура" accent="orange">
        <Field label="Креативность" hint="0 — точно, 1 — творчески">
          <Input value={s.ai.temperature} onChange={(v) => set((c) => ({ ...c, ai: { ...c.ai, temperature: v } }))} placeholder="0.7" mono />
        </Field>
      </Card>

      <Card title="Image API · Фото" accent="purple" badge="🇷🇺 поддерживается">
        <Field label="Движок">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-1.5">
            {(Object.keys(IMAGE_ENGINE_DEFAULTS) as Array<keyof typeof IMAGE_ENGINE_DEFAULTS>).map((eng) => (
              <button
                key={eng}
                onClick={() => pickImageEngine(eng)}
                className={`px-2 py-2 rounded-lg text-[11px] font-medium border transition ${
                  s.ai.image.engine === eng ? "bg-purple-500/10 border-purple-500/50 text-purple-300" : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {IMAGE_ENGINE_DEFAULTS[eng].label}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <Field label="API Key">
            <Input value={s.ai.image.apiKey} onChange={(v) => set((c) => ({ ...c, ai: { ...c.ai, image: { ...c.ai.image, apiKey: v } } }))} placeholder={s.ai.image.engine === "kandinsky" ? "X-Key:X-Secret" : "ключ"} type="password" mono />
          </Field>
          <Field label="Endpoint URL">
            <Input value={s.ai.image.baseUrl} onChange={(v) => set((c) => ({ ...c, ai: { ...c.ai, image: { ...c.ai.image, baseUrl: v } } }))} placeholder="https://..." mono />
          </Field>
          <Field label="Модель">
            <Input value={s.ai.image.model} onChange={(v) => set((c) => ({ ...c, ai: { ...c.ai, image: { ...c.ai.image, model: v } } }))} placeholder={IMAGE_ENGINE_DEFAULTS[s.ai.image.engine].model} mono />
          </Field>
          {s.ai.image.engine === "yandexart" && (
            <Field label="Yandex Folder ID">
              <Input value={s.ai.image.folderId} onChange={(v) => set((c) => ({ ...c, ai: { ...c.ai, image: { ...c.ai.image, folderId: v } } }))} placeholder="b1g..." mono />
            </Field>
          )}
        </div>
      </Card>

      <Card title="Video / Audio API" accent="orange" badge="Suno / Luma">
        <Field label="Движок">
          <div className="flex gap-1.5">
            {(Object.keys(MEDIA_ENGINE_DEFAULTS) as Array<keyof typeof MEDIA_ENGINE_DEFAULTS>).map((eng) => (
              <button
                key={eng}
                onClick={() => pickMediaEngine(eng)}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition ${
                  s.ai.media.engine === eng ? "bg-orange-500/10 border-orange-500/50 text-orange-300" : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {MEDIA_ENGINE_DEFAULTS[eng].label}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <Field label="API Key">
            <Input value={s.ai.media.apiKey} onChange={(v) => set((c) => ({ ...c, ai: { ...c.ai, media: { ...c.ai.media, apiKey: v } } }))} placeholder="ключ" type="password" mono />
          </Field>
          <Field label="Endpoint URL">
            <Input value={s.ai.media.baseUrl} onChange={(v) => set((c) => ({ ...c, ai: { ...c.ai, media: { ...c.ai.media, baseUrl: v } } }))} placeholder="https://..." mono />
          </Field>
          <Field label="Модель видео">
            <Input value={s.ai.media.videoModel} onChange={(v) => set((c) => ({ ...c, ai: { ...c.ai, media: { ...c.ai.media, videoModel: v } } }))} placeholder="luma/ray-flash-2" mono />
          </Field>
          <Field label="Модель аудио">
            <Input value={s.ai.media.audioModel} onChange={(v) => set((c) => ({ ...c, ai: { ...c.ai, media: { ...c.ai.media, audioModel: v } } }))} placeholder="suno/bark" mono />
          </Field>
        </div>
      </Card>

      <Card title="Поиск в сети · 🇷🇺 без западных API" accent="orange" badge={s.ai.search.enabled ? "ВКЛ" : "ВЫКЛ"}>
        <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
          Муравей сам решает, когда искать: только при вопросах о свежих версиях библиотек, точном тексте ошибок или актуальной документации. Для обычной генерации сайтов поиск не используется.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Состояние">
            <div className="flex gap-1.5">
              {[
                { id: true, label: "Включён" },
                { id: false, label: "Выключен" },
              ].map((opt) => (
                <button
                  key={String(opt.id)}
                  onClick={() => set((c) => ({ ...c, ai: { ...c.ai, search: { ...c.ai.search, enabled: opt.id } } }))}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition ${
                    s.ai.search.enabled === opt.id ? "bg-orange-500/10 border-orange-500/50 text-orange-300" : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                  }`}
                >{opt.label}</button>
              ))}
            </div>
          </Field>
          <Field label="Поисковый движок">
            <div className="flex gap-1.5">
              {([
                { id: "auto", label: "Авто" },
                { id: "duckduckgo", label: "DuckDuckGo" },
                { id: "yandex", label: "Yandex 🇷🇺" },
              ] as const).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => set((c) => ({ ...c, ai: { ...c.ai, search: { ...c.ai.search, engine: opt.id } } }))}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition ${
                    s.ai.search.engine === opt.id ? "bg-orange-500/10 border-orange-500/50 text-orange-300" : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                  }`}
                >{opt.label}</button>
              ))}
            </div>
          </Field>
          <Field label="Yandex Folder ID" hint="Только для Yandex Search API">
            <Input value={s.ai.search.yandexFolderId} onChange={(v) => set((c) => ({ ...c, ai: { ...c.ai, search: { ...c.ai.search, yandexFolderId: v } } }))} placeholder="b1g..." mono />
          </Field>
          <Field label="Yandex API Key">
            <Input value={s.ai.search.yandexApiKey} onChange={(v) => set((c) => ({ ...c, ai: { ...c.ai, search: { ...c.ai.search, yandexApiKey: v } } }))} placeholder="AQVN..." type="password" mono />
          </Field>
        </div>
        <div className="mt-3 flex items-center justify-between p-3 rounded-lg bg-secondary border border-border">
          <div>
            <div className="text-sm font-medium">Авто-режим</div>
            <div className="text-[11px] text-muted-foreground">Муравей сам зовёт поиск, когда не уверен в актуальности</div>
          </div>
          <button
            onClick={() => set((c) => ({ ...c, ai: { ...c.ai, search: { ...c.ai.search, autoMode: !c.ai.search.autoMode } } }))}
            className={`w-11 h-6 rounded-full transition relative ${s.ai.search.autoMode ? "bg-orange-500" : "bg-border"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${s.ai.search.autoMode ? "translate-x-5" : ""}`} />
          </button>
        </div>
      </Card>

      <Card title="Мастер-промпт · поведение ИИ" accent="purple" badge={s.ai.promptPreset.toUpperCase()}>
        <div className="flex gap-1.5 mb-3">
          {([
            { id: "designer", label: "🎨 Дизайнер", desc: "Красивые сайты с нуля" },
            { id: "engineer", label: "🔧 Инженер-хирург", desc: "Точечные правки кода" },
            { id: "custom", label: "✍ Свой", desc: "Полностью кастомный" },
          ] as { id: PromptPreset; label: string; desc: string }[]).map((p) => (
            <button
              key={p.id}
              onClick={() => pickPreset(p.id)}
              title={p.desc}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition ${
                s.ai.promptPreset === p.id ? "bg-purple-500/10 border-purple-500/50 text-purple-300" : "bg-secondary border-border text-muted-foreground hover:text-foreground"
              }`}
            >{p.label}</button>
          ))}
        </div>
        <textarea
          rows={12}
          value={s.ai.systemPrompt}
          onChange={(e) => set((c) => ({
            ...c,
            ai: { ...c.ai, systemPrompt: e.target.value, customPrompt: c.ai.promptPreset === "custom" ? e.target.value : c.ai.customPrompt },
          }))}
          className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-sm font-mono leading-relaxed focus:border-purple-500/50 focus:outline-none resize-y"
        />
        <p className="text-[11px] text-muted-foreground mt-2 font-mono">
          {s.ai.systemPrompt.length} символов · переключатели сверху меняют ВЕСЬ текст инструкции
        </p>
      </Card>

      <div className="flex justify-end gap-2 sticky bottom-2 bg-background/80 backdrop-blur py-2 -mx-2 px-2 rounded-xl">
        <button onClick={testConnection} className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-secondary transition">Проверить подключение</button>
        <button onClick={() => toast.success("Настройки сохранены")} className="px-5 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-orange-500 text-black text-sm font-bold hover:opacity-90 transition">Сохранить настройки</button>
      </div>
    </div>
  );
}

function GitHubPanel() {
  const [s, set] = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onZipUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      toast.loading("🔍 Анализ структуры ZIP...", { id: "zip" });
      const files = await importZip(file);
      const count = Object.keys(files).length;
      // мета уже сохранена внутри importZip
      toast.success(`💉 Virtual mount: ${count} файлов смонтировано. Превью обновлено.`, { id: "zip" });
      window.dispatchEvent(new Event("muravey:project-updated"));

      // Авто-анализ зависимостей: ищем package.json и предлагаем поиск
      const pkgEntry = Object.entries(files).find(([k]) => k.toLowerCase().endsWith("package.json"));
      if (pkgEntry) {
        const deps = parsePackageDeps(pkgEntry[1]);
        if (deps.length > 0) {
          const top = deps.slice(0, 5).join(", ");
          if (getSettings().ai.search.enabled) {
            toast.info(`📦 Найдено ${deps.length} зависимостей: ${top}${deps.length > 5 ? "..." : ""}. Муравей сможет гуглить их документацию по запросу.`, { duration: 6000 });
          }
        }
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Ошибка распаковки", { id: "zip" });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onZipDownload() {
    const files = loadFiles();
    if (Object.keys(files).length === 0) {
      toast.error("Проект пуст. Сгенерируйте сайт в чате.");
      return;
    }
    await exportZip(files);
    toast.success("Архив скачан");
  }

  async function onCommit() {
    const files = loadFiles();
    if (Object.keys(files).length === 0) return toast.error("Проект пуст");
    setBusy(true);
    try {
      toast.loading("Отправляем в GitHub...", { id: "gh" });
      const sha = await commitToGitHub(files);
      toast.success(`Коммит создан: ${sha.slice(0, 7)}`, { id: "gh" });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Ошибка коммита", { id: "gh" });
    } finally {
      setBusy(false);
    }
  }

  async function onCheck() {
    try {
      toast.loading("Проверяем токен...", { id: "ghc" });
      const u = await pingGitHub();
      toast.success(`Подключено: @${u.login}`, { id: "ghc" });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Не удалось", { id: "ghc" });
    }
  }

  return (
    <div className="space-y-4 animate-fade-up">
      <Card title="Репозиторий" accent="purple">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Токен GitHub">
            <Input value={s.github.token} onChange={(v) => set((c) => ({ ...c, github: { ...c.github, token: v } }))} placeholder="ghp_..." type="password" mono />
          </Field>
          <Field label="Путь к репозиторию">
            <Input value={s.github.repo} onChange={(v) => set((c) => ({ ...c, github: { ...c.github, repo: v } }))} placeholder="пользователь/репо" mono />
          </Field>
          <Field label="Адрес сайта">
            <Input value={s.github.siteUrl} onChange={(v) => set((c) => ({ ...c, github: { ...c.github, siteUrl: v } }))} placeholder="https://мой-сайт.ru" mono />
          </Field>
          <Field label="Ветка">
            <Input value={s.github.branch} onChange={(v) => set((c) => ({ ...c, github: { ...c.github, branch: v } }))} placeholder="main" mono />
          </Field>
          <Field label="CORS-прокси (необязательно)" hint="Шаблон с {url} или с ? в конце. Пусто = прямой + автофолбэки">
            <Input value={s.github.proxy} onChange={(v) => set((c) => ({ ...c, github: { ...c.github, proxy: v } }))} placeholder="https://corsproxy.io/?  или  https://my-proxy.ru/{url}" mono />
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCheck}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm hover:bg-secondary transition"
          >
            <Icon name="Stethoscope" size={14} />
            Проверить токен
          </button>
          <button
            onClick={onCommit}
            disabled={busy}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-orange-500 text-black text-sm font-bold hover:opacity-90 transition disabled:opacity-50"
          >
            <Icon name="GitCommit" size={14} />
            В GitHub
          </button>
        </div>
      </Card>

      <Card title="ZIP-движок" accent="orange" badge="Только админ">
        <p className="text-xs text-muted-foreground mb-4">Импорт и экспорт проекта одним архивом. Файлы распаковываются в память браузера и попадают в контекст ИИ.</p>
        <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={onZipUpload} />
        <div className="grid md:grid-cols-2 gap-3">
          <button onClick={() => fileRef.current?.click()} className="group flex items-center gap-3 p-4 rounded-xl border border-dashed border-border hover:border-orange-500/50 hover:bg-orange-500/5 transition text-left">
            <div className="w-10 h-10 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center group-hover:scale-105 transition">
              <Icon name="Upload" size={16} className="text-orange-500" />
            </div>
            <div className="flex-1">
              <div className="font-medium text-sm">Загрузить .zip</div>
              <div className="text-xs text-muted-foreground font-mono">→ распаковать в контекст ИИ</div>
            </div>
          </button>
          <button onClick={onZipDownload} className="group flex items-center gap-3 p-4 rounded-xl border border-dashed border-border hover:border-purple-500/50 hover:bg-purple-500/5 transition text-left">
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center group-hover:scale-105 transition">
              <Icon name="Download" size={16} className="text-purple-500" />
            </div>
            <div className="flex-1">
              <div className="font-medium text-sm">Скачать .zip</div>
              <div className="text-xs text-muted-foreground font-mono">→ выгрузить текущую сборку</div>
            </div>
          </button>
        </div>
      </Card>
    </div>
  );
}

function PaymentsPanel() {
  const [s, set] = useSettings();

  return (
    <div className="space-y-4 animate-fade-up">
      <Card title="Интеграция Т-Банк" accent="orange">
        <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-orange-500/5 border border-orange-500/20">
          <div className="w-9 h-9 rounded-lg bg-orange-500 flex items-center justify-center text-black font-bold">Т</div>
          <div>
            <div className="font-medium text-sm">Т-Банк Бизнес</div>
            <div className="text-xs text-muted-foreground">Эквайринг и СБП</div>
          </div>
          <span className={`ml-auto text-xs px-2 py-0.5 rounded-full border ${
            s.payments.terminalKey ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-muted text-muted-foreground border-border"
          }`}>{s.payments.terminalKey ? "Активно" : "Не настроено"}</span>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Ключ терминала">
            <Input value={s.payments.terminalKey} onChange={(v) => set((c) => ({ ...c, payments: { ...c.payments, terminalKey: v } }))} placeholder="1234567890DEMO" mono />
          </Field>
          <Field label="Пароль">
            <Input value={s.payments.password} onChange={(v) => set((c) => ({ ...c, payments: { ...c.payments, password: v } }))} placeholder="••••••••••" type="password" mono />
          </Field>
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={() => toast.success("Данные платёжной системы сохранены")} className="px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90 transition">
            Сохранить
          </button>
        </div>
      </Card>

      <Card title="СБП — Быстрые платежи" accent="purple">
        <div className="grid md:grid-cols-[200px_1fr] gap-6 items-start">
          <div className="aspect-square rounded-xl border border-border bg-secondary p-4 flex items-center justify-center">
            <div className="grid grid-cols-8 gap-0.5 w-full h-full">
              {Array.from({ length: 64 }).map((_, i) => (
                <div key={i} className={`rounded-[1px] ${(i * 37) % 5 < 3 ? "bg-foreground" : "bg-transparent"}`} />
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <div className="text-xs text-muted-foreground font-mono mb-1">QR · Пополнение токенов</div>
              <div className="font-heading text-3xl">990 ₽ → 5 000 токенов</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { set((c) => ({ ...c, tokens: c.tokens + 5000 })); toast.success("Зачислено 5 000 токенов"); }}
                className="px-3 py-2 rounded-lg bg-secondary border border-border text-xs hover:bg-foreground hover:text-background transition"
              >Симулировать оплату</button>
              <button
                onClick={() => { navigator.clipboard.writeText("https://qr.nspk.ru/demo-muravey"); toast.success("Ссылка скопирована"); }}
                className="px-3 py-2 rounded-lg bg-secondary border border-border text-xs hover:bg-foreground hover:text-background transition"
              >Копировать ссылку</button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function SystemPanel() {
  const [s, set] = useSettings();
  const [sql, setSql] = useState("");
  const [appKeyName, setAppKeyName] = useState("");
  const [appKeyVal, setAppKeyVal] = useState("");

  async function onPingSupabase() {
    try {
      toast.loading("Проверяем Supabase...", { id: "sb" });
      await pingSupabase();
      toast.success("Supabase подключён", { id: "sb" });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Ошибка", { id: "sb" });
    }
  }

  async function onApplySql() {
    if (!sql.trim()) return toast.error("Введите SQL");
    try {
      toast.loading("[Система] Применение SQL...", { id: "sql" });
      await applySql(sql);
      toast.success("Схема применена", { id: "sql" });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Ошибка", { id: "sql" });
    }
  }

  function addAppKey() {
    if (!appKeyName.trim()) return toast.error("Укажите имя ключа");
    set((c) => ({ ...c, appKeys: { ...c.appKeys, [appKeyName.trim()]: appKeyVal } }));
    setAppKeyName(""); setAppKeyVal("");
    toast.success("Ключ приложения сохранён");
  }

  function removeAppKey(k: string) {
    set((c) => {
      const next = { ...c.appKeys };
      delete next[k];
      return { ...c, appKeys: next };
    });
  }

  return (
    <div className="space-y-4 animate-fade-up">
      <Card title="Supabase · БД и Авторизация" accent="purple" badge="Бэкенд">
        <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-purple-500/5 border border-purple-500/20">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-orange-500 flex items-center justify-center text-black font-bold">S</div>
          <div className="flex-1">
            <div className="font-medium text-sm">Supabase Backend</div>
            <div className="text-xs text-muted-foreground">PostgreSQL · Auth · Storage · RLS</div>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${
            s.supabase.url && s.supabase.anonKey ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-muted text-muted-foreground border-border"
          }`}>{s.supabase.url && s.supabase.anonKey ? "Подключено" : "Не настроено"}</span>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="SUPABASE_URL">
            <Input value={s.supabase.url} onChange={(v) => set((c) => ({ ...c, supabase: { ...c.supabase, url: v } }))} placeholder="https://xxxxx.supabase.co" mono />
          </Field>
          <Field label="SUPABASE_ANON_KEY">
            <Input value={s.supabase.anonKey} onChange={(v) => set((c) => ({ ...c, supabase: { ...c.supabase, anonKey: v } }))} placeholder="eyJhbGciOi..." type="password" mono />
          </Field>
          <Field label="SUPABASE_SERVICE_KEY (опц.)" hint="Только для применения SQL из админки">
            <Input value={s.supabase.serviceKey} onChange={(v) => set((c) => ({ ...c, supabase: { ...c.supabase, serviceKey: v } }))} placeholder="service_role..." type="password" mono />
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onPingSupabase} className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-secondary transition">
            Проверить подключение
          </button>
        </div>
      </Card>

      <Card title="SQL · Автогенерация схем" accent="orange">
        <p className="text-xs text-muted-foreground mb-3">
          Попросите в чате «создай таблицу пользователей с авторизацией» — ИИ выдаст SQL. Вставьте его сюда и примените одним кликом.
        </p>
        <textarea
          rows={6}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder={`-- Пример\nCREATE TABLE profiles (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  user_id uuid REFERENCES auth.users,\n  display_name text\n);\nALTER TABLE profiles ENABLE ROW LEVEL SECURITY;`}
          className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-xs font-mono leading-relaxed focus:border-orange-500/50 focus:outline-none resize-none"
        />
        <div className="mt-3 flex justify-end">
          <button onClick={onApplySql} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-orange-500 text-black text-sm font-bold hover:opacity-90 transition">
            <Icon name="Database" size={14} />
            Применить SQL
          </button>
        </div>
      </Card>

      <Card title="Ключи приложений · Sandbox" accent="purple" badge="Изолированы">
        <p className="text-xs text-muted-foreground mb-3">
          Генерируемые приложения хранят свои собственные API-ключи отдельно от мастер-ключей платформы. Доступ только через <code className="font-mono text-purple-400">window.__APP_KEYS__</code>.
        </p>
        <div className="space-y-2 mb-3">
          {Object.entries(s.appKeys).length === 0 && (
            <div className="text-xs text-muted-foreground italic">Пока нет ключей приложений</div>
          )}
          {Object.entries(s.appKeys).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 p-2 rounded-lg bg-secondary border border-border">
              <span className="font-mono text-xs text-purple-400">{k}</span>
              <span className="flex-1 font-mono text-xs text-muted-foreground truncate">{v.replace(/./g, "•").slice(0, 24)}</span>
              <button onClick={() => removeAppKey(k)} className="w-6 h-6 rounded hover:bg-background flex items-center justify-center text-muted-foreground hover:text-red-400 transition">
                <Icon name="X" size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="grid md:grid-cols-[1fr_2fr_auto] gap-2">
          <Input value={appKeyName} onChange={setAppKeyName} placeholder="STRIPE_KEY" mono />
          <Input value={appKeyVal} onChange={setAppKeyVal} placeholder="sk_test_..." type="password" mono />
          <button onClick={addAppKey} className="px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90 transition">
            Добавить
          </button>
        </div>
      </Card>

      <AccessControlCard />

      <Card title="Переключатели" accent="purple">
        <div className="space-y-3">
          <Toggle
            label="Режим самообновления"
            hint="Платформа может редактировать саму себя"
            on={s.system.selfEdit}
            setOn={(v) => set((c) => ({ ...c, system: { ...c.system, selfEdit: v } }))}
            color="purple"
          />
          <Toggle
            label="Открытый доступ к ИИ"
            hint="Публичный доступ к API ассистента"
            on={s.system.publicAi}
            setOn={(v) => set((c) => ({ ...c, system: { ...c.system, publicAi: v } }))}
            color="orange"
          />
        </div>
      </Card>

      <Card title="Опасная зона" accent="orange">
        <div className="flex items-center justify-between gap-4 p-3 rounded-lg border border-red-500/20 bg-red-500/5">
          <div>
            <div className="font-medium text-sm">Сброс баланса</div>
            <div className="text-xs text-muted-foreground">Сбросить счётчик токенов до 0</div>
          </div>
          <button
            onClick={() => { set((c) => ({ ...c, tokens: 0 })); toast.success("Баланс обнулён"); }}
            className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-medium hover:bg-red-500/20 transition"
          >Сбросить</button>
        </div>
      </Card>
    </div>
  );
}

// ─── Access Control / Owners / Moderators ────────────────────────────────────
function AccessControlCard() {
  const { ownerEmail, moderators } = useAuth();
  const [newMod, setNewMod] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const envOwner = (import.meta.env.VITE_ADMIN_EMAIL || import.meta.env.NEXT_PUBLIC_ADMIN_EMAIL || "") as string;

  return (
    <Card title="Доступ и роли" accent="orange" badge="Owner-only">
      <div className="grid md:grid-cols-2 gap-5">
        <div>
          <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Владелец (Superadmin)</div>
          <div className="flex items-center gap-2 p-3 rounded-lg bg-orange-500/5 border border-orange-500/20">
            <Icon name="Crown" size={14} className="text-orange-400" />
            <span className="font-mono text-sm truncate flex-1">{ownerEmail || "не задан"}</span>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground mt-2 leading-relaxed">
            {envOwner
              ? <>Источник: ENV <code className="text-purple-400">VITE_ADMIN_EMAIL</code></>
              : <>Первый зарегистрированный аккаунт. Можно задать через ENV <code className="text-purple-400">VITE_ADMIN_EMAIL</code> в Vercel.</>}
          </div>

          <div className="mt-4">
            <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Передать права владельца</div>
            <div className="flex gap-2">
              <input
                value={newOwner}
                onChange={(e) => setNewOwner(e.target.value)}
                placeholder="email нового владельца"
                className="flex-1 bg-secondary border border-border rounded-lg px-3 py-2 text-xs font-mono focus:border-orange-500/50 focus:outline-none"
              />
              <button
                onClick={() => {
                  if (!confirm("Передать права владельца? Текущий аккаунт станет обычным пользователем.")) return;
                  try { transferOwnership(newOwner); setNewOwner(""); toast.success("Права переданы"); }
                  catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
                }}
                className="px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/30 text-orange-400 text-xs font-medium hover:bg-orange-500/20 transition"
              >
                Передать
              </button>
            </div>
          </div>
        </div>

        <div>
          <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Список администраторов (Moderator)</div>
          <div className="space-y-1.5 mb-3 max-h-44 overflow-y-auto scrollbar-thin">
            {moderators.length === 0 && <div className="text-xs text-muted-foreground italic px-1">Пока пусто</div>}
            {moderators.map((m) => (
              <div key={m} className="flex items-center gap-2 p-2 rounded-lg bg-secondary border border-border">
                <Icon name="Shield" size={12} className="text-purple-400" />
                <span className="font-mono text-xs truncate flex-1">{m}</span>
                <button
                  onClick={() => { removeModerator(m); toast.success("Удалён"); }}
                  className="w-6 h-6 rounded hover:bg-background flex items-center justify-center text-muted-foreground hover:text-red-400 transition"
                >
                  <Icon name="X" size={11} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newMod}
              onChange={(e) => setNewMod(e.target.value)}
              placeholder="email помощника"
              className="flex-1 bg-secondary border border-border rounded-lg px-3 py-2 text-xs font-mono focus:border-purple-500/50 focus:outline-none"
            />
            <button
              onClick={() => {
                try { addModerator(newMod); setNewMod(""); toast.success("Добавлен"); }
                catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
              }}
              className="px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-400 text-xs font-medium hover:bg-purple-500/20 transition"
            >
              Добавить
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── Logs Panel ──────────────────────────────────────────────────────────────
function LogsPanel() {
  const { auditLog } = useAuth();
  return (
    <div className="space-y-4 animate-fade-up">
      <Card title="Аудит запросов" accent="purple" badge={`${auditLog.length} записей`}>
        <div className="flex justify-end mb-3">
          <button
            onClick={() => { if (confirm("Очистить все логи?")) { clearAudit(); toast.success("Логи очищены"); } }}
            className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-secondary transition"
          >
            Очистить
          </button>
        </div>
        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto scrollbar-thin">
          {auditLog.length === 0 && <div className="text-xs text-muted-foreground italic p-3">Лог пуст</div>}
          {auditLog.map((e, i) => (
            <div key={i} className={`p-2.5 rounded-lg border text-xs font-mono flex items-start gap-3 ${
              e.blocked ? "bg-red-500/5 border-red-500/20" : "bg-secondary border-border"
            }`}>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap mt-0.5">
                {new Date(e.ts).toLocaleString("ru-RU")}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase whitespace-nowrap ${
                e.role === "superadmin" ? "bg-orange-500/10 text-orange-400" :
                e.role === "moderator" ? "bg-purple-500/10 text-purple-400" :
                "bg-muted text-muted-foreground"
              }`}>{e.role}</span>
              <span className="text-muted-foreground truncate min-w-0 flex-shrink-0 w-40">{e.email}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-background text-purple-300 whitespace-nowrap">{e.intent}</span>
              <span className={`flex-1 truncate ${e.blocked ? "text-red-400" : "text-foreground"}`}>
                {e.blocked ? `🚫 ${e.reason} · ` : ""}{e.text}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── Users Panel ─────────────────────────────────────────────────────────────
function UsersPanel() {
  const { accounts } = useAuth();
  const list = Object.values(accounts).sort((a, b) => b.createdAt - a.createdAt);
  const [editTokens, setEditTokens] = useState<Record<string, string>>({});

  return (
    <div className="space-y-4 animate-fade-up">
      <Card title="Пользователи" accent="orange" badge={`${list.length}`}>
        <div className="space-y-2 max-h-[65vh] overflow-y-auto scrollbar-thin">
          {list.length === 0 && <div className="text-xs text-muted-foreground italic p-3">Нет аккаунтов</div>}
          {list.map((a) => (
            <div key={a.id} className="p-3 rounded-lg bg-secondary border border-border">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-orange-500 flex items-center justify-center text-[10px] font-bold text-black">
                  {a.email.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm truncate">{a.email}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{new Date(a.createdAt).toLocaleString("ru-RU")} · ID {a.id.slice(0, 8)}</div>
                </div>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full uppercase ${
                  a.role === "superadmin" ? "bg-orange-500/10 text-orange-400 border border-orange-500/20" :
                  a.role === "moderator" ? "bg-purple-500/10 text-purple-400 border border-purple-500/20" :
                  "bg-muted text-muted-foreground border border-border"
                }`}>{a.role}</span>
                {a.banned && <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">BANNED</span>}
              </div>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1">
                  <Icon name="Coins" size={12} className="text-orange-500" />
                  <input
                    type="number"
                    value={editTokens[a.email] ?? a.tokens}
                    onChange={(e) => setEditTokens((p) => ({ ...p, [a.email]: e.target.value }))}
                    className="w-24 bg-background border border-border rounded px-2 py-1 text-xs font-mono"
                  />
                  <button
                    onClick={() => {
                      const v = parseInt(editTokens[a.email] ?? String(a.tokens), 10);
                      if (Number.isFinite(v)) { setTokensFor(a.email, v); toast.success("Баланс обновлён"); }
                    }}
                    className="px-2 py-1 text-[10px] rounded border border-border hover:bg-background transition"
                  >Применить</button>
                </div>
                <button
                  onClick={() => { banUser(a.email, !a.banned); toast.success(a.banned ? "Разблокирован" : "Заблокирован"); }}
                  className={`px-3 py-1 rounded text-[10px] font-mono uppercase tracking-wider transition ${
                    a.banned
                      ? "bg-green-500/10 text-green-400 border border-green-500/30"
                      : "bg-red-500/10 text-red-400 border border-red-500/30"
                  }`}
                >
                  {a.banned ? "Разблокировать" : "Заблокировать"}
                </button>
                <button
                  onClick={() => {
                    if (a.role === "superadmin") return toast.error("Сначала передайте права владельца");
                    if (!confirm(`Удалить ${a.email}?`)) return;
                    deleteUser(a.email);
                    toast.success("Удалён");
                  }}
                  className="px-3 py-1 rounded text-[10px] font-mono uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition"
                >
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── Dialogs Panel ───────────────────────────────────────────────────────────
function DialogsPanel() {
  const { threads } = useSupport();
  const [activeEmail, setActiveEmail] = useState<string | null>(threads[0]?.email || null);
  const [reply, setReply] = useState("");
  const active = threads.find((t) => t.email === activeEmail) || threads[0] || null;

  useEffect(() => {
    if (active) markReadForAdmin(active.email);
  }, [active?.email, active?.messages.length]);

  function sendReply() {
    if (!active || !reply.trim()) return;
    addMessage(active.email, "admin", reply.trim());
    setReply("");
    toast.success("Ответ отправлен");
  }

  return (
    <Card title="Диалоги поддержки" accent="orange" badge={`${threads.length}`}>
      <div className="grid md:grid-cols-[260px_1fr] gap-4 min-h-[60vh]">
        <div className="space-y-1.5 max-h-[65vh] overflow-y-auto scrollbar-thin">
          {threads.length === 0 && <div className="text-xs text-muted-foreground italic p-2">Диалогов пока нет</div>}
          {threads.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveEmail(t.email)}
              className={`w-full text-left p-2.5 rounded-lg border transition ${
                activeEmail === t.email
                  ? "bg-secondary border-purple-500/50"
                  : "bg-card border-border hover:bg-secondary"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-xs truncate flex-1">{t.email}</span>
                {t.unreadForAdmin > 0 && (
                  <span className="min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{t.unreadForAdmin}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {t.escalated && !t.resolved && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 uppercase">Эскалация</span>}
                {t.resolved && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 uppercase">Решён</span>}
                <span className="text-[10px] font-mono text-muted-foreground">{new Date(t.updatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="bg-secondary border border-border rounded-xl flex flex-col">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground italic">Выберите диалог</div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div>
                  <div className="font-mono text-sm">{active.email}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{active.messages.length} сообщений</div>
                </div>
                {!active.resolved && (
                  <button
                    onClick={() => { resolveThread(active.email); toast.success("Диалог закрыт"); }}
                    className="px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-xs hover:bg-green-500/20 transition"
                  >
                    Закрыть тикет
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-3 max-h-[50vh]">
                {active.messages.map((m) => (
                  <div key={m.id} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-card text-foreground border border-border rounded-bl-sm"
                        : m.role === "admin"
                          ? "bg-orange-500/15 text-foreground border border-orange-500/30 rounded-br-sm"
                          : "bg-purple-500/10 text-foreground border border-purple-500/20 rounded-br-sm"
                    }`}>
                      <div className="text-[9px] font-mono uppercase tracking-wider mb-0.5 opacity-60">
                        {m.role === "user" ? "Пользователь" : m.role === "admin" ? "Оператор" : "ИИ"} · {new Date(m.ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      {m.text}
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-2.5 border-t border-border">
                <div className="flex gap-2">
                  <input
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") sendReply(); }}
                    placeholder="Вклиниться в диалог..."
                    className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-xs focus:border-orange-500/50 focus:outline-none"
                  />
                  <button
                    onClick={sendReply}
                    disabled={!reply.trim()}
                    className="px-3 rounded-lg bg-gradient-to-r from-purple-500 to-orange-500 text-black hover:opacity-90 transition disabled:opacity-50"
                  >
                    <Icon name="Send" size={12} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── Integrations Panel ──────────────────────────────────────────────────────
function IntegrationsPanel() {
  const items = useIntegrations();
  const [kind, setKind] = useState<IntegrationKind>("webhook");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  function add() {
    if (!url.trim() || !url.startsWith("http")) return toast.error("Введите корректный URL");
    addIntegration({ kind, name: name.trim() || KIND_LABEL[kind], url: url.trim(), apiKey: apiKey.trim() || undefined, enabled: true });
    setName(""); setUrl(""); setApiKey("");
    toast.success("Интеграция добавлена");
  }

  async function ping(id: string) {
    const i = items.find((x) => x.id === id);
    if (!i) return;
    try {
      toast.loading("Отправляем тестовый лид...", { id: "ping" });
      await pingIntegration(i);
      toast.success("Лид доставлен", { id: "ping" });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Ошибка", { id: "ping" });
    }
  }

  return (
    <div className="space-y-4 animate-fade-up">
      <Card title="Подключение CRM и Webhooks" accent="purple" badge="Лиды → CRM">
        <p className="text-xs text-muted-foreground mb-4">
          Формы на сгенерированном сайте автоматически отправляют данные во все активные интеграции. Поддерживаются Битрикс24, AmoCRM, 1С, Albato, Zapier и любой Webhook.
        </p>

        <div className="grid md:grid-cols-2 gap-3 mb-4">
          <Field label="Тип системы">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as IntegrationKind)}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:border-purple-500/50 focus:outline-none"
            >
              {(Object.keys(KIND_LABEL) as IntegrationKind[]).map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </select>
            <div className="text-[10px] text-muted-foreground mt-1 font-mono">{KIND_HINT[kind]}</div>
          </Field>
          <Field label="Название">
            <Input value={name} onChange={setName} placeholder={KIND_LABEL[kind]} />
          </Field>
          <Field label="Webhook URL / API endpoint">
            <Input value={url} onChange={setUrl} placeholder="https://hook.com/abc123" mono />
          </Field>
          <Field label="API-ключ (опц.)">
            <Input value={apiKey} onChange={setApiKey} placeholder="опционально" type="password" mono />
          </Field>
        </div>
        <div className="flex justify-end">
          <button onClick={add} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-orange-500 text-black text-sm font-bold hover:opacity-90 transition">
            <Icon name="Plus" size={14} />
            Добавить
          </button>
        </div>
      </Card>

      <Card title="Активные интеграции" accent="orange" badge={`${items.filter((i) => i.enabled).length}/${items.length}`}>
        {items.length === 0 ? (
          <div className="text-xs text-muted-foreground italic p-3">Пока нет подключений</div>
        ) : (
          <div className="space-y-2">
            {items.map((i) => (
              <div key={i.id} className="p-3 rounded-lg bg-secondary border border-border">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={`w-2 h-2 rounded-full ${i.enabled ? "bg-green-500 animate-pulse-dot" : "bg-muted-foreground"}`} />
                  <span className="font-heading text-xs uppercase tracking-wider">{KIND_LABEL[i.kind]}</span>
                  <span className="font-medium text-sm truncate flex-1">{i.name}</span>
                  <button
                    onClick={() => updateIntegration(i.id, { enabled: !i.enabled })}
                    className="text-[10px] font-mono uppercase px-2 py-1 rounded border border-border hover:bg-card transition"
                  >
                    {i.enabled ? "Выключить" : "Включить"}
                  </button>
                  <button
                    onClick={() => ping(i.id)}
                    className="text-[10px] font-mono uppercase px-2 py-1 rounded bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 transition"
                  >
                    Тест
                  </button>
                  <button
                    onClick={() => removeIntegration(i.id)}
                    className="w-6 h-6 rounded hover:bg-card flex items-center justify-center text-muted-foreground hover:text-red-400 transition"
                  >
                    <Icon name="X" size={12} />
                  </button>
                </div>
                <div className="text-[10px] font-mono text-muted-foreground truncate mt-1.5">→ {i.url}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Projects Tab ─────────────────────────────────────────────────────────────
function ProjectsTab({ onUse }: { onUse: (prompt: string) => void }) {
  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 pt-6 animate-fade-up">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <div className="font-mono text-xs text-muted-foreground mb-1">/ проекты / шаблоны</div>
          <h1 className="font-heading text-4xl">Шаблоны</h1>
          <p className="text-muted-foreground text-sm mt-1">Готовые шаблоны для быстрого старта</p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary border border-border text-sm hover:bg-foreground hover:text-background transition">
            <Icon name="Filter" size={13} />
            Фильтры
          </button>
          <button
            onClick={() => onUse("")}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-orange-500 text-black text-sm font-bold hover:opacity-90 transition"
          >
            <Icon name="Plus" size={13} />
            Новый проект
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TEMPLATES.map((t, i) => (
          <div
            key={t.id}
            className="group relative bg-card border border-border rounded-2xl overflow-hidden hover:border-foreground/30 transition-all animate-slide-up"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className={`h-40 relative overflow-hidden ${
              t.color === "purple" ? "bg-gradient-to-br from-purple-500/20 via-background to-background" : "bg-gradient-to-br from-orange-500/20 via-background to-background"
            }`}>
              <div className="absolute inset-0 grid-bg opacity-50" />
              <div className="absolute inset-0 flex items-center justify-center text-7xl group-hover:scale-110 transition-transform duration-500">
                {t.emoji}
              </div>
              <span className={`absolute top-3 left-3 text-[10px] px-2 py-1 rounded-full font-mono font-medium uppercase tracking-wider ${
                t.color === "purple" ? "bg-purple-500/15 text-purple-400 border border-purple-500/30" : "bg-orange-500/15 text-orange-400 border border-orange-500/30"
              }`}>
                {t.tag}
              </span>
            </div>
            <div className="p-5">
              <h3 className="font-heading text-xl mb-1">{t.title}</h3>
              <p className="text-muted-foreground text-xs mb-4">{t.desc}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => onUse(t.prompt)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-foreground text-background text-xs font-medium hover:opacity-90 transition"
                >
                  <Icon name="Wand2" size={12} />
                  Использовать шаблон
                </button>
                <button className="px-3 py-2 rounded-lg border border-border text-xs hover:bg-secondary transition" title="Предпросмотр">
                  <Icon name="Eye" size={12} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Shared mini-components ───────────────────────────────────────────────────
function Card({ title, children, accent = "purple", badge }: {
  title: string;
  children: React.ReactNode;
  accent?: "purple" | "orange";
  badge?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className={`w-1 h-4 rounded-full ${accent === "purple" ? "bg-purple-500" : "bg-orange-500"}`} />
          <h3 className="font-heading uppercase tracking-wider text-sm">{title}</h3>
        </div>
        {badge && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20 font-mono uppercase">
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </label>
  );
}

function Input({ placeholder, type = "text", mono, value, onChange }: {
  placeholder?: string;
  type?: string;
  mono?: boolean;
  value?: string;
  onChange?: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  const isPass = type === "password";
  return (
    <div className="relative">
      <input
        type={isPass && !show ? "password" : "text"}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
        className={`w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:border-purple-500/50 focus:outline-none transition ${mono ? "font-mono" : ""} ${isPass ? "pr-10" : ""}`}
      />
      {isPass && (
        <button
          onClick={() => setShow(!show)}
          className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
        >
          <Icon name={show ? "EyeOff" : "Eye"} size={14} />
        </button>
      )}
    </div>
  );
}

function Toggle({ label, hint, on, setOn, color }: {
  label: string;
  hint?: string;
  on: boolean;
  setOn: (v: boolean) => void;
  color: "purple" | "orange";
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <div className="font-medium text-sm">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <button
        onClick={() => setOn(!on)}
        className={`relative w-11 h-6 rounded-full transition-colors ${
          on ? (color === "purple" ? "bg-purple-500" : "bg-orange-500") : "bg-secondary border border-border"
        }`}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-background transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}
