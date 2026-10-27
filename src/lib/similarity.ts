import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assignments, submissions } from "@/db/schema";

/** Potongan teks lampiran beserta lokasinya (file + halaman/slide). */
export interface TextSegment {
  file: string;
  loc: string; // mis. "halaman 3", "slide 5", atau "" bila tidak berhalaman
  text: string;
}

export interface SimilarityPassage {
  snippet: string;
  words: number;
  here: string; // lokasi di submission ini
  there: string; // lokasi di submission pembanding
}

export interface SimilarityMatch {
  withId: string;
  withName: string;
  sharedWords: number;
  percent: number;
  passages: SimilarityPassage[];
}

// Potongan K kata berurutan yang identik dianggap jejak salin-tempel.
const K = 8;
// Minimal ±30 kata identik (tidak harus satu blok) agar dianggap mirip.
const MIN_SHARED = 25;
const MAX_PASSAGES = 4;

const HEADING_WORDS =
  /^(abstrak|abstract|pendahuluan|latar belakang|rumusan masalah|tujuan|manfaat|batasan masalah|tinjauan pustaka|landasan teori|dasar teori|metode|metodologi|hasil|pembahasan|analisis|implementasi|kesimpulan|saran|penutup|daftar pustaka|referensi|lampiran)\b/i;

function isHeading(line: string) {
  const t = line.trim();
  if (!t || t.length > 80) return false;
  if (/^bab\s+[ivxlc\d]+/i.test(t)) return true;
  if (/^(\d+(\.\d+)*|[ivx]+|[a-h])[.)]\s+\S/i.test(t) && t.split(/\s+/).length <= 8) return true;
  if (HEADING_WORDS.test(t.replace(/^[\d.ivx)\s]+/i, ""))) return true;
  return t.length >= 4 && t === t.toUpperCase() && /[A-Z]/.test(t) && t.split(/\s+/).length <= 8;
}

interface Word {
  norm: string;
  raw: string;
  where: string;
}

/** Pecah segmen menjadi kata, tiap kata membawa lokasi lengkap (file · halaman · bagian). */
function toWords(segments: TextSegment[]) {
  const words: Word[] = [];
  const headingByFile = new Map<string, string>();
  for (const seg of segments) {
    for (const line of seg.text.split(/\r?\n/)) {
      if (isHeading(line)) headingByFile.set(seg.file, line.trim().replace(/\s+/g, " ").slice(0, 60));
      const heading = headingByFile.get(seg.file);
      const where = [seg.file, seg.loc, heading && `bagian "${heading}"`].filter(Boolean).join(" · ");
      for (const raw of line.split(/\s+/)) {
        const norm = raw.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
        if (norm) words.push({ norm, raw, where });
      }
    }
  }
  return words;
}

const shingleAt = (w: Word[], i: number) => w.slice(i, i + K).map((x) => x.norm).join(" ");

function shingleSet(words: Word[]) {
  const first = new Map<string, number>();
  for (let i = 0; i + K <= words.length; i++) {
    const s = shingleAt(words, i);
    if (!first.has(s)) first.set(s, i);
  }
  return first;
}

/** Ambil bagian teks A yang identik dengan B, urut dari yang terpanjang. */
function passages(a: Word[], b: Word[], bShingles: Map<string, number>, ignored: Set<string>): SimilarityPassage[] {
  const runs: { start: number; end: number; bAt: number }[] = [];
  let cur: { start: number; end: number; bAt: number } | null = null;
  for (let i = 0; i + K <= a.length; i++) {
    const s = shingleAt(a, i);
    const bAt = ignored.has(s) ? undefined : bShingles.get(s);
    if (bAt === undefined) continue;
    if (cur && i <= cur.end) cur.end = i + K;
    else {
      cur = { start: i, end: i + K, bAt };
      runs.push(cur);
    }
  }
  return runs
    .sort((x, y) => y.end - y.start - (x.end - x.start))
    .slice(0, MAX_PASSAGES)
    .map((r) => {
      const words = a.slice(r.start, r.end);
      const shown = words.slice(0, 40).map((w) => w.raw).join(" ");
      return {
        snippet: words.length > 40 ? `${shown} …` : shown,
        words: words.length,
        here: a[r.start].where,
        there: b[r.bAt].where,
      };
    });
}

