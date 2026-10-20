import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { exportGradesToSheet, gradeAssignment } from "@/app/actions";
import { AutoRefresh } from "@/components/AutoRefresh";
import { SubmitButton } from "@/components/SubmitButton";
import { ToastOnMount } from "@/components/Toaster";
import { db } from "@/db";
import { assignments, submissions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { sheetUrl, type CriterionScore } from "@/lib/grading";
import { parseRubric } from "@/lib/rubric";

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Belum dinilai", cls: "badge" },
  processing: { label: "Sedang dinilai…", cls: "badge badge-warn" },
  graded: { label: "Dinilai AI", cls: "badge badge-ok" },
  reviewed: { label: "Dicek", cls: "badge badge-ok" },
  error: { label: "Gagal", cls: "badge badge-err" },
};

export default async function GradesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ exported?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { exported } = await searchParams;
  const assignment = await db.query.assignments.findFirst({
    where: eq(assignments.id, id),
    with: { course: true, submissions: { orderBy: asc(submissions.studentName) } },
  });
  if (!assignment || assignment.course.userId !== user.id) notFound();
  const rubric = parseRubric(assignment.rubric);
  const subs = assignment.submissions;
  const processing = subs.filter((s) => s.status === "processing").length;
  const graded = subs.filter((s) => s.status === "graded" || s.status === "reviewed");
  const avg = graded.length ? graded.reduce((s, x) => s + (x.finalScore ?? 0), 0) / graded.length : null;

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
        {processing > 0 && <> · <b>{processing} sedang dinilai</b> (±{Math.ceil((processing * 12) / 60)} menit, halaman refresh otomatis)</>}
      </p>

      {rubric.length === 0 ? (
        <div className="card text-muted">
          Rubrik belum dibuat. <Link href={`/assignments/${assignment.id}/setup`}>Buka Setup</Link> dulu.
        </div>
      ) : (
        <>
          <form className="mb-4 flex flex-wrap items-center gap-3">
            <SubmitButton pendingText="Mengambil submission..." formAction={gradeAssignment.bind(null, assignment.id, false)} disabled={processing > 0}>
              Koreksi dengan AI
            </SubmitButton>
            <SubmitButton className="btn" pendingText="Memproses..." formAction={gradeAssignment.bind(null, assignment.id, true)} disabled={processing > 0 || subs.length === 0}>
              Nilai ulang semua
            </SubmitButton>
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
            <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-sm">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th>Mahasiswa</th>
                    {rubric.map((c) => (
                      <th key={c.name} title={c.description}>{c.name} <span className="text-muted">({c.weight}%)</span></th>
                    ))}
                    <th>Nilai</th>
                    <th>Status</th>
                    <th>Feedback</th>
                  </tr>
                </thead>
                <tbody>
                  {subs.map((s) => {
                    const scores: CriterionScore[] = s.breakdown ? JSON.parse(s.breakdown) : [];
                    const st = STATUS[s.status] ?? { label: s.status, cls: "badge" };
                    return (
                      <tr key={s.id}>
                        <td>
                          <div>{s.studentName ?? s.studentId}</div>
                          <div className="text-[13px] text-muted">{s.studentEmail}{s.late && " · terlambat"}</div>
                        </td>
                        {rubric.map((c) => {
                          const sc = scores.find((x) => x.name === c.name);
                          return <td key={c.name} title={sc?.comment}>{sc ? sc.score : "—"}</td>;
                        })}
                        <td><b>{s.finalScore ?? "—"}</b></td>
                        <td><span className={st.cls}>{st.label}</span></td>
                        <td className="max-w-[40ch] text-[13px]">
                          {s.status === "error" ? <span className="text-err">{s.error}</span> : s.feedback ?? ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
