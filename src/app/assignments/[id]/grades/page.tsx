import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { exportGradesToSheet, gradeAssignment, resetGrades, stopGrading } from "@/app/actions";
import { AutoRefresh } from "@/components/AutoRefresh";
import { InfiniteRows } from "@/components/InfiniteRows";
import { SubmitButton } from "@/components/SubmitButton";
import { ResetGradesButton } from "@/components/ResetGradesButton";
import { ToastOnMount } from "@/components/Toaster";
import { db } from "@/db";
import { assignments, submissions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { byStudentName, sheetUrl } from "@/lib/grading";
import { parseRubric } from "@/lib/rubric";
import { loadGradeRows } from "./load-rows";
import { gradeRows, matchesOf, needsCheck } from "./rows";

// Baris tabel yang tampil di awal; sisanya diambil saat di-scroll.
const PAGE_SIZE = 30;

export default async function GradesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ exported?: string }>;
}) {
  const [user, { id }, { exported }] = await Promise.all([requireUser(), params, searchParams]);
  const assignment = await db.query.assignments.findFirst({
    where: eq(assignments.id, id),
    // Hanya kolom ringan untuk urutan & ringkasan; detail baris diambil per 30 (lihat ./rows).
    with: {
      course: true,
      submissions: {
        orderBy: asc(submissions.studentName),
        columns: { id: true, studentId: true, studentName: true, status: true, finalScore: true, similarity: true, similarityDecision: true },
      },
    },
  });
  if (!assignment || assignment.course.userId !== user.id) notFound();
  const rubric = parseRubric(assignment.rubric);
  // Yang terdeteksi mirip & belum diputuskan naik ke paling atas, dikelompokkan per pasangan.
  const groupKey = (s: (typeof assignment.submissions)[number]) =>
    [s.studentName ?? "", ...matchesOf(s).map((m) => m.withName)].sort((x, y) => x.localeCompare(y))[0];
  const byName = byStudentName;
  const subs = [...assignment.submissions].sort((a, b) =>
    needsCheck(a) !== needsCheck(b)
      ? needsCheck(a) ? -1 : 1
      : needsCheck(a)
        ? groupKey(a).localeCompare(groupKey(b)) || byName(a, b)
        : byName(a, b),
  );
  const flagged = subs.filter(needsCheck).length;
  const processing = subs.filter((s) => s.status === "processing").length;
  // Antrean dikoreksi FIFO menurut nama; hanya yang paling depan yang sedang dinilai, sisanya menunggu.
  const currentId = [...subs].sort(byStudentName).find((s) => s.status === "processing")?.id;
  const graded = subs.filter((s) => s.status === "graded" || s.status === "reviewed");
  const avg = graded.length ? graded.reduce((s, x) => s + (x.finalScore ?? 0), 0) / graded.length : null;
  const orderedIds = subs.map((s) => s.id);
  const firstRows = await gradeRows(assignment.id, orderedIds.slice(0, PAGE_SIZE), rubric, currentId ?? null);

  return (
    <>
      <AutoRefresh active={processing > 0} />
      {exported && <ToastOnMount key={exported} tone="ok" message="Spreadsheet diperbarui." />}
      <p className="mb-4 text-[13px]"><Link href={`/classroom/${assignment.courseId}`}>← {assignment.course.name}</Link></p>
      <div className="flex flex-wrap items-center gap-3">
        <h1>{assignment.title}</h1>
        <span className="flex-1" />
        <Link className="btn" href={`/assignments/${assignment.id}/setup`}>Setup</Link>
        {assignment.spreadsheetId && (
          <a className="btn" href={sheetUrl(assignment.spreadsheetId)} target="_blank" rel="noreferrer">Buka Spreadsheet ↗</a>
        )}
      </div>
      <p className="mb-5 text-muted">
        {subs.length} submission · {graded.length} dinilai
        {avg !== null && <> · rata-rata {avg.toFixed(1)} / {assignment.maxScore}</>}
        {flagged > 0 && <> · <b className="text-warn">{flagged} mirip, perlu dicek</b></>}
        {processing > 0 && <> · <b>{processing} sedang dinilai</b> (±{Math.ceil((processing * 12) / 60)} menit, halaman refresh otomatis)</>}
      </p>

      {rubric.length === 0 ? (
        <div className="card text-muted">
          Rubrik belum dibuat. <Link href={`/assignments/${assignment.id}/setup`}>Buka Setup</Link> dulu.
        </div>
      ) : (
        <>
          <form className="mb-4 flex flex-wrap items-center gap-3">
            {processing > 0 ? (
              <SubmitButton className="btn btn-danger" pendingText="Menghentikan..." formAction={stopGrading.bind(null, assignment.id)}>
                ■ Hentikan koreksi
              </SubmitButton>
            ) : (
              <SubmitButton pendingText="Mengambil submission..." formAction={gradeAssignment.bind(null, assignment.id)}>
                {subs.some((s) => s.status === "pending" || s.status === "error") && subs.some((s) => s.status === "graded" || s.status === "reviewed")
                  ? "Lanjutkan koreksi"
                  : "Koreksi dengan AI"}
              </SubmitButton>
            )}
            <ResetGradesButton action={resetGrades.bind(null, assignment.id)} count={subs.length} disabled={processing > 0 || subs.length === 0} />
            <SubmitButton className="btn" pendingText="Mengekspor..." formAction={exportGradesToSheet.bind(null, assignment.id)} disabled={subs.length === 0}>
              Perbarui Spreadsheet
            </SubmitButton>
            <span className="text-[13px] text-muted">
              Submission diambil otomatis dari GCR; yang baru/dikumpulkan ulang akan dinilai.
            </span>
          </form>

          {subs.length === 0 ? (
            <div className="card text-muted">Belum ada data. Klik “Koreksi dengan AI” untuk mengambil submission dari GCR.</div>
          ) : (
            <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-sm" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--line-strong) transparent" }}>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th>Mahasiswa</th>
                    {rubric.map((c) => (
                      <th key={c.name} title={c.description}>{c.name} <span className="text-muted">({c.weight}%)</span></th>
                    ))}
                    <th>Nilai</th>
                    <th>Status</th>
                    <th>Aksi</th>
                    <th>Feedback</th>
                  </tr>
                </thead>
                <tbody>
                  {firstRows}
                  <InfiniteRows
                    ids={orderedIds.slice(PAGE_SIZE)}
                    load={loadGradeRows.bind(null, assignment.id, currentId ?? null)}
                    colSpan={rubric.length + 5}
                    version={Date.now()}
                    pageSize={PAGE_SIZE}
                  />
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
