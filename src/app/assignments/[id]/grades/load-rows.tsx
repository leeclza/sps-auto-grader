"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assignments } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { parseRubric } from "@/lib/rubric";
import { gradeRows } from "./rows";

/** Dipanggil saat tabel nilai di-scroll ke bawah: render baris berikutnya di server. */
export async function loadGradeRows(assignmentId: string, currentId: string | null, ids: string[]) {
  const user = await requireUser();
  const assignment = await db.query.assignments.findFirst({
    where: eq(assignments.id, assignmentId),
    columns: { rubric: true },
    with: { course: { columns: { userId: true } } },
  });
  if (!assignment || assignment.course.userId !== user.id) throw new Error("Tugas tidak ditemukan");
  return gradeRows(assignmentId, ids.slice(0, 1000), parseRubric(assignment.rubric), currentId);
}
