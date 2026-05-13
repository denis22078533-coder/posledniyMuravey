import { useState, useEffect } from "react";

export type IntegrationKind = "webhook" | "bitrix24" | "amocrm" | "1c" | "albato" | "zapier";

export type Integration = {
  id: string;
  kind: IntegrationKind;
  name: string;
  url: string;        // webhook url или API endpoint
  apiKey?: string;    // секретный токен/key
  enabled: boolean;
};

const KEY = "muravey_integrations_v1";

type Store = { items: Integration[] };

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* noop */ }
  return { items: [] };
}

const state: Store = load();
const listeners = new Set<() => void>();
function persist() {
  localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((l) => l());
}

export function useIntegrations() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return state.items;
}

export function getIntegrationsSnapshot(): Integration[] {
  return [...state.items];
}

export function addIntegration(i: Omit<Integration, "id">): Integration {
  const item: Integration = { ...i, id: crypto.randomUUID() };
  state.items.push(item);
  persist();
  return item;
}

export function updateIntegration(id: string, patch: Partial<Integration>) {
  state.items = state.items.map((i) => (i.id === id ? { ...i, ...patch } : i));
  persist();
}

export function removeIntegration(id: string) {
  state.items = state.items.filter((i) => i.id !== id);
  persist();
}

export const KIND_LABEL: Record<IntegrationKind, string> = {
  webhook: "Webhook",
  bitrix24: "Битрикс24",
  amocrm: "AmoCRM",
  "1c": "1С",
  albato: "Albato",
  zapier: "Zapier",
};

export const KIND_HINT: Record<IntegrationKind, string> = {
  webhook: "POST на любой URL · стандартный JSON",
  bitrix24: "Входящий webhook Битрикс24 · /crm.lead.add",
  amocrm: "Webhook AmoCRM · автоматизация → вебхук",
  "1c": "REST endpoint 1С:Предприятие",
  albato: "Albato · CRM-коннектор",
  zapier: "Zapier Catch Hook",
};

// Тестовая отправка
export async function pingIntegration(i: Integration): Promise<string> {
  const payload = {
    test: true,
    source: "muravey-2.0",
    ts: new Date().toISOString(),
    lead: { name: "Тест Тестов", email: "test@example.com", phone: "+70000000000", message: "Проверка интеграции" },
  };
  const res = await fetch(i.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(i.apiKey ? { Authorization: `Bearer ${i.apiKey}` } : {}) },
    body: JSON.stringify(payload),
    mode: "cors",
  });
  if (!res.ok && res.status !== 0) {
    throw new Error(`Webhook ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
  return "ok";
}

/**
 * Сниппет, который встраивается в сгенерированный HTML.
 * Он перехватывает submit на всех формах и отправляет данные во все active интеграции.
 */
export function buildLeadInjector(items: Integration[]): string {
  const active = items.filter((i) => i.enabled && i.url);
  if (active.length === 0) return "";
  const targets = active.map((i) => ({ url: i.url, key: i.apiKey || "", kind: i.kind, name: i.name }));
  return `<script>(function(){
    var TARGETS=${JSON.stringify(targets)};
    function collect(form){
      var data={};
      Array.from(form.elements).forEach(function(el){
        if(!el.name) return;
        data[el.name]=el.value;
      });
      data._page=location.href; data._ts=new Date().toISOString();
      return data;
    }
    function send(payload){
      TARGETS.forEach(function(t){
        try{
          fetch(t.url,{method:"POST",headers:Object.assign({"Content-Type":"application/json"},t.key?{Authorization:"Bearer "+t.key}:{}),body:JSON.stringify({source:"muravey-site",integration:t.name,lead:payload})}).catch(function(){});
        }catch(e){}
      });
    }
    document.addEventListener("submit",function(e){
      var f=e.target; if(!(f instanceof HTMLFormElement))return;
      var d=collect(f); send(d);
    },true);
    window.__muraveySendLead=send;
  })();</script>`;
}