const normText = (t: string) => ` ${t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

/** Apakah mahasiswa tercantum di teks (NIM dari email, nama lengkap, atau dua kata pertama nama). */
function listedIn(text: string, name: string | null, email: string | null) {
  const nim = email?.match(/\d{6,}/)?.[0];
  if (nim && text.includes(` ${nim} `)) return true;
  const parts = normText(name ?? "").trim().split(" ").filter(Boolean);
  if (parts.length < 2) return false;
  return text.includes(` ${parts.join(" ")} `) || text.includes(` ${parts.slice(0, 2).join(" ")} `);
}

/**
 * Bandingkan teks semua submission satu tugas. Yang memiliki potongan teks identik cukup panjang
 * ditandai mirip beserta buktinya. Teks yang muncul di banyak submission (template, soal, kop)
 * dan teks dari instruksi tugas diabaikan. Bila tugas ditandai kelompok, pasangan yang saling tercantum
 * namanya/NIM-nya di file masing-masing dianggap satu kelompok dan tidak ditandai.
 */
export async function detectSimilarity(assignmentId: string) {
  const assignment = await db.query.assignments.findFirst({ where: eq(assignments.id, assignmentId) });
  if (!assignment) return;
  const subs = await db.select().from(submissions).where(eq(submissions.assignmentId, assignmentId));

  const docs = subs
    .map((s) => {
      const segments: TextSegment[] = s.textSegments ? JSON.parse(s.textSegments) : [];
      const words = toWords(segments);
      const text = normText(segments.map((g) => g.text).join("\n"));
      return { sub: s, words, text, shingles: shingleSet(words) };
    })
    .filter((d) => d.shingles.size > 0);

  // Abaikan teks soal/instruksi dan teks yang dipakai banyak mahasiswa (template).
  const ignored = new Set(
    shingleSet(toWords([{ file: "", loc: "", text: `${assignment.instructions ?? ""}\n${assignment.description ?? ""}` }])).keys(),
  );
  const owners = new Map<string, number[]>();
  docs.forEach((d, idx) => {
    for (const s of d.shingles.keys()) {
      if (ignored.has(s)) continue;
      const list = owners.get(s);
      if (list) list.push(idx);
      else owners.set(s, [idx]);
    }
  });
  // Tugas kelompok: satu file memang dikumpulkan banyak orang, jadi batas "template" tidak dipakai
  // (kalau dipakai, penumpang di kelompok besar bisa lolos).
  const cap = assignment.groupWork ? Infinity : Math.max(3, Math.ceil(docs.length * 0.2));
  const pairCount = new Map<string, number>();
  for (const [s, list] of owners) {
    if (list.length < 2) continue;
    if (list.length > cap) {
      ignored.add(s);
      continue;
    }
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const key = `${list[i]}:${list[j]}`;
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      }
  }

  const matches = new Map<string, SimilarityMatch[]>();
  const autoReject = new Set<string>();
  for (const [key, shared] of pairCount) {
    if (shared < MIN_SHARED) continue;
    const [i, j] = key.split(":").map(Number);
    const [a, b] = [docs[i], docs[j]];
    const percent = Math.round((shared / Math.min(a.shingles.size, b.shingles.size)) * 100);
    const sharedWords = shared + K - 1;
    const add = (x: typeof a, y: typeof a) => {
      const list = matches.get(x.sub.id) ?? [];
      list.push({
        withId: y.sub.id,
        withName: y.sub.studentName ?? y.sub.studentId,
        sharedWords,
        percent,
        passages: passages(x.words, y.words, y.shingles, ignored),
      });
      matches.set(x.sub.id, list);
    };
    if (!assignment.groupWork) {
      add(a, b);
      add(b, a);
      continue;
    }
    // Tugas kelompok: yang namanya tidak tercantum di file yang ia kumpulkan berarti bukan
    // anggota kelompok tersebut → ditandai dan otomatis ditolak (nilai 0). Anggota yang
    // tercantum tidak ikut ditandai hanya karena filenya dipakai orang lain.
    const aIn = listedIn(a.text, a.sub.studentName, a.sub.studentEmail);
    const bIn = listedIn(b.text, b.sub.studentName, b.sub.studentEmail);
    if (aIn && bIn && listedIn(a.text, b.sub.studentName, b.sub.studentEmail) && listedIn(b.text, a.sub.studentName, a.sub.studentEmail))
      continue;
    if (!aIn) {
      add(a, b);
      if (bIn) autoReject.add(a.sub.id);
    }
    if (!bIn) {
      add(b, a);
      if (aIn) autoReject.add(b.sub.id);
    }
    // Dua kelompok berbeda (keduanya tercantum di file masing-masing) tapi isinya sama.
    if (aIn && bIn) {
      add(a, b);
      add(b, a);
    }
  }

  for (const s of subs) {
    const found = (matches.get(s.id) ?? []).sort((x, y) => y.sharedWords - x.sharedWords);
    // Keputusan "terima" dari dosen tetap dihormati walau otomatis ditolak.
    const decision = found.length
      ? s.similarityDecision ?? (autoReject.has(s.id) ? "rejected" : null)
      : null;
    await db
      .update(submissions)
      .set({
        similarity: found.length ? JSON.stringify(found) : null,
        similarityDecision: decision,
        // Penilaian ulang tidak boleh membatalkan keputusan "tolak".
        ...(decision === "rejected" ? { finalScore: 0 } : {}),
      })
      .where(eq(submissions.id, s.id));
  }
}
