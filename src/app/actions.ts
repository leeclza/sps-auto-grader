"use server";

import { and, eq, inArray, notInArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { assignmentMaterials, assignments, courses, materialPages, materials } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { generateJson, geminiErrorMessage } from "@/lib/gemini";
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

// ---------- Google Classroom ----------

export type SyncResult = { ok: boolean; message: string; at: number };

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
      ok: true,
      message: list.length
        ? `Sinkron berhasil: ${list.length} course ditemukan.`
        : "Sinkron berhasil, tapi tidak ada course yang Anda ajar di akun ini.",
      at: Date.now(),
    };
  } catch (e) {
    console.error("syncCourses gagal:", e);
    return { ok: false, message: `Sinkron gagal: ${e instanceof Error ? e.message : String(e)}`, at: Date.now() };
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
    await db
      .update(assignments)
      .set({ imported: true })
      .where(and(eq(assignments.courseId, courseId), inArray(assignments.id, ids)));
  }
  revalidatePath(`/classroom/${courseId}`);
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

/** Buat draf rubrik dengan Gemini berdasarkan instruksi tugas & materi yang dipilih. */
export async function generateRubric(
  assignmentId: string,
  instructions: string,
  materialIds: string[],
): Promise<{ rubric?: RubricCriterion[]; error?: string }> {
  const user = await requireUser();
  const a = await ownedAssignment(user.id, assignmentId);
  const selected = materialIds.length
    ? await db.select().from(materials).where(inArray(materials.id, materialIds))
    : [];
  const materiText = selected
    .map((m) => `- ${m.title}\n  Ringkasan: ${m.summary ?? "-"}\n  Konsep kunci: ${m.keyConcepts ?? "-"}`)
    .join("\n");
  try {
    const res = await generateJson<{ rubric: RubricCriterion[] }>(
      `Kamu asisten dosen. Buat rubrik penilaian untuk tugas berikut.
Kembalikan JSON {"rubric": [{"name": "...", "description": "indikator penilaian yang jelas", "weight": angka}]}
dengan 3-6 kriteria dan total weight = 100. Gunakan Bahasa Indonesia.
Kriteria harus mengacu pada konsep dalam materi yang dipilih.

Judul tugas: ${a.title}
Instruksi: ${instructions || a.instructions || a.description || "-"}

Materi acuan:
${materiText || "(belum ada materi dipilih)"}`,
    );
    return { rubric: res.rubric };
  } catch (e) {
    return { error: geminiErrorMessage(e) };
  }
}

// ---------- Materi ----------

export async function addMaterialFromUrl(formData: FormData) {
  await requireUser();
  const url = String(formData.get("url") ?? "").trim();
  const subject = String(formData.get("subject") ?? "DTD").trim() || "DTD";
  const crawl = formData.get("crawl") === "on";
  if (!/^https?:\/\//.test(url)) throw new Error("URL tidak valid");

  const pages = await extractFromUrl(url, crawl);
  // Satu halaman = satu materi (mis. tiap "pertemuan-N.html"), supaya bisa dipilih per pertemuan.
  const created: string[] = [];
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
        status: "processing",
      })
      .returning({ id: materials.id });
    await db.insert(materialPages).values({ materialId: m.id, url: page.url, title: page.title, content: page.content, order: i });
    created.push(m.id);
  }
  learnInBackground(created);
  revalidatePath("/materials");
}

export async function addMaterialFromFile(formData: FormData) {
  await requireUser();
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const subject = String(formData.get("subject") ?? "DTD").trim() || "DTD";
  const meetingInput = Number(formData.get("meeting"));
  const created: string[] = [];
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
        status: "processing",
      })
      .returning({ id: materials.id });
    await db.insert(materialPages).values({ materialId: m.id, title, content });
    created.push(m.id);
  }
  learnInBackground(created);
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
