import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_RUBRIC, parseRubric } from "@/lib/rubric";
import { SetupForm } from "./SetupForm";

export default async function SetupPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const assignment = await prisma.assignment.findFirst({
    where: { id, course: { userId: user.id } },
    include: { course: true, materials: true },
  });
  if (!assignment) notFound();
  const materials = await prisma.material.findMany({
    orderBy: [{ subject: "asc" }, { meeting: "asc" }, { title: "asc" }],
    select: { id: true, title: true, subject: true, meeting: true, status: true },
  });
  const rubric = parseRubric(assignment.rubric);

  return (
    <>
      <p className="small"><Link href={`/classroom/${assignment.courseId}`}>← {assignment.course.name}</Link></p>
      <h1>Setup Tugas</h1>
      <p className="sub">
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
