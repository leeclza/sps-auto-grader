import { classroom as classroomApi, type classroom_v1 } from "@googleapis/classroom";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { OAuth2Client } from "google-auth-library";
import { db } from "@/db";
import { assignmentMaterials, assignments, courses, materialPages, submissions } from "@/db/schema";
import { generateJsonParts, geminiErrorMessage, uploadFile, type GeminiPart } from "./gemini";
import { getGoogleAuth } from "./google";
import { extractFromFile } from "./materials";
import { parseRubric, type RubricCriterion } from "./rubric";
import { detectSimilarity, type TextSegment } from "./similarity";

type Assignment = typeof assignments.$inferSelect;
type Course = typeof courses.$inferSelect;

/** Lampiran submission yang disimpan di kolom Submission.content. */
export interface SubmissionContent {
  answer?: string;
  attachments: { kind: "drive" | "link" | "youtube" | "form"; id?: string; title?: string | null; url?: string | null }[];
}

export interface CriterionScore {
  name: string;
  score: number; // 0-100
  comment: string;
}

const MAX_INLINE_BYTES = 15 * 1024 * 1024;
// Batas Files API Gemini untuk PDF.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

async function paginate<T>(fetchPage: (pageToken?: string) => Promise<{ items: T[]; next?: string | null }>) {
  const all: T[] = [];
  let token: string | undefined;
  do {
    const { items, next } = await fetchPage(token);
    all.push(...items);
    token = next ?? undefined;
  } while (token);
  return all;
}

function toContent(s: classroom_v1.Schema$StudentSubmission): SubmissionContent {
  const attachments: SubmissionContent["attachments"] = [];
  for (const a of s.assignmentSubmission?.attachments ?? []) {
    if (a.driveFile) attachments.push({ kind: "drive", id: a.driveFile.id!, title: a.driveFile.title, url: a.driveFile.alternateLink });
    else if (a.link) attachments.push({ kind: "link", title: a.link.title, url: a.link.url });
    else if (a.youTubeVideo) attachments.push({ kind: "youtube", title: a.youTubeVideo.title, url: a.youTubeVideo.alternateLink });
    else if (a.form) attachments.push({ kind: "form", title: a.form.title, url: a.form.responseUrl ?? a.form.formUrl });
  }
  const answer = s.shortAnswerSubmission?.answer ?? s.multipleChoiceSubmission?.answer ?? undefined;
  return { answer: answer ?? undefined, attachments };
}

/**
 * Tarik submission yang sudah dikumpulkan dari GCR ke DB.
 * Submission baru atau yang dikumpulkan ulang ditandai "pending" agar dinilai (ulang).
 */
export async function pullSubmissions(userId: string, assignment: Assignment, course: Course) {
  const classroom = classroomApi({ version: "v1", auth: await getGoogleAuth(userId) });
  const [subs, students] = await Promise.all([
    paginate(async (pageToken) => {
      const res = await classroom.courses.courseWork.studentSubmissions.list({
        courseId: course.externalId,
        courseWorkId: assignment.externalId,
        states: ["TURNED_IN", "RETURNED"],
        pageToken,
        pageSize: 100,
      });
      return { items: res.data.studentSubmissions ?? [], next: res.data.nextPageToken };
    }),
    paginate(async (pageToken) => {
      const res = await classroom.courses.students.list({ courseId: course.externalId, pageToken, pageSize: 100 });
      return { items: res.data.students ?? [], next: res.data.nextPageToken };
    }),
  ]);
  const profiles = new Map(students.map((s) => [s.userId!, s.profile]));

  const existing = new Map(
    (await db.select().from(submissions).where(eq(submissions.assignmentId, assignment.id))).map((s) => [s.externalId, s]),
  );

  for (const s of subs) {
    // Waktu terakhir dikumpulkan (TURNED_IN); updateTime ikut berubah saat dosen mengembalikan tugas.
    const turnedIn = (s.submissionHistory ?? [])
      .map((h) => h.stateHistory)
      .filter((h) => h?.state === "TURNED_IN" && h.stateTimestamp)
      .map((h) => h!.stateTimestamp!)
      .sort()
      .pop();
    const submittedAt = turnedIn ? new Date(turnedIn) : s.updateTime ? new Date(s.updateTime) : null;
    const prev = existing.get(s.id!);
    const changed = !prev || prev.submittedAt?.getTime() !== submittedAt?.getTime();
    const profile = profiles.get(s.userId!);
    const data = {
      studentId: s.userId!,
      studentName: profile?.name?.fullName ?? null,
      studentEmail: profile?.emailAddress ?? null,
      content: JSON.stringify(toContent(s)),
      submittedAt,
      late: !!s.late,
      ...(changed ? { status: "pending", error: null } : {}),
    };
    await db
      .insert(submissions)
      .values({ assignmentId: assignment.id, externalId: s.id!, ...data })
      .onConflictDoUpdate({ target: [submissions.assignmentId, submissions.externalId], set: data });
  }
  return subs.length;
}

