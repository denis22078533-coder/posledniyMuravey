import { useState, useEffect } from "react";
import { getSettings, setSettings } from "./store";

export type Role = "superadmin" | "moderator" | "user";

export type Account = {
  id: string;
  email: string;
  role: Role;
  tokens: number;
  banned: boolean;
  createdAt: number;
};

type AuthData = {
  ownerEmail: string | null;
  moderators: string[];
  bannedIds: string[];
  accounts: Record<string, Account>;
  passwords: Record<string, string>;
  sessionEmail: string | null;
  auditLog: AuditEntry[];
};

export type AuditEntry = {
  ts: number;
  email: string;
  role: Role;
  intent: string;
  text: string;
  blocked?: boolean;
  reason?: string;
};

const KEY = "muravey_auth_v1";

function envAdmin(): string | null {
  try {
    const v = import.meta.env.VITE_ADMIN_EMAIL || import.meta.env.NEXT_PUBLIC_ADMIN_EMAIL;
    return (v && String(v).trim().toLowerCase()) || null;
  } catch { return null; }
}

function load(): AuthData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* noop */ }
  return {
    ownerEmail: envAdmin(),
    moderators: [],
    bannedIds: [],
    accounts: {},
    passwords: {},
    sessionEmail: null,
    auditLog: [],
  };
}

const data: AuthData = load();
const listeners = new Set<() => void>();

function persist() {
  localStorage.setItem(KEY, JSON.stringify(data));
  listeners.forEach((l) => l());
}

export function useAuth() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  const session = data.sessionEmail ? data.accounts[data.sessionEmail.toLowerCase()] : null;
  return {
    session,
    ownerEmail: data.ownerEmail,
    moderators: data.moderators,
    accounts: data.accounts,
    auditLog: data.auditLog,
    isOwner: !!session && session.role === "superadmin",
    isModerator: !!session && (session.role === "superadmin" || session.role === "moderator"),
  };
}

function detectRole(email: string): Role {
  const e = email.toLowerCase();
  // Если ENV владельца есть и совпадает — он superadmin
  if (data.ownerEmail && e === data.ownerEmail.toLowerCase()) return "superadmin";
  // Если никто ещё не создан и нет ENV — первый получает superadmin
  if (!data.ownerEmail && Object.keys(data.accounts).length === 0) return "superadmin";
  if (data.moderators.map((m) => m.toLowerCase()).includes(e)) return "moderator";
  return "user";
}

export function signUp(email: string, password: string): Account {
  const e = email.trim().toLowerCase();
  if (!e || !password) throw new Error("Введите email и пароль");
  if (data.accounts[e]) throw new Error("Аккаунт уже существует — войдите");
  const role = detectRole(e);
  const account: Account = {
    id: crypto.randomUUID(),
    email: e,
    role,
    tokens: 1000,
    banned: false,
    createdAt: Date.now(),
  };
  data.accounts[e] = account;
  data.passwords[e] = password;
  if (role === "superadmin" && !data.ownerEmail) data.ownerEmail = e;
  data.sessionEmail = e;
  persist();
  return account;
}

export function signIn(email: string, password: string): Account {
  const e = email.trim().toLowerCase();
  const acc = data.accounts[e];
  if (!acc) throw new Error("Аккаунт не найден");
  if (data.passwords[e] !== password) throw new Error("Неверный пароль");
  if (acc.banned) throw new Error("Аккаунт заблокирован");
  // На входе — переоценка роли
  acc.role = detectRole(e);
  data.accounts[e] = acc;
  data.sessionEmail = e;
  persist();
  return acc;
}

export function signOut() {
  data.sessionEmail = null;
  persist();
}

export function addModerator(email: string) {
  const e = email.trim().toLowerCase();
  if (!e || !e.includes("@")) throw new Error("Некорректный email");
  if (!data.moderators.map((m) => m.toLowerCase()).includes(e)) data.moderators.push(e);
  if (data.accounts[e]) data.accounts[e].role = detectRole(e);
  persist();
}

export function removeModerator(email: string) {
  data.moderators = data.moderators.filter((m) => m.toLowerCase() !== email.toLowerCase());
  if (data.accounts[email.toLowerCase()]) data.accounts[email.toLowerCase()].role = detectRole(email);
  persist();
}

export function transferOwnership(newEmail: string) {
  const e = newEmail.trim().toLowerCase();
  if (!e || !e.includes("@")) throw new Error("Некорректный email");
  data.ownerEmail = e;
  if (data.accounts[e]) data.accounts[e].role = "superadmin";
  // Старого владельца — в обычные
  Object.values(data.accounts).forEach((a) => {
    a.role = detectRole(a.email);
  });
  persist();
}

export function setTokensFor(email: string, tokens: number) {
  const e = email.toLowerCase();
  if (data.accounts[e]) {
    data.accounts[e].tokens = Math.max(0, tokens);
    persist();
  }
}

export function banUser(email: string, ban = true) {
  const e = email.toLowerCase();
  if (data.accounts[e]) {
    data.accounts[e].banned = ban;
    persist();
  }
}

export function deleteUser(email: string) {
  const e = email.toLowerCase();
  delete data.accounts[e];
  delete data.passwords[e];
  if (data.sessionEmail === e) data.sessionEmail = null;
  persist();
}

// ── Content filter ──────────────────────────────────────────────────────────
const FORBIDDEN = [
  "детская порн", "csam", "child porn",
  "террор", "взрыв", "бомб", "теракт",
  "оруж", "наркот", "героин", "кокаин",
  "убий", "суицид", "killyourself",
  "порн", "nsfw", "обнаж", "эроти",
  "взлом", "ddos", "малварь", "ransomware",
];

export function checkContent(text: string): { ok: boolean; reason?: string } {
  const t = text.toLowerCase();
  for (const w of FORBIDDEN) {
    if (t.includes(w)) return { ok: false, reason: `Стоп-слово: «${w}»` };
  }
  return { ok: true };
}

// ── Audit log ────────────────────────────────────────────────────────────────
export function logAudit(entry: Omit<AuditEntry, "ts">) {
  data.auditLog.unshift({ ...entry, ts: Date.now() });
  if (data.auditLog.length > 500) data.auditLog.length = 500;
  persist();
}

export function clearAudit() {
  data.auditLog = [];
  persist();
}

// ── Tokens API для текущего пользователя ────────────────────────────────────
export function consumeToken() {
  const e = data.sessionEmail;
  if (!e) return;
  const acc = data.accounts[e];
  if (!acc) return;
  acc.tokens = Math.max(0, acc.tokens - 1);
  persist();
  // Синхронизируем верхний счётчик
  setSettings((c) => ({ ...c, tokens: acc.tokens }));
}

export function syncTopBalance() {
  const e = data.sessionEmail;
  if (!e) return;
  const acc = data.accounts[e];
  if (acc) setSettings((c) => ({ ...c, tokens: acc.tokens }));
}

export function getCurrentAccount(): Account | null {
  const e = data.sessionEmail;
  return e ? data.accounts[e] || null : null;
}

// Прокидываем getSettings, чтобы избежать неиспользованного импорта
void getSettings;
