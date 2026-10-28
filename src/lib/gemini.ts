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

/** Kuota harian Gemini reset tiap tengah malam waktu Pacific (America/Los_Angeles). */
function dailyQuotaReset(now = new Date()) {
  const tz = "America/Los_Angeles";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(now)
      .map((p) => [p.type, Number(p.value)]),
  );
  const msLeft = ((23 - parts.hour) * 3600 + (59 - parts.minute) * 60 + (60 - parts.second)) * 1000;
  const at = new Date(now.getTime() + msLeft);
  const h = Math.floor(msLeft / 3_600_000);
  const m = Math.ceil((msLeft % 3_600_000) / 60_000);
  const clock = at.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" });
  return `${h ? `${h} jam ` : ""}${m} menit lagi (pukul ${clock} WIB)`;
}

/** Ubah error mentah Gemini (JSON panjang) jadi pesan singkat yang bisa dibaca. */
export function geminiErrorMessage(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (/PerDay/i.test(msg)) return `Kuota harian Gemini habis. Reset ${dailyQuotaReset()}.`;
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

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { fileUri: string; mimeType: string } };

/** Unggah file besar lewat Files API (inline dibatasi ~20MB per request); file otomatis terhapus setelah 48 jam. */
export async function uploadFile(buf: Buffer, mimeType: string): Promise<GeminiPart> {
  let file = await ai().files.upload({ file: new Blob([new Uint8Array(buf)], { type: mimeType }), config: { mimeType } });
  for (let i = 0; file.state === "PROCESSING" && i < 60; i++) {
    await sleep(2000);
    file = await ai().files.get({ name: file.name! });
  }
  if (file.state !== "ACTIVE") throw new Error(`Gemini gagal memproses file (${file.state ?? "tanpa status"}).`);
  return { fileData: { fileUri: file.uri!, mimeType } };
}

/** Seperti generateJson, tapi bisa menyertakan file (PDF/gambar) sebagai inline data. */
export async function generateJsonParts<T>(parts: GeminiPart[]): Promise<T> {
  const res = await withRetry(() =>
    ai().models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts }],
      config: { responseMimeType: "application/json", temperature: 0.2 },
    }),
  );
  return JSON.parse(res.text ?? "{}") as T;
}
