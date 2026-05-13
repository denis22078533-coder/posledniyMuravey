import { useState, useEffect } from "react";

export type SupportRole = "user" | "ai" | "admin";

export type SupportMessage = {
  id: string;
  ts: number;
  role: SupportRole;
  text: string;
};

export type SupportThread = {
  id: string;
  email: string;
  createdAt: number;
  updatedAt: number;
  escalated: boolean;
  resolved: boolean;
  unreadForAdmin: number;
  unreadForUser: number;
  messages: SupportMessage[];
};

const KEY = "muravey_support_v1";

type SupportStore = { threads: Record<string, SupportThread> };

function load(): SupportStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* noop */ }
  return { threads: {} };
}

const state: SupportStore = load();
const listeners = new Set<() => void>();
function persist() {
  localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((l) => l());
}

export function useSupport() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  const threads = Object.values(state.threads).sort((a, b) => b.updatedAt - a.updatedAt);
  const pendingCount = threads.filter((t) => t.escalated && !t.resolved).length;
  const totalUnread = threads.reduce((acc, t) => acc + t.unreadForAdmin, 0);
  return { threads, pendingCount, totalUnread };
}

export function getOrCreateThread(email: string): SupportThread {
  const e = email.toLowerCase();
  let t = state.threads[e];
  if (!t) {
    t = {
      id: e,
      email: e,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      escalated: false,
      resolved: false,
      unreadForAdmin: 0,
      unreadForUser: 0,
      messages: [
        {
          id: crypto.randomUUID(),
          ts: Date.now(),
          role: "ai",
          text: "Здравствуйте! Я ИИ-ассистент поддержки Муравей 2.0. Опишите проблему — постараюсь помочь. Если потребуется человек, напишите «оператор».",
        },
      ],
    };
    state.threads[e] = t;
    persist();
  }
  return t;
}

export function addMessage(email: string, role: SupportRole, text: string) {
  const t = getOrCreateThread(email);
  t.messages.push({ id: crypto.randomUUID(), ts: Date.now(), role, text });
  t.updatedAt = Date.now();
  if (role === "user") t.unreadForAdmin += 1;
  if (role === "ai" || role === "admin") t.unreadForUser += 1;
  if (role === "admin") t.escalated = true;
  state.threads[email.toLowerCase()] = t;
  persist();
}

const ESC_WORDS = ["оператор", "человек", "менеджер", "support", "help me", "жалоба", "позови"];

export function shouldEscalate(text: string): boolean {
  const t = text.toLowerCase();
  return ESC_WORDS.some((w) => t.includes(w));
}

export function escalate(email: string) {
  const t = getOrCreateThread(email);
  if (!t.escalated) {
    t.escalated = true;
    t.messages.push({
      id: crypto.randomUUID(),
      ts: Date.now(),
      role: "ai",
      text: "Соединяю с оператором. Администратор получил уведомление и скоро ответит.",
    });
    t.updatedAt = Date.now();
    t.unreadForAdmin += 1;
    persist();
  }
}

export function markReadForUser(email: string) {
  const t = state.threads[email.toLowerCase()];
  if (t && t.unreadForUser) { t.unreadForUser = 0; persist(); }
}
export function markReadForAdmin(email: string) {
  const t = state.threads[email.toLowerCase()];
  if (t && t.unreadForAdmin) { t.unreadForAdmin = 0; persist(); }
}

export function resolveThread(email: string) {
  const t = state.threads[email.toLowerCase()];
  if (t) {
    t.resolved = true;
    t.escalated = false;
    persist();
  }
}

export const SUPPORT_KB_PROMPT = `Ты ИИ-ассистент поддержки платформы Муравей 2.0 — IDE для генерации сайтов.
Известные темы:
- Регистрация: первый зарегистрированный пользователь становится Superadmin; роль также можно задать через ENV VITE_ADMIN_EMAIL.
- Тарифы: оплата токенов через Т-Банк (СБП). 990 ₽ = 5 000 токенов.
- API-ключи: настраиваются в Мозг → Движок. Свой ключ DeepSeek/Claude/OpenAI обязателен.
- GitHub: коммиты идут через токен с правом repo. CORS обходит автопрокси.
- ZIP: импорт мгновенно даёт ИИ контекст файлов.
- БД: Supabase, поля в Мозг → Система. Поддерживается RLS.
- Медиа: фото/видео/музыка через Image API + Media API ключи.
- Интеграции: формы сайта можно подключить к CRM через Webhook.

Отвечай коротко (1–3 предложения). Если вопрос вне темы или сложный — предложи позвать оператора фразой «Напишите «оператор», и я подключу человека».`;
