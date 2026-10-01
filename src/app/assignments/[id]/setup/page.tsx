import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assignments, materials as materialsT } from "@/db/schema";
import { DEFAULT_RUBRIC, parseRubric } from "@/lib/rubric";
import { SetupForm } from "./SetupForm";

export default async function SetupPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const assignment = await db.query.assignments.findFirst({
    where: eq(assignments.id, id),
    with: { course: true, materials: true },
  });
  if (!assignment || assignment.course.userId !== user.id) notFound();
  const materials = await db
    .select({
      id: materialsT.id,
      title: materialsT.title,
      subject: materialsT.subject,
      meeting: materialsT.meeting,
      status: materialsT.status,
    })
    .from(materialsT)
    .orderBy(asc(materialsT.subject), asc(materialsT.meeting), asc(materialsT.title));
  const rubric = parseRubric(assignment.rubric);

  return (
    <>
      <p className="mb-4 text-[13px]"><Link href={`/classroom/${assignment.courseId}`}>← {assignment.course.name}</Link></p>
      <h1>Setup Tugas</h1>
      <p className="mb-6.5 max-w-[68ch] text-muted">
        Atur dasar penilaian sebelum grading.
        {assignment.link && <> Sumber: <a href={assignment.link} target="_blank" rel="noreferrer">Google Classroom ↗</a></>}
      </p>
      <SetupForm
        assignment={{
          id: assignment.id,
          title: assignment.title,
          description: assignment.description ?? "",
          instructions: assignment.instructions ?? "",
          gradingNotes: assignment.gradingNotes ?? "",
          maxScore: assignment.maxScore,
        }}
        selectedMaterialIds={assignment.materials.map((m) => m.materialId)}
        materials={materials}
        initialRubric={rubric.length ? rubric : DEFAULT_RUBRIC}
      />
    </>
  );
}
