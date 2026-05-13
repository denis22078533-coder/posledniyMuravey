import { getSettings } from "./store";

export type MediaIntent = "image" | "video" | "audio" | "image-edit" | null;

const IMAGE_WORDS = ["картинк", "фото", "изображен", "нарисуй", "арт", "обложк", "иллюстр"];
const VIDEO_WORDS = ["видео", "ролик", "клип", "анимац", "movie", "видосик"];
const AUDIO_WORDS = ["музык", "песн", "трек", "мелоди", "поздравлен", "саундтрек", "бит ", "бит,"];

export function detectIntent(text: string, hasUpload: boolean): MediaIntent {
  const t = text.toLowerCase();
  if (hasUpload) return "image-edit";
  if (AUDIO_WORDS.some((w) => t.includes(w))) return "audio";
  if (VIDEO_WORDS.some((w) => t.includes(w))) return "video";
  if (IMAGE_WORDS.some((w) => t.includes(w))) return "image";
  return null;
}

// ─── ИЗОБРАЖЕНИЕ ──────────────────────────────────────────────────────────────
export async function generateImage(prompt: string, init?: { image?: string }): Promise<string> {
  const img = getSettings().ai.image;
  if (!img.apiKey) {
    throw new Error("Не задан Image API Key. Откройте «Мозг → ИИ → Медиа».");
  }
  const base = (img.baseUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("Не задан Base URL для Image API");

  // ─ Kandinsky / FusionBrain (RU) ─
  if (img.engine === "kandinsky") {
    const headers = {
      "X-Key": `Key ${img.apiKey.split(":")[0] || img.apiKey}`,
      "X-Secret": `Secret ${img.apiKey.split(":")[1] || ""}`,
    };
    const fd = new FormData();
    fd.append("model_id", img.model || "4");
    fd.append("params", new Blob([JSON.stringify({ type: "GENERATE", numImages: 1, width: 1024, height: 1024, generateParams: { query: prompt } })], { type: "application/json" }));
    const start = await fetch(`${base}/text2image/run`, { method: "POST", headers, body: fd });
    if (!start.ok) throw new Error(`Kandinsky ${start.status}: ${(await start.text()).slice(0, 200)}`);
    const job = await start.json();
    const id = job?.uuid;
    if (!id) throw new Error("Kandinsky: пустой uuid");
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const r = await fetch(`${base}/text2image/status/${id}`, { headers });
      const st = await r.json();
      if (st?.status === "DONE" && st?.images?.[0]) {
        return st.images[0].startsWith("data:") ? st.images[0] : `data:image/png;base64,${st.images[0]}`;
      }
      if (st?.status === "FAIL") throw new Error(`Kandinsky: ${st?.errorDescription || "сбой"}`);
    }
    throw new Error("Kandinsky: таймаут генерации");
  }

  // ─ YandexART ─
  if (img.engine === "yandexart") {
    if (!img.folderId) throw new Error("YandexART: укажите Folder ID");
    const start = await fetch(`${base}/imageGenerationAsync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Api-Key ${img.apiKey}`, "x-folder-id": img.folderId },
      body: JSON.stringify({
        modelUri: `art://${img.folderId}/${img.model || "yandex-art/latest"}`,
        messages: [{ weight: 1, text: prompt }],
        generationOptions: { mimeType: "image/png", seed: Math.floor(Math.random() * 1e9) },
      }),
    });
    if (!start.ok) throw new Error(`YandexART ${start.status}: ${(await start.text()).slice(0, 200)}`);
    const op = await start.json();
    const opId = op?.id;
    if (!opId) throw new Error("YandexART: пустой operation id");
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const r = await fetch(`https://operation.api.cloud.yandex.net/operations/${opId}`, {
        headers: { Authorization: `Api-Key ${img.apiKey}` },
      });
      const st = await r.json();
      if (st?.done && st?.response?.image) return `data:image/png;base64,${st.response.image}`;
      if (st?.error) throw new Error(`YandexART: ${st.error.message || "сбой"}`);
    }
    throw new Error("YandexART: таймаут");
  }

  // ─ OpenAI ─
  if (img.engine === "openai") {
    const res = await fetch(`${base}/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${img.apiKey}` },
      body: JSON.stringify({ model: img.model || "gpt-image-1", prompt, size: "1024x1024", n: 1 }),
    });
    if (!res.ok) throw new Error(`Image API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const item = data?.data?.[0];
    if (item?.url) return item.url;
    if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
    throw new Error("Пустой ответ от Image API");
  }

  // ─ Replicate ─
  if (img.engine === "replicate") {
    const create = await fetch(`${base}/predictions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${img.apiKey}`, Prefer: "wait" },
      body: JSON.stringify({
        model: img.model || "black-forest-labs/flux-schnell",
        input: { prompt, ...(init?.image ? { image: init.image } : {}) },
      }),
    });
    if (!create.ok) throw new Error(`Image API ${create.status}: ${(await create.text()).slice(0, 200)}`);
    const data = await create.json();
    const out = Array.isArray(data?.output) ? data.output[0] : data?.output;
    if (typeof out === "string") return out;
    throw new Error("Пустой ответ от Image API");
  }

  // ─ Custom universal endpoint ─
  const res = await fetch(`${base}/images/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${img.apiKey}` },
    body: JSON.stringify({ prompt, model: img.model, image: init?.image }),
  });
  if (!res.ok) throw new Error(`Image API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data?.url || data?.image_url || data?.output?.[0] || "";
}

