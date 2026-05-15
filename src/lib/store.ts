
import { useState, useEffect, useCallback } from "react";

const KEY = "muravey_settings_v2";

export type AiProvider = "DeepSeek" | "Claude" | "OpenAI";

export type ProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type ImageEngine = "replicate" | "openai" | "kandinsky" | "yandexart" | "custom";
export type MediaEngine = "replicate" | "custom";

export type PromptPreset = "designer" | "engineer" | "custom";

const WEB_SEARCH_RULE =
  "ПОИСК В СЕТИ: Полагайся на свои знания. ОБРАЩАЙСЯ К ПОИСКУ ТОЛЬКО когда (1) пользователь спрашивает про конкретную свежую версию библиотеки/API, (2) нужна актуальная документация, (3) надо проверить точный текст ошибки. Тогда ПЕРВОЙ строкой ответа верни ровно: 'SEARCH: <короткий запрос на английском или русском>' — НИЧЕГО больше. Система выполнит поиск через DuckDuckGo (или Yandex для РФ) и вернёт результаты тебе следующим сообщением. Не используй SEARCH для общих знаний, для простого HTML/CSS и для генерации лендингов.";

const FILE_TOOLS_RULE =
  "РАБОТА С ФАЙЛАМИ ПРОЕКТА (если в контексте есть список загруженных файлов):\n" +
  "• Чтобы посмотреть содержимое любого файла, верни на отдельной строке: READ: путь/к/файлу.ext  (можно несколько READ подряд). Система вернёт содержимое следующим сообщением, и только потом ты будешь редактировать.\n" +
  "• Чтобы изменить или создать файл, используй формат:\n" +
  "WRITE: путь/к/файлу.ext\n```\nновое полное содержимое файла\n```\n" +
  "Можно несколько WRITE-блоков подряд (по одному на файл). НЕ перепечатывай файлы, которые не меняешь. Если файл большой — точечно правь нужные участки, возвращая ПОЛНОЕ новое содержимое. Никаких diff-патчей, никаких '...' — только полный код файла внутри ```.";

export const DESIGNER_PROMPT =
  "Ты — Муравей 2.0 в режиме «Дизайнер». Создавай ВПЕЧАТЛЯЮЩИЕ современные сайты в духе Linear / Vercel / Apple. Сначала строка из 3–5 атомарных шагов через ' · ' (например: '🎨 Палитра · 🧱 Сетка · ✨ Анимация'), затем один блок HTML с инлайн CSS/JS в index.html. Использовать Tailwind по CDN, иконки lucide, шрифты Google. Никаких внешних API кроме CDN. Минимум воды.\n\n" + WEB_SEARCH_RULE + "\n\n" + FILE_TOOLS_RULE;

export const ENGINEER_PROMPT =
  "Ты — Муравей 2.0 в режиме «Инженер-хирург». Работаешь только с уже загруженным кодом. Не пиши всё с нуля — точечно меняй существующие файлы. Сначала строка-шаги через ' · ' (например: '🔍 Анализ App.tsx · 💉 Патч роутера · 🧪 Проверка'). НИКОГДА не угадывай содержимое файлов — сначала READ нужного файла, затем WRITE с исправлением. Сохраняй стиль кода, импорты и архитектуру проекта. Если файла нет — создай минимально необходимый через WRITE.\n\n" + WEB_SEARCH_RULE + "\n\n" + FILE_TOOLS_RULE;

export const DEFAULT_SYSTEM_PROMPT = DESIGNER_PROMPT;

export type Settings = {
  ai: {
    activeProvider: AiProvider;
    providers: Record<AiProvider, ProviderConfig>;
    temperature: string;
    systemPrompt: string;
    promptPreset: PromptPreset;
    customPrompt: string;

    image: {
      engine: ImageEngine;
      apiKey: string;
      baseUrl: string;
      model: string;
      folderId: string;
    };
    media: {
      engine: MediaEngine;
      apiKey: string;
      baseUrl: string;
      videoModel: string;
      audioModel: string;
    };
    search: {
      enabled: boolean;
      engine: "duckduckgo" | "yandex" | "auto";
      yandexApiKey: string;
      yandexFolderId: string;
      autoMode: boolean;
    };
  };
  github: {
    token: string;
    repo: string;
    siteUrl: string;
    branch: string;
    proxy: string;
  };
  regru: {
    serverUrl: string;
    login: string;
    password: string;
  };
  payments: {
    terminalKey: string;
    password: string;
  };
  system: {
    selfEdit: boolean;
    publicAi: boolean;
  };
  supabase: {
    url: string;
    anonKey: string;
    serviceKey: string;
  };
  appKeys: Record<string, string>;
  tokens: number;
};

