import { getSettings } from "./store";

// Проверка подключения через REST-роут /rest/v1/
export async function pingSupabase(): Promise<{ ok: true }> {
  const { url, anonKey } = getSettings().supabase;
  if (!url || !anonKey) throw new Error("Заполните SUPABASE_URL и SUPABASE_ANON_KEY");
  const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return { ok: true };
}

// Применение SQL через PostgREST RPC `exec_sql` (если есть) или сообщение для пользователя
export async function applySql(sql: string): Promise<string> {
  const { url, serviceKey, anonKey } = getSettings().supabase;
  if (!url) throw new Error("SUPABASE_URL не задан");
  const key = serviceKey || anonKey;
  if (!key) throw new Error("Нет ключа Supabase");

  const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SQL не применён (${res.status}): ${text.slice(0, 220)}. Создайте RPC exec_sql или выполните SQL вручную в SQL Editor.`);
  }
  return await res.text();
}

// Системный промпт для агента «БД-архитектор»
export const DB_AGENT_PROMPT = `Ты архитектор БД. На основе запроса пользователя вернёшь СТРОГИЙ JSON:
{
  "actions": ["короткие технические шаги в стиле '🔨 Создание схемы БД', '🔐 Включение RLS', '🚀 Деплой'"],
  "sql": "одна строка с CREATE TABLE и политиками RLS для Supabase (PostgreSQL)",
  "client_code": "JS-сниппет для @supabase/supabase-js, готовый к вставке в проект"
}
Никаких пояснений вне JSON.`;
