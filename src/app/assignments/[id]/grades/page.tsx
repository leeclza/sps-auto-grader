import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { exportGradesToSheet, gradeAssignment, stopGrading } from "@/app/actions";
import { AutoRefresh } from "@/components/AutoRefresh";
import { FeedbackCell } from "@/components/FeedbackCell";
import { SimilarityAction } from "@/components/SimilarityAction";
import type { SimilarityMatch } from "@/lib/similarity";
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
  // Yang terdeteksi mirip & belum diputuskan naik ke paling atas, dikelompokkan per pasangan.
  const matchesOf = (s: (typeof assignment.submissions)[number]): SimilarityMatch[] => (s.similarity ? JSON.parse(s.similarity) : []);
  const needsCheck = (s: (typeof assignment.submissions)[number]) => !s.similarityDecision && matchesOf(s).length > 0;
  const groupKey = (s: (typeof assignment.submissions)[number]) =>
    [s.studentName ?? "", ...matchesOf(s).map((m) => m.withName)].sort((x, y) => x.localeCompare(y))[0];
  const subs = [...assignment.submissions].sort((a, b) =>
    needsCheck(a) !== needsCheck(b)
      ? needsCheck(a) ? -1 : 1
      : needsCheck(a)
        ? groupKey(a).localeCompare(groupKey(b)) || (a.studentName ?? "").localeCompare(b.studentName ?? "")
        : 0,
  );
  const flagged = subs.filter(needsCheck).length;
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
              <SubmitButton pendingText="Mengambil submission..." formAction={gradeAssignment.bind(null, assignment.id, false)}>
                {subs.some((s) => s.status === "pending" || s.status === "error") && subs.some((s) => s.status === "graded" || s.status === "reviewed")
                  ? "Lanjutkan koreksi"
                  : "Koreksi dengan AI"}
              </SubmitButton>
            )}
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
                  {subs.map((s) => {
                    const scores: CriterionScore[] = s.breakdown ? JSON.parse(s.breakdown) : [];
                    const st = STATUS[s.status] ?? { label: s.status, cls: "badge" };
                    const matches = matchesOf(s);
                    return (
                      <tr key={s.id} className={needsCheck(s) ? "bg-warn-bg" : undefined}>
                        <td>
                          <div>{s.studentName ?? s.studentId}</div>
                          <div className="text-[13px] text-muted">{s.studentEmail}{s.late && " · terlambat"}</div>
                        </td>
                        {rubric.map((c) => {
                          const sc = scores.find((x) => x.name === c.name);
                          return <td key={c.name} title={sc?.comment}>{sc ? sc.score : "—"}</td>;
                        })}
                        <td><b>{s.finalScore ?? "—"}</b></td>
                        <td>
                          <span className={st.cls}>{st.label}</span>
                          {matches.length > 0 && (
                            <div className="mt-1">
                              {s.similarityDecision === "rejected" ? (
                                <span className="badge badge-err">Mirip · ditolak</span>
                              ) : s.similarityDecision === "accepted" ? (
                                <span className="badge badge-ok">Mirip · diterima</span>
                              ) : (
                                <span className="badge badge-warn">Mirip, perlu dicek</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td>
                          <SimilarityAction
                            submissionId={s.id}
                            student={s.studentName ?? s.studentId}
                            matches={matches}
                            decision={s.similarityDecision}
                          />
                        </td>
                        <td>
                          <FeedbackCell
                            student={s.studentName ?? s.studentId}
                            text={(s.status === "error" ? s.error : s.feedback) ?? ""}
                            error={s.status === "error"}
                            comments={scores}
                          />
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