// ---------- Baca isi lampiran ----------

/** Teks PDF per halaman (untuk cek kemiripan); kosong bila PDF hasil scan/gambar. */
async function pdfPages(buf: Buffer) {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: false });
    return text;
  } catch {
    return [];
  }
}

/** Teks PPTX per slide, diambil dari ppt/slides/slideN.xml. */
async function pptxSlides(buf: Buffer) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files)
    .map((name) => ({ name, n: Number(name.match(/^ppt\/slides\/slide(\d+)\.xml$/)?.[1]) }))
    .filter((s) => s.n)
    .sort((a, b) => a.n - b.n);
  return Promise.all(
    slides.map(async (s) => {
      const xml = await zip.file(s.name)!.async("string");
      // Tiap paragraf (<a:p>) jadi satu baris agar judul slide terdeteksi sebagai bagian.
      return xml
        .split(/<\/a:p>/)
        .map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(""))
        .filter(Boolean)
        .join("\n");
    }),
  );
}

const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** Gambar yang tertanam di DOCX/PPTX (word/media, ppt/media), agar screenshot ikut terbaca Gemini. */
async function officeImages(buf: Buffer): Promise<GeminiPart[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const files = Object.keys(zip.files)
    .filter((name) => /^(word|ppt)\/media\//.test(name) && IMAGE_MIME[name.split(".").pop()!.toLowerCase()])
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const parts: GeminiPart[] = [];
  let total = 0;
  for (const name of files) {
    const data = await zip.file(name)!.async("nodebuffer");
    if (total + data.length > MAX_INLINE_BYTES) break;
    total += data.length;
    parts.push({ inlineData: { mimeType: IMAGE_MIME[name.split(".").pop()!.toLowerCase()], data: data.toString("base64") } });
  }
  return parts.length ? [{ text: `(${parts.length} gambar di dalam file, berurutan:)` }, ...parts] : [];
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

interface FileRead {
  parts: GeminiPart[];
  segments: TextSegment[];
}

async function driveFileParts(auth: OAuth2Client, fileId: string): Promise<FileRead> {
  const base = `https://www.googleapis.com/drive/v3/files/${fileId}`;
  const meta = (await auth.request<{ name: string; mimeType: string; size?: string }>({
    url: `${base}?fields=name,mimeType,size&supportsAllDrives=true`,
  })).data;
  const header = { text: `\n--- File: ${meta.name} (${meta.mimeType}) ---\n` };
  const download = async (url: string) =>
    Buffer.from((await auth.request<ArrayBuffer>({ url, responseType: "arraybuffer" })).data);
  // File besar diunggah lewat Files API, sisanya inline.
  const filePart = (buf: Buffer, mimeType: string): Promise<GeminiPart> | GeminiPart =>
    buf.length > MAX_INLINE_BYTES ? uploadFile(buf, mimeType) : { inlineData: { mimeType, data: buf.toString("base64") } };
  const pdfRead = async (buf: Buffer, unit: "halaman" | "slide"): Promise<FileRead> => ({
    // PDF dikirim apa adanya agar Gemini bisa membaca tulisan tangan, diagram, dsb.
    parts: [header, await filePart(buf, "application/pdf")],
    segments: (await pdfPages(buf)).map((text, i) => ({ file: meta.name, loc: `${unit} ${i + 1}`, text })),
  });

  // Google Slides diekspor ke PDF agar tiap halaman = satu slide.
  if (meta.mimeType === "application/vnd.google-apps.presentation") {
    return pdfRead(await download(`${base}/export?mimeType=application%2Fpdf`), "slide");
  }
  const exportText = async (mime: string) =>
    String((await auth.request<string>({ url: `${base}/export?mimeType=${encodeURIComponent(mime)}`, responseType: "text" })).data).slice(0, 100_000);
  // Google Docs diekspor ke PDF agar gambar/screenshot ikut terbaca; teksnya untuk cek kemiripan.
  if (meta.mimeType === "application/vnd.google-apps.document") {
    const [pdf, text] = await Promise.all([download(`${base}/export?mimeType=application%2Fpdf`), exportText("text/plain")]);
    return {
      parts: [header, await filePart(pdf, "application/pdf")],
      segments: [{ file: meta.name, loc: "", text }],
    };
  }
  if (meta.mimeType === "application/vnd.google-apps.spreadsheet") {
    const text = await exportText("text/csv");
    return { parts: [header, { text }], segments: [{ file: meta.name, loc: "", text }] };
  }
  if (meta.mimeType.startsWith("application/vnd.google-apps")) {
    return { parts: [header, { text: "(Jenis file Google ini tidak bisa dibaca otomatis.)" }], segments: [] };
  }
  const size = Number(meta.size ?? 0);
  const uploadable = meta.mimeType === "application/pdf" || meta.mimeType.startsWith("image/");
  // Error dilempar agar submission ditandai gagal, bukan dinilai tanpa isi.
  if (size > (uploadable ? MAX_UPLOAD_BYTES : MAX_INLINE_BYTES)) {
    throw new Error(`file terlalu besar (${(size / 1024 / 1024).toFixed(1)} MB, maks ${(uploadable ? MAX_UPLOAD_BYTES : MAX_INLINE_BYTES) / 1024 / 1024} MB)`);
  }

  const buf = await download(`${base}?alt=media&supportsAllDrives=true`);
  if (meta.mimeType === "application/pdf") return pdfRead(buf, "halaman");
  if (meta.mimeType.startsWith("image/")) {
    return { parts: [header, await filePart(buf, meta.mimeType)], segments: [] };
  }
  try {
    if (/\.pptx$/i.test(meta.name)) {
      const slides = (await pptxSlides(buf)).map(decodeXml);
      const text = slides.map((t, i) => `[Slide ${i + 1}]\n${t}`).join("\n\n").slice(0, 100_000);
      const images = await officeImages(buf).catch(() => []);
      return { parts: [header, { text }, ...images], segments: slides.map((t, i) => ({ file: meta.name, loc: `slide ${i + 1}`, text: t })) };
    }
    const text = (await extractFromFile(new File([buf], meta.name))).slice(0, 100_000);
    const images = /\.docx$/i.test(meta.name) ? await officeImages(buf).catch(() => []) : [];
    return { parts: [header, { text }, ...images], segments: [{ file: meta.name, loc: "", text }] };
  } catch {
    return { parts: [header, { text: "(Format file tidak didukung untuk dibaca otomatis.)" }], segments: [] };
  }
}

async function submissionParts(auth: OAuth2Client, content: SubmissionContent): Promise<FileRead & { failed: string[] }> {
  const parts: GeminiPart[] = [];
  const segments: TextSegment[] = [];
  const failed: string[] = [];
  if (content.answer) {
    parts.push({ text: `Jawaban singkat: ${content.answer}` });
    segments.push({ file: "Jawaban singkat", loc: "", text: content.answer });
  }
  for (const a of content.attachments) {
    if (a.kind === "drive" && a.id) {
      try {
        const read = await driveFileParts(auth, a.id);
        parts.push(...read.parts);
        segments.push(...read.segments);
      } catch (e) {
        parts.push({ text: `\n--- File: ${a.title ?? a.id} --- (gagal dibaca: ${(e as Error).message})` });
        failed.push(`${a.title ?? a.id}: ${(e as Error).message}`);
      }
    } else {
      parts.push({ text: `\n--- ${a.kind}: ${a.title ?? ""} ${a.url ?? ""} --- (isi tautan tidak dibuka)` });
    }
  }
  return { parts, segments, failed };
}

/**
 * Tarik submission terbaru dari GCR lalu baca isi beberapa di antaranya,
 * sebagai contoh format jawaban mahasiswa (dipakai saat membuat rubrik dengan AI).
 */
export async function sampleSubmissionParts(userId: string, assignment: Assignment, course: Course, limit = 4) {
  await pullSubmissions(userId, assignment, course);
  const subs = await db.select().from(submissions).where(eq(submissions.assignmentId, assignment.id));
  // Acak agar contoh tidak selalu dari mahasiswa yang sama.
  const picked = subs.sort(() => Math.random() - 0.5).slice(0, limit);
  const auth = await getGoogleAuth(userId);
  const parts: GeminiPart[] = [];
  let count = 0;
  for (const s of picked) {
    const content: SubmissionContent = JSON.parse(s.content ?? '{"attachments":[]}');
    const { parts: sp } = await submissionParts(auth, content);
    if (!sp.length) continue;
    parts.push({ text: `\n===== Contoh jawaban #${++count} =====` }, ...sp);
  }
  return { parts, count, total: subs.length };
}

// ---------- Penilaian ----------

async function gradingContext(assignmentId: string) {
  const links = await db
    .select({ materialId: assignmentMaterials.materialId })
    .from(assignmentMaterials)
    .where(eq(assignmentMaterials.assignmentId, assignmentId));
  return materialsContext(links.map((l) => l.materialId));
}

/** Teks materi acuan (ringkasan, konsep kunci, isi) untuk prompt Gemini. */
export async function materialsContext(materialIds: string[]) {
  const mats = materialIds.length
    ? await db.query.materials.findMany({
        where: (m) => inArray(m.id, materialIds),
        with: { pages: { orderBy: asc(materialPages.order) } },
      })
    : [];
  return mats
    .map((m) => {
      const body = m.pages.map((p) => p.content).join("\n").slice(0, 30_000);
      return `### ${m.title}\nRingkasan: ${m.summary ?? "-"}\nKonsep kunci: ${m.keyConcepts ?? "-"}\nIsi:\n${body}`;
    })
    .join("\n\n")
    .slice(0, 120_000);
}

/** Skor akhir (skala maxScore) dari skor 0-100 per kriteria dan bobot rubrik. */
export function totalScore(rubric: RubricCriterion[], scores: CriterionScore[], maxScore: number) {
  const totalWeight = rubric.reduce((s, c) => s + c.weight, 0) || 1;
  const weighted = rubric.reduce((s, c) => {
    const found = scores.find((x) => x.name === c.name);
    return s + (found ? Math.max(0, Math.min(100, found.score)) : 0) * c.weight;
  }, 0);
  // Dibulatkan ke atas: 77,1 s.d. 77,9 jadi 78 (toleransi kecil agar galat float tidak menaikkan nilai bulat).
  return Math.ceil((weighted / totalWeight / 100) * maxScore - 1e-9);
}

async function gradeOne(auth: OAuth2Client, assignment: Assignment, rubric: RubricCriterion[], materi: string, sub: typeof submissions.$inferSelect) {
  const content: SubmissionContent = JSON.parse(sub.content ?? '{"attachments":[]}');
  const { parts: answerParts, segments, failed } = await submissionParts(auth, content);
  // Jangan menilai tanpa isi file: tandai error agar bisa dinilai ulang setelah masalahnya beres.
  if (failed.length) {
    const drive = failed.some((f) => /Drive API has not been used|accessNotConfigured/i.test(f));
    throw new Error(
      drive
        ? "Google Drive API belum aktif di project Google Cloud. Aktifkan di console.cloud.google.com/apis/library/drive.googleapis.com lalu nilai ulang."
        : `Lampiran gagal dibaca: ${failed.join("; ").slice(0, 250)}`,
    );
  }
  if (!answerParts.length) {
    const scores = rubric.map((c) => ({ name: c.name, score: 0, comment: "Tidak ada jawaban/lampiran." }));
    return { scores, feedback: "Submission kosong: tidak ada lampiran atau jawaban.", segments };
  }

  const prompt = `Kamu asisten dosen yang menilai tugas mahasiswa secara objektif dan konsisten.
Nilai jawaban mahasiswa di bawah berdasarkan RUBRIK dan MATERI ACUAN. Beri skor 0-100 untuk SETIAP kriteria.
Kembalikan JSON:
{"criteria": [{"name": "<nama kriteria persis seperti rubrik>", "score": angka 0-100, "comment": "alasan singkat"}],
 "feedback": "umpan balik 2-4 kalimat untuk mahasiswa, Bahasa Indonesia"}

Aturan feedback:
- Fokus pada isi jawaban: apa yang sudah baik dan apa yang perlu diperbaiki untuk tugas berikutnya.
- Pengumpulan bersifat final. JANGAN menyuruh mahasiswa mengumpulkan ulang, merevisi submission ini,
  atau menghubungi dosen/asisten untuk konfirmasi. Jika format/file tidak sesuai, cukup cerminkan di skor
  dan sebutkan singkat sebagai catatan.
- Lampiran bisa berupa PDF/gambar berisi screenshot, kode, output program, diagram, atau tulisan tangan.
  Periksa isi visualnya dengan teliti dan nilai berdasarkan isinya. Jangan anggap jawaban kosong hanya karena
  isinya berupa gambar.

Standar penilaian (ikuti kecuali dosen menulis lain di catatan penilaian):
- Nilai secara apresiatif, bukan mencari-cari kesalahan. Patokan skor per kriteria:
  95-100 = sangat baik/melebihi harapan; 90-94 = jelas, runut, dan memenuhi tuntutan; 80-89 = cukup, ada kekurangan nyata;
  60-79 = banyak bagian kurang/tidak sesuai; <60 = hampir tidak dikerjakan atau sama sekali tidak relevan.
- Jawaban yang mengerjakan tugas dengan jelas dan runut MINIMAL 90 untuk kriteria tersebut.
- Bentuk dokumen bebas bila instruksi tidak mewajibkan (laporan, PPT, diagram, dsb.); jangan kurangi skor karena bentuknya.
  Bentuk yang lebih visual dan butuh usaha lebih (slide/PPT, diagram/flowchart rapi) boleh dihargai lebih tinggi
  daripada laporan teks biasa.
- Topik yang sedikit bergeser dari instruksi tapi masih menunjukkan pemahaman konsep: kurangi sedikit saja (sekitar 5),
  jangan jatuhkan ke bawah 80.
- Kekurangan kecil (penamaan file, detail kecil) cukup dikurangi beberapa poin.

Judul tugas: ${assignment.title}
Instruksi tugas: ${assignment.instructions || assignment.description || "-"}
${assignment.gradingNotes ? `Catatan penilaian dari dosen: ${assignment.gradingNotes}\n` : ""}
RUBRIK:
${rubric.map((c) => `- ${c.name} (bobot ${c.weight}%): ${c.description}`).join("\n")}

MATERI ACUAN:
${materi || "(tidak ada)"}

JAWABAN MAHASISWA:`;

  const res = await generateJsonParts<{ criteria: CriterionScore[]; feedback: string }>([{ text: prompt }, ...answerParts]);
  const scores = rubric.map((c) => {
    const r = res.criteria?.find((x) => x.name.trim().toLowerCase() === c.name.trim().toLowerCase());
    return { name: c.name, score: Number(r?.score) || 0, comment: r?.comment ?? "" };
  });
  return { scores, feedback: stripResubmitAdvice(res.feedback ?? ""), segments };
}

/** Pengumpulan bersifat final: buang kalimat yang menyuruh kumpul ulang / menghubungi dosen. */
function stripResubmitAdvice(feedback: string) {
  const banned = /(hubungi|menghubungi|konfirmasi|kumpul(kan)? ulang|pengumpulan ulang|unggah ulang|upload ulang|revisi submission)/i;
  return (feedback.match(/[^.!?]+[.!?]*\s*/g) ?? [feedback])
    .filter((s) => !banned.test(s))
    .join("")
    .trim();
}

/** Nilai semua submission berstatus "processing", lalu perbarui spreadsheet. Dijalankan di background. */
/** Urutan abjad seperti GCR "Sort by first name" (abaikan huruf besar/kecil); dipakai tabel nilai & antrean koreksi. */
export function byStudentName(a: { studentName: string | null }, b: { studentName: string | null }) {
  return (a.studentName ?? "").trim().localeCompare((b.studentName ?? "").trim(), "id", { sensitivity: "base" });
}

// Assignment yang sedang dikoreksi, agar tidak ada dua proses berjalan paralel.
const running = new Set<string>();

export async function gradeProcessing(userId: string, assignmentId: string) {
  if (running.has(assignmentId)) return; // proses yang berjalan akan mengambil antrean baru
  running.add(assignmentId);
  try {
    await gradeQueue(userId, assignmentId);
  } finally {
    running.delete(assignmentId);
  }
}

async function gradeQueue(userId: string, assignmentId: string) {
  const assignment = await db.query.assignments.findFirst({ where: eq(assignments.id, assignmentId) });
  if (!assignment) return;
  const rubric = parseRubric(assignment.rubric);
  const [auth, materi] = await Promise.all([getGoogleAuth(userId), gradingContext(assignmentId)]);
  // FIFO: satu per satu dari baris paling atas tabel; antrean dibaca ulang tiap putaran agar tambahan ikut urut.
  const nextInQueue = async () => {
    const rows = await db
      .select()
      .from(submissions)
      .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.status, "processing")));
    return rows.sort(byStudentName)[0];
  };

  // Hanya tulis hasil bila masih "processing": stopGrading mengembalikannya ke "pending".
  const stillProcessing = (id: string) => and(eq(submissions.id, id), eq(submissions.status, "processing"));
  for (let sub = await nextInQueue(); sub; sub = await nextInQueue()) {
    try {
      const { scores, feedback, segments } = await gradeOne(auth, assignment, rubric, materi, sub);
      const score = totalScore(rubric, scores, assignment.maxScore);
      await db
        .update(submissions)
        .set({
          status: "graded",
          aiScore: score,
          finalScore: score,
          breakdown: JSON.stringify(scores),
          feedback,
          error: null,
          gradedAt: new Date(),
          textSegments: JSON.stringify(segments),
        })
        .where(stillProcessing(sub.id));
    } catch (e) {
      await db.update(submissions).set({ status: "error", error: geminiErrorMessage(e) }).where(stillProcessing(sub.id));
    }
  }

  try {
    await detectSimilarity(assignmentId);
  } catch (e) {
    console.error("Gagal mengecek kemiripan:", e);
  }
  try {
    await exportToSheet(userId, assignmentId);
  } catch (e) {
    console.error("Gagal memperbarui spreadsheet:", e);
  }
}

