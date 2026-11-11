import "dotenv/config";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { submissions, assignments } from "@/db/schema";
import { gradeProcessing, pullSubmissions } from "@/lib/grading";
(async () => {
  const a = (await db.query.assignments.findFirst({ where: eq(assignments.title, "Tugas di Kelas/Lab"), with: { course: true, materials: { with: { material: true } } } }))!;
  await pullSubmissions(a.course.userId, a as any, a.course);
  await db.update(submissions).set({ status: "processing", error: null }).where(and(eq(submissions.assignmentId, a.id), inArray(submissions.status, ["pending", "error"])));
  const t = Date.now();
  await gradeProcessing(a.course.userId, a.id);
  console.log("selesai", Math.round((Date.now() - t) / 1000), "s");
  console.log(await db.select({ st: submissions.status, n: sql<number>`count(*)::int` }).from(submissions).where(eq(submissions.assignmentId, a.id)).groupBy(submissions.status));
})();
