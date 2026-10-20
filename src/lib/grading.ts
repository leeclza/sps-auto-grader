import { classroom as classroomApi, type classroom_v1 } from "@googleapis/classroom";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { OAuth2Client } from "google-auth-library";
import { db } from "@/db";
import { assignmentMaterials, assignments, courses, materialPages, submissions } from "@/db/schema";
import { generateJsonParts, geminiErrorMessage, type GeminiPart } from "./gemini";
import { getGoogleAuth } from "./google";
import { extractFromFile } from "./materials";
import { parseRubric, type RubricCriterion } from "./rubric";

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
    const submittedAt = s.updateTime ? new Date(s.updateTime) : null;
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

async function driveFileParts(auth: OAuth2Client, fileId: string): Promise<GeminiPart[]> {
  const base = `https://www.googleapis.com/drive/v3/files/${fileId}`;
  const meta = (await auth.request<{ name: string; mimeType: string; size?: string }>({
    url: `${base}?fields=name,mimeType,size&supportsAllDrives=true`,
  })).data;
  const header = { text: `\n--- File: ${meta.name} (${meta.mimeType}) ---\n` };

  const exportAs: Record<string, string> = {
    "application/vnd.google-apps.document": "text/plain",
    "application/vnd.google-apps.presentation": "text/plain",
    "application/vnd.google-apps.spreadsheet": "text/csv",
  };
  if (exportAs[meta.mimeType]) {
    const res = await auth.request<string>({
      url: `${base}/export?mimeType=${encodeURIComponent(exportAs[meta.mimeType])}`,
      responseType: "text",
    });
    return [header, { text: String(res.data).slice(0, 100_000) }];
  }
  if (meta.mimeType.startsWith("application/vnd.google-apps")) {
    return [header, { text: "(Jenis file Google ini tidak bisa dibaca otomatis.)" }];
  }
  if (Number(meta.size ?? 0) > MAX_INLINE_BYTES) return [header, { text: "(File terlalu besar untuk dibaca.)" }];

  const buf = Buffer.from(
    (await auth.request<ArrayBuffer>({ url: `${base}?alt=media&supportsAllDrives=true`, responseType: "arraybuffer" })).data,
  );
  // PDF & gambar dikirim apa adanya agar Gemini bisa membaca tulisan tangan, diagram, dsb.
  if (meta.mimeType === "application/pdf" || meta.mimeType.startsWith("image/")) {
    return [header, { inlineData: { mimeType: meta.mimeType, data: buf.toString("base64") } }];
  }
  try {
    const text = await extractFromFile(new File([buf], meta.name));
    return [header, { text: text.slice(0, 100_000) }];
  } catch {
    return [header, { text: "(Format file tidak didukung untuk dibaca otomatis.)" }];
  }
}

async function submissionParts(auth: OAuth2Client, content: SubmissionContent): Promise<GeminiPart[]> {
  const parts: GeminiPart[] = [];
  if (content.answer) parts.push({ text: `Jawaban singkat: ${content.answer}` });
  for (const a of content.attachments) {
    if (a.kind === "drive" && a.id) {
      try {
        parts.push(...(await driveFileParts(auth, a.id)));
      } catch (e) {
        parts.push({ text: `\n--- File: ${a.title ?? a.id} --- (gagal dibaca: ${(e as Error).message})` });
      }
    } else {
      parts.push({ text: `\n--- ${a.kind}: ${a.title ?? ""} ${a.url ?? ""} --- (isi tautan tidak dibuka)` });
    }
  }
  return parts;
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
    const sp = await submissionParts(auth, content);
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
  return Math.round((weighted / totalWeight / 100) * maxScore * 100) / 100;
}

async function gradeOne(auth: OAuth2Client, assignment: Assignment, rubric: RubricCriterion[], materi: string, sub: typeof submissions.$inferSelect) {
  const content: SubmissionContent = JSON.parse(sub.content ?? '{"attachments":[]}');
  const answerParts = await submissionParts(auth, content);
  if (!answerParts.length) {
    const scores = rubric.map((c) => ({ name: c.name, score: 0, comment: "Tidak ada jawaban/lampiran." }));
    return { scores, feedback: "Submission kosong: tidak ada lampiran atau jawaban." };
  }

  const prompt = `Kamu asisten dosen yang menilai tugas mahasiswa secara objektif dan konsisten.
Nilai jawaban mahasiswa di bawah berdasarkan RUBRIK dan MATERI ACUAN. Beri skor 0-100 untuk SETIAP kriteria.
Kembalikan JSON:
{"criteria": [{"name": "<nama kriteria persis seperti rubrik>", "score": angka 0-100, "comment": "alasan singkat"}],
 "feedback": "umpan balik 2-4 kalimat untuk mahasiswa, Bahasa Indonesia"}

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
  return { scores, feedback: res.feedback ?? "" };
}

/** Nilai semua submission berstatus "processing", lalu perbarui spreadsheet. Dijalankan di background. */
export async function gradeProcessing(userId: string, assignmentId: string) {
  const assignment = await db.query.assignments.findFirst({ where: eq(assignments.id, assignmentId) });
  if (!assignment) return;
  const rubric = parseRubric(assignment.rubric);
  const [auth, materi] = await Promise.all([getGoogleAuth(userId), gradingContext(assignmentId)]);
  const queue = await db
    .select()
    .from(submissions)
    .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.status, "processing")));

  for (const sub of queue) {
    try {
      const { scores, feedback } = await gradeOne(auth, assignment, rubric, materi, sub);
      const score = totalScore(rubric, scores, assignment.maxScore);
      await db
        .update(submissions)
        .set({ status: "graded", aiScore: score, finalScore: score, breakdown: JSON.stringify(scores), feedback, error: null, gradedAt: new Date() })
        .where(eq(submissions.id, sub.id));
    } catch (e) {
      await db.update(submissions).set({ status: "error", error: geminiErrorMessage(e) }).where(eq(submissions.id, sub.id));
    }
  }

  try {
    await exportToSheet(userId, assignmentId);
  } catch (e) {
    console.error("Gagal memperbarui spreadsheet:", e);
  }
}

// ---------- Spreadsheet SPS ----------

export const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

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