// ---------- Spreadsheet SPS ----------

/** Selisih waktu dalam bentuk "2 hari 3 jam" / "45 menit". */
function lateDuration(ms: number) {
  if (ms <= 0) return "";
  const min = Math.ceil(ms / 60_000);
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return [d && `${d} hari`, h && `${h} jam`, !d && m && `${m} menit`].filter(Boolean).join(" ");
}

export const sheetUrl =(id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

/** Tulis ulang rekap nilai ke Google Sheets; spreadsheet dibuat otomatis bila belum ada. */
export async function exportToSheet(userId: string, assignmentId: string) {
  const assignment = await db.query.assignments.findFirst({
    where: eq(assignments.id, assignmentId),
    with: { course: true },
  });
  if (!assignment) throw new Error("Tugas tidak ditemukan");
  const auth = await getGoogleAuth(userId);
  const rubric = parseRubric(assignment.rubric);
  const rows = await db
    .select()
    .from(submissions)
    .where(eq(submissions.assignmentId, assignmentId))
    .orderBy(asc(submissions.studentName));

  let spreadsheetId = assignment.spreadsheetId;
  if (spreadsheetId) {
    // Spreadsheet bisa saja dihapus user dari Drive; buat baru jika sudah tidak bisa diakses.
    try {
      await auth.request({ url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetId` });
    } catch {
      spreadsheetId = null;
    }
  }
  if (!spreadsheetId) {
    const res = await auth.request<{ spreadsheetId: string }>({
      url: "https://sheets.googleapis.com/v4/spreadsheets",
      method: "POST",
      data: {
        properties: { title: `SPS - ${assignment.course.name} - ${assignment.title}` },
        sheets: [{ properties: { title: "Nilai", gridProperties: { frozenRowCount: 1 } } }],
      },
    });
    spreadsheetId = res.data.spreadsheetId;
    await db.update(assignments).set({ spreadsheetId }).where(eq(assignments.id, assignmentId));
  }

  const header = [
    "No",
    "Nama",
    "Email",
    ...rubric.map((c) => `${c.name} (${c.weight}%)`),
    `Nilai (maks ${assignment.maxScore})`,
    "Terlambat",
    "Waktu kumpul",
    "Lama telat",
    "Status",
    "Feedback",
  ];
  const statusLabel: Record<string, string> = {
    pending: "Belum dinilai",
    processing: "Sedang dinilai",
    graded: "Dinilai AI",
    reviewed: "Dicek",
    error: "Gagal",
  };
  const body = rows.map((r, i) => {
    const scores: CriterionScore[] = r.breakdown ? JSON.parse(r.breakdown) : [];
    return [
      i + 1,
      r.studentName ?? r.studentId,
      r.studentEmail ?? "",
      ...rubric.map((c) => scores.find((s) => s.name === c.name)?.score ?? ""),
      r.finalScore ?? r.aiScore ?? "",
      r.late ? "Ya" : "",
      r.submittedAt ? r.submittedAt.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) : "",
      r.late && r.submittedAt && assignment.dueDate ? lateDuration(r.submittedAt.getTime() - assignment.dueDate.getTime()) : "",
      statusLabel[r.status] ?? r.status,
      r.status === "error" ? r.error ?? "" : r.feedback ?? "",
    ];
  });

  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  await auth.request({ url: `${base}/values/Nilai:clear`, method: "POST", data: {} });
  await auth.request({
    url: `${base}/values/Nilai!A1?valueInputOption=RAW`,
    method: "PUT",
    data: { values: [header, ...body] },
  });
  return spreadsheetId;
}
