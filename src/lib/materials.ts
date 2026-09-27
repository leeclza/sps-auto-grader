import * as cheerio from "cheerio";
import { generateJson, geminiErrorMessage } from "./gemini";
import { prisma } from "./prisma";

const MAX_CRAWL_PAGES = 40;

export interface ExtractedPage {
  url?: string;
  title: string;
  content: string;
}

/** Tebak nomor pertemuan dari URL/judul, mis. "pertemuan-3.html" atau "Pertemuan 3". */
export function guessMeeting(...hints: (string | undefined | null)[]) {
  for (const h of hints) {
    const m = h?.match(/(?:pertemuan|meeting|minggu|week|p)[\s_-]*(\d{1,2})\b/i);
    if (m) return Number(m[1]);
  }
  return null;
}

function htmlToPage(html: string, url: string): ExtractedPage & { links: string[] } {
  const $ = cheerio.load(html);
  const links = $("a[href]")
    .map((_, a) => $(a).attr("href"))
    .get()
    .map((href) => {
      try {
        const u = new URL(href, url);
        u.hash = "";
        return u.toString();
      } catch {
        return null;
      }
    })
    .filter((u): u is string => !!u);

  $("script, style, noscript, svg, iframe, nav, footer, header nav").remove();
  const title = $("title").first().text().trim() || $("h1").first().text().trim() || url;
  const blocks: string[] = [];
  $("h1, h2, h3, h4, p, li, pre, code, td, th, blockquote, figcaption").each((_, el) => {
    // Hindari duplikasi teks dari elemen bersarang (mis. <code> di dalam <pre>/<p>).
    if ($(el).parents("p, li, pre, td, th, blockquote").length) return;
    const tag = el.tagName.toLowerCase();
    const text = tag === "pre" ? $(el).text() : $(el).text().replace(/\s+/g, " ").trim();
    if (!text) return;
    if (/^h[1-4]$/.test(tag)) blocks.push(`\n${"#".repeat(Number(tag[1]))} ${text}`);
    else if (tag === "li") blocks.push(`- ${text}`);
    else if (tag === "pre") blocks.push("```\n" + text.trim() + "\n```");
    else blocks.push(text);
  });
  let content = blocks.join("\n").trim();
  if (content.length < 200) content = $("body").text().replace(/\s+/g, " ").trim();
  return { url, title, content, links };
}

async function fetchHtml(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": "SPS-Auto-Grader/0.1 (materi kuliah)" } });
  if (!res.ok) throw new Error(`Gagal mengambil ${url} (HTTP ${res.status})`);
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/pdf")) {
    return { pdf: Buffer.from(await res.arrayBuffer()) };
  }
  return { html: await res.text() };
}

/**
 * Ambil materi dari link. Jika `crawl` aktif, ikuti tautan dalam folder yang sama
 * (mis. https://informatika-itera.github.io/dtd/ → pertemuan-1.html, pertemuan-2.html, ...).
 */
export async function extractFromUrl(startUrl: string, crawl: boolean): Promise<ExtractedPage[]> {
  const base = new URL(startUrl);
  const scope = base.origin + base.pathname.replace(/[^/]*$/, "");
  const queue = [base.toString()];
  const seen = new Set<string>();
  const pages: ExtractedPage[] = [];

  while (queue.length && pages.length < MAX_CRAWL_PAGES) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const fetched = await fetchHtml(url);
    if (fetched.pdf) {
      pages.push({ url, title: decodeURIComponent(url.split("/").pop() || url), content: await extractPdf(fetched.pdf) });
      continue;
    }
    const page = htmlToPage(fetched.html!, url);
    pages.push({ url: page.url, title: page.title, content: page.content });
    if (crawl) {
      for (const link of page.links) {
        if (link.startsWith(scope) && !seen.has(link) && /(\.html?|\/|\.pdf)$/i.test(new URL(link).pathname)) {
          queue.push(link);
        }
      }
    }
  }
  return pages;
}

async function extractPdf(buf: Buffer) {
  const pdfParse = (await import("pdf-parse")).default;
  return (await pdfParse(buf)).text.trim();
}

export async function extractFromFile(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return extractPdf(buf);
  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer: buf })).value.trim();
  }
  if (name.endsWith(".html") || name.endsWith(".htm")) return htmlToPage(buf.toString("utf8"), "file://" + name).content;
  if (/\.(txt|md|markdown|py|c|cpp|java|js|ts|ipynb|csv|json)$/.test(name)) return buf.toString("utf8");
  throw new Error("Format file belum didukung. Gunakan PDF, DOCX, HTML, TXT/MD, atau file kode.");
}

/**
 * "Pelajari" materi: minta Gemini meringkas dan mengekstrak konsep kunci,
 * yang nanti dipakai sebagai patokan saat menilai jawaban mahasiswa.
 * Teks lengkap tetap disimpan di MaterialPage dan ikut dikirim saat grading.
 */
export async function learnMaterial(materialId: string) {
  const material = await prisma.material.findUniqueOrThrow({
    where: { id: materialId },
    include: { pages: { orderBy: { order: "asc" } } },
  });
  const text = material.pages.map((p) => `## ${p.title ?? ""}\n${p.content}`).join("\n\n").slice(0, 200_000);
  try {
    const result = await generateJson<{ summary: string; keyConcepts: string[] }>(
      `Kamu adalah asisten dosen mata kuliah ${material.subject}. Pelajari materi berikut dan hasilkan JSON:
{"summary": "ringkasan materi 1-2 paragraf dalam Bahasa Indonesia",
 "keyConcepts": ["daftar konsep/kompetensi kunci yang bisa dinilai dari tugas mahasiswa"]}

Judul materi: ${material.title}

MATERI:
${text}`,
    );
    await prisma.material.update({
      where: { id: materialId },
      data: {
        status: "ready",
        error: null,
        summary: result.summary,
        keyConcepts: JSON.stringify(result.keyConcepts ?? []),
      },
    });
  } catch (e) {
    // Teks materi tetap tersimpan & tetap bisa dipakai grading walau ringkasan AI gagal.
    await prisma.material.update({
      where: { id: materialId },
      data: { status: "error", error: geminiErrorMessage(e) },
    });
  }
}
