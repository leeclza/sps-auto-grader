import { GoogleGenAI } from "@google/genai";

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
// Free tier dibatasi per menit per model; request diantre agar tidak melewati batas ini.
const GEMINI_RPM = Number(process.env.GEMINI_RPM) || 5;

let client: GoogleGenAI | null = null;
function ai() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY belum diisi di .env");
  return (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Antrean global: satu request Gemini dalam satu waktu, berjarak minimal 60/RPM detik.
let queue: Promise<unknown> = Promise.resolve();
let lastCall = 0;
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastCall + 60_000 / GEMINI_RPM - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

/** Ubah error mentah Gemini (JSON panjang) jadi pesan singkat yang bisa dibaca. */
export function geminiErrorMessage(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (/PerDay/i.test(msg)) return "Kuota harian Gemini habis. Coba lagi besok.";
  if (/\b429\b|RESOURCE_EXHAUSTED/.test(msg)) return "Batas request Gemini per menit tercapai. Coba lagi sebentar.";
  if (/\b503\b|UNAVAILABLE/.test(msg)) return "Server Gemini sedang sibuk. Coba lagi beberapa menit lagi.";
  return msg.length > 300 ? msg.slice(0, 300) + "…" : msg;
}

// 503 (server sibuk) dan 429 per menit: coba ulang. Kuota harian habis: langsung gagal.
async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await enqueue(fn);
    } catch (e) {
      const msg = String((e as Error).message);
      const retryable = /\b(503|429|UNAVAILABLE|RESOURCE_EXHAUSTED)\b/.test(msg) && !/PerDay/i.test(msg);
      if (i >= attempts || !retryable) throw e;
      const suggested = Number(msg.match(/retry in ([\d.]+)s/i)?.[1]);
      await sleep(suggested > 0 ? suggested * 1000 + 1000 : 5000 * 2 ** (i - 1));
    }
  }
}

export async function generateJson<T>(prompt: string): Promise<T> {
  const res = await withRetry(() =>
    ai().models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: { responseMimeType: "application/json", temperature: 0.2 },
    }),
  );
  return JSON.parse(res.text ?? "{}") as T;
}
