"use server";

import { and, eq, inArray, notInArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { assignmentMaterials, assignments, courses, materialPages, materials, submissions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { generateJson, generateJsonParts, geminiErrorMessage, type GeminiPart } from "@/lib/gemini";
import { exportToSheet, gradeProcessing, materialsContext, pullSubmissions, sampleSubmissionParts } from "@/lib/grading";
import { extractFromFile, extractFromUrl, guessMeeting, learnMaterial } from "@/lib/materials";
import { gcrProvider } from "@/lib/providers/gcr";
import { parseRubric, type RubricCriterion } from "@/lib/rubric";

async function ownedCourse(userId: string, courseId: string) {
  const course = await db.query.courses.findFirst({ where: and(eq(courses.id, courseId), eq(courses.userId, userId)) });
  if (!course) throw new Error("Course tidak ditemukan");
  return course;
}

async function ownedAssignment(userId: string, assignmentId: string) {
  const a = await db.query.assignments.findFirst({
    where: eq(assignments.id, assignmentId),
    with: { course: true, materials: { with: { material: true } } },
  });
  if (!a || a.course.userId !== userId) throw new Error("Tugas tidak ditemukan");
  return a;
}

/** Materi baru boleh ditambah setelah minimal satu course GCR (sebagai pengajar) tersinkron. */
async function requireSyncedCourse(userId: string) {
  const c = await db.query.courses.findFirst({ where: eq(courses.userId, userId), columns: { id: true } });
  if (!c) throw new Error("Sinkronkan Google Classroom (akun pengajar) dulu sebelum menambah materi.");
}

// ---------- Google Classroom ----------

export type SyncResult = { tone: "ok" | "warn" | "err"; message: string; at: number };

export async function syncCourses(): Promise<SyncResult> {
  const user = await requireUser();
  try {
    const provider = await gcrProvider(user.id);
    const list = await provider.listCourses();
    for (const c of list) {
      const data = { name: c.name, section: c.section, enrollmentCode: c.enrollmentCode, link: c.link, createdAt: c.createdAt, syncedAt: new Date() };
      await db
        .insert(courses)
        .values({ userId: user.id, provider: "gcr", externalId: c.externalId, ...data })
        .onConflictDoUpdate({ target: [courses.userId, courses.provider, courses.externalId], set: data });
    }
    // Hapus course yang tidak lagi diajar akun ini (mis. hasil sinkron lama sebagai siswa).
    const keep = list.map((c) => c.externalId);
    await db
      .delete(courses)
      .where(
        and(
          eq(courses.userId, user.id),
          eq(courses.provider, "gcr"),
          keep.length ? notInArray(courses.externalId, keep) : undefined,
        ),
      );
    revalidatePath("/classroom");
    return {
      tone: list.length ? "ok" : "warn",
      message: list.length
        ? `Sinkron berhasil: ${list.length} course ditemukan.`
        : "Tidak ada course. Gunakan akun pengajar, bukan siswa.",
      at: Date.now(),
    };
  } catch (e) {
    console.error("syncCourses gagal:", e);
    return { tone: "err", message: `Sinkron gagal: ${e instanceof Error ? e.message : String(e)}`, at: Date.now() };
  }
}

/** Tarik detail course + daftar tugas dari GCR. Setup lokal (rubrik, materi, status import) tidak ditimpa. */
export async function syncCourse(courseId: string) {
  const user = await requireUser();
  const course = await ownedCourse(user.id, courseId);
  const provider = await gcrProvider(user.id);
  const [detail, list] = await Promise.all([
    provider.getCourseDetail(course.externalId),
    provider.listAssignments(course.externalId),
  ]);
  await db
    .update(courses)
    .set({
      name: detail.name,
      section: detail.section,
      enrollmentCode: detail.enrollmentCode,
      link: detail.link,
      teacherNames: detail.teacherNames.join(", "),
      studentCount: detail.studentCount,
      syncedAt: new Date(),
    })
    .where(eq(courses.id, course.id));
  for (const a of list) {
    const data = {
      title: a.title,
      description: a.description,
      dueDate: a.dueDate,
      link: a.link,
      workType: a.workType,
    };
    await db
      .insert(assignments)
      .values({
        courseId: course.id,
        provider: "gcr",
        externalId: a.externalId,
        instructions: a.description,
        maxScore: a.maxScore ?? 100,
        ...data,
      })
      .onConflictDoUpdate({ target: [assignments.courseId, assignments.externalId], set: data });
  }
  revalidatePath(`/classroom/${course.id}`);
}

export async function importAssignments(courseId: string, formData: FormData) {
  const user = await requireUser();
  await ownedCourse(user.id, courseId);
  const ids = formData.getAll("assignmentId").map(String);
  if (ids.length) {
    const imported = await db
      .update(assignments)
      .set({ imported: true })
      .where(and(eq(assignments.courseId, courseId), inArray(assignments.id, ids)))
      .returning({ id: assignments.id, title: assignments.title });
    await autoPickMaterials(imported);
  }
  revalidatePath(`/classroom/${courseId}`);
}

/** Tugas yang belum punya materi: pilih otomatis materi dengan nomor pertemuan yang sama dengan judul tugas. */
async function autoPickMaterials(list: { id: string; title: string }[]) {
  const linked = new Set(
    (await db.select({ id: assignmentMaterials.assignmentId }).from(assignmentMaterials).where(inArray(assignmentMaterials.assignmentId, list.map((a) => a.id)))).map((r) => r.id),
  );
  const all = await db.select({ id: materials.id, meeting: materials.meeting }).from(materials);
  const rows = list
    .filter((a) => !linked.has(a.id))
    .flatMap((a) => {
      const meeting = guessMeeting(a.title);
      return meeting ? all.filter((m) => m.meeting === meeting).map((m) => ({ assignmentId: a.id, materialId: m.id })) : [];
    });
  if (rows.length) await db.insert(assignmentMaterials).values(rows).onConflictDoNothing();
}

/** Ganti daftar materi acuan sebuah tugas (dipakai dari tabel tugas). */
export async function setAssignmentMaterials(assignmentId: string, materialIds: string[]) {
  const user = await requireUser();
  const a = await ownedAssignment(user.id, assignmentId);
  await db.batch([
    db.delete(assignmentMaterials).where(eq(assignmentMaterials.assignmentId, a.id)),
    ...(materialIds.length
      ? [db.insert(assignmentMaterials).values(materialIds.map((materialId) => ({ assignmentId: a.id, materialId })))]
      : []),
  ]);
  revalidatePath(`/classroom/${a.courseId}`);
}

export async function setImported(assignmentId: string, imported: boolean) {
  const user = await requireUser();
  const a = await ownedAssignment(user.id, assignmentId);
  await db.update(assignments).set({ imported }).where(eq(assignments.id, a.id));
  revalidatePath(`/classroom/${a.courseId}`);
}

// ---------- Setup tugas ----------

export async function saveAssignmentSetup(assignmentId: string, formData: FormData) {
  const user = await requireUser();
  const a = await ownedAssignment(user.id, assignmentId);

  const rubric = parseRubric(String(formData.get("rubric") ?? "[]"))
    .map((c) => ({ name: c.name.trim(), description: (c.description ?? "").trim(), weight: Number(c.weight) || 0 }))
    .filter((c) => c.name);
  const materialIds = formData.getAll("materialId").map(String);
  const maxScore = Number(formData.get("maxScore"));

  // neon-http: batch dijalankan sebagai satu transaksi.
  await db.batch([
    db
      .update(assignments)
      .set({
        title: String(formData.get("title") ?? a.title).trim() || a.title,
        description: String(formData.get("description") ?? "") || null,
        instructions: String(formData.get("instructions") ?? "") || null,
        gradingNotes: String(formData.get("gradingNotes") ?? "") || null,
        maxScore: Number.isFinite(maxScore) && maxScore > 0 ? maxScore : 100,
        rubric: JSON.stringify(rubric),
        imported: true,
      })
      .where(eq(assignments.id, a.id)),
    db.delete(assignmentMaterials).where(eq(assignmentMaterials.assignmentId, a.id)),
    ...(materialIds.length
      ? [db.insert(assignmentMaterials).values(materialIds.map((materialId) => ({ assignmentId: a.id, materialId })))]
      : []),
  ]);
  revalidatePath(`/classroom/${a.courseId}`);
  redirect(`/classroom/${a.courseId}?saved=${a.id}`);
}

/**
 * Buat draf rubrik dengan Gemini berdasarkan instruksi tugas, isi materi yang dipilih,
 * dan contoh jawaban mahasiswa dari GCR (agar kriteria sesuai format jawaban mereka).
 */
export async function generateRubric(
  assignmentId: string,
  instructions: string,
  materialIds: string[],
): Promise<{ rubric?: RubricCriterion[]; error?: string; samples?: number }> {
  const user = await requireUser();
  const a = await ownedAssignment(user.id, assignmentId);
  try {
    const [materi, samples] = await Promise.all([
      materialsContext(materialIds),
      // Gagal baca submission tidak menggagalkan pembuatan rubrik.
      sampleSubmissionParts(user.id, a, a.course).catch(() => ({ parts: [] as GeminiPart[], count: 0, total: 0 })),
    ]);
    const prompt = `Kamu asisten dosen. Buat rubrik penilaian untuk tugas berikut.
Kembalikan JSON {"rubric": [{"name": "...", "description": "indikator penilaian yang jelas", "weight": angka}]}
dengan 3-6 kriteria dan total weight = 100. Gunakan Bahasa Indonesia.

Aturan:
- Kriteria harus spesifik untuk tugas ini (bukan generik), mengacu pada instruksi tugas dan konsep di MATERI ACUAN.
- Jika ada CONTOH JAWABAN MAHASISWA, perhatikan format/bentuk jawaban mereka (mis. kode, laporan, esai, perhitungan,
  diagram, screenshot) dan sesuaikan kriteria serta indikatornya agar bisa dinilai dari bentuk jawaban tersebut.
- Contoh jawaban hanya untuk memahami format; JANGAN jadikan jawaban tertentu sebagai kunci jawaban.

Judul tugas: ${a.title}
Instruksi: ${instructions || a.instructions || a.description || "-"}
${a.gradingNotes ? `Catatan penilaian dari dosen: ${a.gradingNotes}\n` : ""}
MATERI ACUAN:
${materi || "(belum ada materi dipilih)"}

CONTOH JAWABAN MAHASISWA (${samples.count} dari ${samples.total} submission):${samples.count ? "" : "\n(belum ada submission)"}`;
    const res = await generateJsonParts<{ rubric: RubricCriterion[] }>([{ text: prompt }, ...samples.parts]);
    return { rubric: res.rubric, samples: samples.count };
  } catch (e) {
    return { error: geminiErrorMessage(e) };
  }
}

// ---------- Materi ----------

export async function addMaterialFromUrl(formData: FormData) {
  const user = await requireUser();
  await requireSyncedCourse(user.id);
  const url = String(formData.get("url") ?? "").trim();
  const subject = String(formData.get("subject") ?? "DTD").trim() || "DTD";
  const crawl = formData.get("crawl") === "on";
  if (!/^https?:\/\//.test(url)) throw new Error("URL tidak valid");

  const pages = await extractFromUrl(url, crawl);
  // Satu halaman = satu materi (mis. tiap "pertemuan-N.html"), supaya bisa dipilih per pertemuan.
  for (const [i, page] of pages.entries()) {
    if (page.content.length < 50) continue;
    if (page.url) await db.delete(materials).where(eq(materials.sourceUrl, page.url));
    const [m] = await db
      .insert(materials)
      .values({
        title: page.title,
        subject,
        meeting: guessMeeting(page.url, page.title),
        kind: "url",
        sourceUrl: page.url,
        status: "pending",
      })
      .returning({ id: materials.id });
    await db.insert(materialPages).values({ materialId: m.id, url: page.url, title: page.title, content: page.content, order: i });
  }
  revalidatePath("/materials");
}

export async function addMaterialFromFile(formData: FormData) {
  const user = await requireUser();
  await requireSyncedCourse(user.id);
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const subject = String(formData.get("subject") ?? "DTD").trim() || "DTD";
  const meetingInput = Number(formData.get("meeting"));
  for (const file of files) {
    const content = await extractFromFile(file);
    const title = file.name.replace(/\.[^.]+$/, "");
    const [m] = await db
      .insert(materials)
      .values({
        title,
        subject,
        meeting: meetingInput > 0 ? meetingInput : guessMeeting(file.name),
        kind: "file",
        fileName: file.name,
        status: "pending",
      })
      .returning({ id: materials.id });
    await db.insert(materialPages).values({ materialId: m.id, title, content });
  }
  revalidatePath("/materials");
}

export async function updateMaterial(materialId: string, formData: FormData) {
  await requireUser();
  const meeting = Number(formData.get("meeting"));
  const title = String(formData.get("title") ?? "").trim();
  await db
    .update(materials)
    .set({ ...(title ? { title } : {}), meeting: meeting > 0 ? meeting : null })
    .where(eq(materials.id, materialId));
  revalidatePath("/materials");
}

/** Pelajari materi satu per satu setelah respons terkirim; halaman materi memantau statusnya. */
function learnInBackground(ids: string[]) {
  after(async () => {
    for (const id of ids) await learnMaterial(id);
  });
}

export async function relearnMaterial(materialId: string) {
  await requireUser();
  await db.update(materials).set({ status: "processing", error: null }).where(eq(materials.id, materialId));
  learnInBackground([materialId]);
  revalidatePath("/materials");
}

/** Pelajari materi yang dicentang di daftar (atau semua yang belum dipelajari bila `allPending`). */
export async function learnSelectedMaterials(formData: FormData) {
  await requireUser();
  const ids = formData.getAll("materialId").map(String);
  const where = formData.get("allPending") ? eq(materials.status, "pending") : ids.length ? inArray(materials.id, ids) : null;
  if (!where) return;
  const picked = await db
    .update(materials)
    .set({ status: "processing", error: null })
    .where(where)
    .returning({ id: materials.id });
  learnInBackground(picked.map((m) => m.id));
  revalidatePath("/materials");
}

export async function relearnFailedMaterials() {
  await requireUser();
  const failed = await db
    .update(materials)
    .set({ status: "processing", error: null })
    .where(eq(materials.status, "error"))
    .returning({ id: materials.id });
  learnInBackground(failed.map((m) => m.id));
  revalidatePath("/materials");
}

export async function deleteMaterial(materialId: string) {
  await requireUser();
  await db.delete(materials).where(eq(materials.id, materialId));
  revalidatePath("/materials");
}

// ---------- Koreksi ----------

/**
 * Tarik submission terbaru dari GCR, lalu nilai yang belum/gagal dinilai di background.
 * `all` = reset semua nilai ke "pending" (mis. setelah rubrik diubah) tanpa langsung menilai;
 * koreksi dimulai saat guru menekan "Koreksi dengan AI".
 */
export async function gradeAssignment(assignmentId: string, all: boolean) {
  const user = await requireUser();
  const a = await ownedAssignment(user.id, assignmentId);
  if (!parseRubric(a.rubric).length) throw new Error("Buat rubrik dulu di halaman Setup.");

  await pullSubmissions(user.id, a, a.course);
  if (all) {
    await db
      .update(submissions)
      .set({ status: "pending", error: null, aiScore: null, finalScore: null, breakdown: null, feedback: null, gradedAt: null })
      .where(and(eq(submissions.assignmentId, a.id), notInArray(submissions.status, ["processing"])));
  } else {
    await db
      .update(submissions)
      .set({ status: "processing", error: null })
      .where(and(eq(submissions.assignmentId, a.id), inArray(submissions.status, ["pending", "error"])));
    after(() => gradeProcessing(user.id, a.id));
  }
  revalidatePath(`/assignments/${a.id}/grades`);
  redirect(`/assignments/${a.id}/grades`);
}

/** Hentikan koreksi: antrean dikembalikan ke "pending" agar bisa dilanjutkan lewat "Koreksi dengan AI". */
export async function stopGrading(assignmentId: string) {
  const user = await requireUser();
  const a = await ownedAssignment(user.id, assignmentId);
  await db
    .update(submissions)
    .set({ status: "pending" })
    .where(and(eq(submissions.assignmentId, a.id), eq(submissions.status, "processing")));
  revalidatePath(`/assignments/${a.id}/grades`);
  revalidatePath(`/classroom/${a.courseId}`);
}

/**
 * Keputusan dosen atas submission yang terdeteksi mirip:
 * "accepted" = tetap pakai nilai AI, "rejected" = nilai 0.
 */
export async function decideSimilarity(submissionId: string, decision: "accepted" | "rejected") {
  const user = await requireUser();
  const sub = await db.query.submissions.findFirst({ where: eq(submissions.id, submissionId) });
  if (!sub) throw new Error("Submission tidak ditemukan");
  const a = await ownedAssignment(user.id, sub.assignmentId);
  await db
    .update(submissions)
    .set({ similarityDecision: decision, finalScore: decision === "rejected" ? 0 : sub.aiScore })
    .where(eq(submissions.id, sub.id));
  revalidatePath(`/assignments/${a.id}/grades`);
  revalidatePath(`/classroom/${a.courseId}`);
}

export async function exportGradesToSheet(assignmentId: string) {
  const user = await requireUser();
  const a = await ownedAssignment(user.id, assignmentId);
  await exportToSheet(user.id, a.id);
  revalidatePath(`/assignments/${a.id}/grades`);
  redirect(`/assignments/${a.id}/grades?exported=${Date.now()}`);
}