export const PROVIDER_DEFAULTS: Record<AiProvider, ProviderConfig> = {
  DeepSeek: {
    apiKey: "",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
  Claude: {
    apiKey: "",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-5",
  },
  OpenAI: {
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
};

export const MODELS_BY_PROVIDER: Record<AiProvider, string[]> = {
  DeepSeek: ["deepseek-chat", "deepseek-coder", "deepseek-reasoner"],
  Claude: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-3-5-haiku-latest"],
  OpenAI: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
};

export const IMAGE_ENGINE_DEFAULTS: Record<ImageEngine, { baseUrl: string; model: string; label: string }> = {
  replicate: { baseUrl: "https://api.replicate.com/v1", model: "black-forest-labs/flux-schnell", label: "Replicate (FLUX/SD)" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-image-1", label: "OpenAI (DALL·E)" },
  kandinsky: { baseUrl: "sberbank.ru", model: "Kandinsky-3.1", label: "Kandinsky 🇷🇺" },
  yandexart: { baseUrl: "https://llm.api.cloud.yandex.net/foundationModels/v1", model: "yandex-art/latest", label: "YandexART 🇷🇺" },
  custom: { baseUrl: "", model: "", label: "Свой шлюз" },
};

export const MEDIA_ENGINE_DEFAULTS: Record<MediaEngine, { baseUrl: string; videoModel: string; audioModel: string; label: string }> = {
  replicate: { baseUrl: "https://api.replicate.com/v1", videoModel: "luma/ray-flash-2", audioModel: "suno/bark", label: "Replicate" },
  custom: { baseUrl: "", videoModel: "", audioModel: "", label: "Свой шлюз" },
};

export const DEFAULT_SETTINGS: Settings = {
  ai: {
    activeProvider: "DeepSeek",
    providers: {
      DeepSeek: { ...PROVIDER_DEFAULTS.DeepSeek },
      Claude: { ...PROVIDER_DEFAULTS.Claude },
      OpenAI: { ...PROVIDER_DEFAULTS.OpenAI },
    },
    temperature: "0.7",
    systemPrompt: DESIGNER_PROMPT,
    promptPreset: "designer",
    customPrompt: "",
    image: {
      engine: "replicate",
      apiKey: "",
      baseUrl: IMAGE_ENGINE_DEFAULTS.replicate.baseUrl,
      model: IMAGE_ENGINE_DEFAULTS.replicate.model,
      folderId: "",
    },
    media: {
      engine: "replicate",
      apiKey: "",
      baseUrl: MEDIA_ENGINE_DEFAULTS.replicate.baseUrl,
      videoModel: MEDIA_ENGINE_DEFAULTS.replicate.videoModel,
      audioModel: MEDIA_ENGINE_DEFAULTS.replicate.audioModel,
    },
    search: {
      enabled: true,
      engine: "auto",
      yandexApiKey: "",
      yandexFolderId: "",
      autoMode: true,
    },
  },
  github: { token: "", repo: "", siteUrl: "", branch: "main", proxy: "" },
  regru: { serverUrl: "", login: "", password: "" },
  payments: { terminalKey: "", password: "" },
  system: { selfEdit: false, publicAi: true },
  supabase: { url: "", anonKey: "", serviceKey: "" },
  appKeys: {},
  tokens: 12480,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      ai: {
        ...DEFAULT_SETTINGS.ai,
        ...(parsed.ai || {}),
        providers: {
          DeepSeek: { ...DEFAULT_SETTINGS.ai.providers.DeepSeek, ...((parsed.ai && parsed.ai.providers && parsed.ai.providers.DeepSeek) || {}) },
          Claude: { ...DEFAULT_SETTINGS.ai.providers.Claude, ...((parsed.ai && parsed.ai.providers && parsed.ai.providers.Claude) || {}) },
          OpenAI: { ...DEFAULT_SETTINGS.ai.providers.OpenAI, ...((parsed.ai && parsed.ai.providers && parsed.ai.providers.OpenAI) || {}) },
        },
        image: { ...DEFAULT_SETTINGS.ai.image, ...((parsed.ai && parsed.ai.image) || {}) },
        media: { ...DEFAULT_SETTINGS.ai.media, ...((parsed.ai && parsed.ai.media) || {}) },
        search: { ...DEFAULT_SETTINGS.ai.search, ...((parsed.ai && parsed.ai.search) || {}) },
      },
      github: { ...DEFAULT_SETTINGS.github, ...(parsed.github || {}) },
      regru: { ...DEFAULT_SETTINGS.regru, ...(parsed.regru || {}) },
      payments: { ...DEFAULT_SETTINGS.payments, ...(parsed.payments || {}) },
      system: { ...DEFAULT_SETTINGS.system, ...(parsed.system || {}) },
      supabase: { ...DEFAULT_SETTINGS.supabase, ...(parsed.supabase || {}) },
      appKeys: { ...DEFAULT_SETTINGS.appKeys, ...(parsed.appKeys || {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const listeners = new Set<() => void>();
let state: Settings = load();

export function getSettings(): Settings {
  return state;
}

export function setSettings(patch: Partial<Settings> | ((s: Settings) => Settings)) {
  const next = typeof patch === "function" ? patch(state) : { ...state, ...patch };
  state = next;
  localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((l) => l());
}

export function getActiveProviderConfig(s: Settings = state): ProviderConfig & { provider: AiProvider } {
  const p = s.ai.activeProvider;
  return { provider: p, ...s.ai.providers[p] };
}

export function useSettings() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n: number) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  const update = useCallback((patch: Partial<Settings> | ((s: Settings) => Settings)) => {
    setSettings(patch);
  }, []);
  return [state, update] as const;
}
