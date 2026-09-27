"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { generateJson } from "@/lib/gemini";
import { extractFromFile, extractFromUrl, guessMeeting, learnMaterial } from "@/lib/materials";
import { prisma } from "@/lib/prisma";
import { gcrProvider } from "@/lib/providers/gcr";
import { parseRubric, type RubricCriterion } from "@/lib/rubric";

async function ownedCourse(userId: string, courseId: string) {
  return prisma.course.findFirstOrThrow({ where: { id: courseId, userId } });
}

async function ownedAssignment(userId: string, assignmentId: string) {
  return prisma.assignment.findFirstOrThrow({
    where: { id: assignmentId, course: { userId } },
    include: { course: true, materials: { include: { material: true } } },
  });
}

// ---------- Google Classroom ----------

export async function syncCourses() {
  const user = await requireUser();
  const provider = await gcrProvider(user.id);
  const courses = await provider.listCourses();
  for (const c of courses) {
    const data = { name: c.name, section: c.section, enrollmentCode: c.enrollmentCode, link: c.link, createdAt: c.createdAt, syncedAt: new Date() };
    await prisma.course.upsert({
      where: { userId_provider_externalId: { userId: user.id, provider: "gcr", externalId: c.externalId } },
      create: { userId: user.id, provider: "gcr", externalId: c.externalId, ...data },
      update: data,
    });
  }
  // Hapus course yang tidak lagi diajar akun ini (mis. hasil sinkron lama sebagai siswa).
  await prisma.course.deleteMany({
    where: { userId: user.id, provider: "gcr", externalId: { notIn: courses.map((c) => c.externalId) } },
  });
  revalidatePath("/classroom");
}

/** Tarik detail course + daftar tugas dari GCR. Setup lokal (rubrik, materi, status import) tidak ditimpa. */
export async function syncCourse(courseId: string) {
  const user = await requireUser();
  const course = await ownedCourse(user.id, courseId);
  const provider = await gcrProvider(user.id);
  const [detail, assignments] = await Promise.all([
    provider.getCourseDetail(course.externalId),
    provider.listAssignments(course.externalId),
  ]);
  await prisma.course.update({
    where: { id: course.id },
    data: {
      name: detail.name,
      section: detail.section,
      enrollmentCode: detail.enrollmentCode,
      link: detail.link,
      teacherNames: detail.teacherNames.join(", "),
      studentCount: detail.studentCount,
      syncedAt: new Date(),
    },
  });
  for (const a of assignments) {
    const data = {
      title: a.title,
      description: a.description,
      dueDate: a.dueDate,
      link: a.link,
      workType: a.workType,
    };
    await prisma.assignment.upsert({
      where: { courseId_externalId: { courseId: course.id, externalId: a.externalId } },
      create: {
        courseId: course.id,
        provider: "gcr",
        externalId: a.externalId,
        instructions: a.description,
        maxScore: a.maxScore ?? 100,
        ...data,
      },
      update: data,
    });
  }
  revalidatePath(`/classroom/${course.id}`);
}

export async function importAssignments(courseId: string, formData: FormData) {
  const user = await requireUser();
  await ownedCourse(user.id, courseId);
  const ids = formData.getAll("assignmentId").map(String);
  await prisma.assignment.updateMany({ where: { courseId, id: { in: ids } }, data: { imported: true } });
  revalidatePath(`/classroom/${courseId}`);
}

export async function setImported(assignmentId: string, imported: boolean) {
  const user = await requireUser();
  const a = await ownedAssignment(user.id, assignmentId);
  await prisma.assignment.update({ where: { id: a.id }, data: { imported } });
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

  await prisma.$transaction([
    prisma.assignment.update({
      where: { id: a.id },
      data: {
        title: String(formData.get("title") ?? a.title).trim() || a.title,
        description: String(formData.get("description") ?? "") || null,
        instructions: String(formData.get("instructions") ?? "") || null,
        gradingNotes: String(formData.get("gradingNotes") ?? "") || null,
        maxScore: Number.isFinite(maxScore) && maxScore > 0 ? maxScore : 100,
        rubric: JSON.stringify(rubric),
        imported: true,
      },
    }),
    prisma.assignmentMaterial.deleteMany({ where: { assignmentId: a.id } }),
    prisma.assignmentMaterial.createMany({
      data: materialIds.map((materialId) => ({ assignmentId: a.id, materialId })),
    }),
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
  const materials = await prisma.material.findMany({ where: { id: { in: materialIds } } });
  const materiText = materials
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
    return { error: e instanceof Error ? e.message : String(e) };
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
  const created = [];
  for (const [i, page] of pages.entries()) {
    if (page.content.length < 50) continue;
    const existing = await prisma.material.findFirst({ where: { sourceUrl: page.url } });
    if (existing) await prisma.material.delete({ where: { id: existing.id } });
    created.push(
      await prisma.material.create({
        data: {
          title: page.title,
          subject,
          meeting: guessMeeting(page.url, page.title),
          kind: "url",
          sourceUrl: page.url,
          status: "processing",
          pages: { create: { url: page.url, title: page.title, content: page.content, order: i } },
        },
      }),
    );
  }
  await Promise.all(created.map((m) => learnMaterial(m.id)));
  revalidatePath("/materials");
}

export async function addMaterialFromFile(formData: FormData) {
  await requireUser();
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const subject = String(formData.get("subject") ?? "DTD").trim() || "DTD";
  const meetingInput = Number(formData.get("meeting"));
  const created = [];
  for (const file of files) {
    const content = await extractFromFile(file);
    const title = file.name.replace(/\.[^.]+$/, "");
    created.push(
      await prisma.material.create({
        data: {
          title,
          subject,
          meeting: meetingInput > 0 ? meetingInput : guessMeeting(file.name),
          kind: "file",
          fileName: file.name,
          status: "processing",
          pages: { create: { title, content } },
        },
      }),
    );
  }
  await Promise.all(created.map((m) => learnMaterial(m.id)));
  revalidatePath("/materials");
}

export async function updateMaterial(materialId: string, formData: FormData) {
  await requireUser();
  const meeting = Number(formData.get("meeting"));
  await prisma.material.update({
    where: { id: materialId },
    data: {
      title: String(formData.get("title") ?? "").trim() || undefined,
      meeting: meeting > 0 ? meeting : null,
    },
  });
  revalidatePath("/materials");
}

export async function relearnMaterial(materialId: string) {
  await requireUser();
  await prisma.material.update({ where: { id: materialId }, data: { status: "processing" } });
  await learnMaterial(materialId);
  revalidatePath("/materials");
}

export async function deleteMaterial(materialId: string) {
  await requireUser();
  await prisma.material.delete({ where: { id: materialId } });
  revalidatePath("/materials");
}