// ─── ВИДЕО ────────────────────────────────────────────────────────────────────
export async function generateVideo(prompt: string): Promise<string> {
  const m = getSettings().ai.media;
  if (!m.apiKey) throw new Error("Не задан Video/Audio API Key. Откройте «Мозг → ИИ → Медиа».");
  const base = (m.baseUrl || "").replace(/\/+$/, "");

  if (m.engine === "replicate") {
    const res = await fetch(`${base}/predictions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${m.apiKey}`, Prefer: "wait" },
      body: JSON.stringify({ model: m.videoModel || "luma/ray-flash-2", input: { prompt } }),
    });
    if (!res.ok) throw new Error(`Video API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const out = Array.isArray(data?.output) ? data.output[0] : data?.output;
    if (typeof out === "string") return out;
    throw new Error("Видео ещё рендерится — попробуйте позже");
  }

  const res = await fetch(`${base}/videos/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${m.apiKey}` },
    body: JSON.stringify({ prompt, model: m.videoModel }),
  });
  if (!res.ok) throw new Error(`Video API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data?.url || data?.video_url || data?.output?.[0] || "";
}

// ─── АУДИО ────────────────────────────────────────────────────────────────────
export async function generateAudio(prompt: string): Promise<string> {
  const m = getSettings().ai.media;
  if (!m.apiKey) throw new Error("Не задан Video/Audio API Key. Откройте «Мозг → ИИ → Медиа».");
  const base = (m.baseUrl || "").replace(/\/+$/, "");

  if (m.engine === "replicate") {
    const res = await fetch(`${base}/predictions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${m.apiKey}`, Prefer: "wait" },
      body: JSON.stringify({ model: m.audioModel || "suno/bark", input: { prompt } }),
    });
    if (!res.ok) throw new Error(`Audio API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const out = Array.isArray(data?.output) ? data.output[0] : data?.output;
    if (typeof out === "string") return out;
    throw new Error("Музыка ещё генерируется — попробуйте позже");
  }

  const res = await fetch(`${base}/audio/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${m.apiKey}` },
    body: JSON.stringify({ prompt, model: m.audioModel }),
  });
  if (!res.ok) throw new Error(`Audio API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data?.url || data?.audio_url || data?.output?.[0] || "";
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
