import Link from "next/link";
import type { assignments, submissions } from "@/db/schema";
import { sheetUrl, type CriterionScore } from "@/lib/grading";
import { parseRubric } from "@/lib/rubric";

type Assignment = typeof assignments.$inferSelect;
type Submission = typeof submissions.$inferSelect;

/**
 * Rekap nilai SPS per course: baris = mahasiswa; tiap tugas punya kolom per kriteria rubrik
 * (skor 0-100 + bobot) dan kolom Total (skala nilai maks tugas).
 */
export function SpsRecap({ assignments, submissions }: { assignments: Assignment[]; submissions: Submission[] }) {
  if (assignments.length === 0) return null;

  const cols = assignments.map((a) => ({ a, rubric: parseRubric(a.rubric) }));
  const students = new Map<string, { name: string; email: string | null }>();
  const byKey = new Map<string, Submission>();
  for (const s of submissions) {
    if (!students.has(s.studentId)) students.set(s.studentId, { name: s.studentName ?? s.studentId, email: s.studentEmail });
    byKey.set(`${s.studentId}:${s.assignmentId}`, s);
  }
  const rows = [...students.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  const groupBorder = "border-l border-line";

  return (
    <section className="mt-8">
      <h2>Rekap Nilai SPS</h2>
        <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-sm">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th rowSpan={2}>No</th>
                <th rowSpan={2}>Mahasiswa</th>
                {cols.map(({ a, rubric }) => (
                  <th key={a.id} colSpan={rubric.length + 1} className={`${groupBorder} text-center`}>
                    <Link href={`/assignments/${a.id}/grades`}>{a.title}</Link>
                    {a.spreadsheetId && (
                      <span className="text-[12px] font-normal normal-case">
                        {" "}· <a href={sheetUrl(a.spreadsheetId)} target="_blank" rel="noreferrer">Sheets ↗</a>
                      </span>
                    )}
                  </th>
                ))}
              </tr>
              <tr>
                {cols.map(({ a, rubric }) => [
                  ...rubric.map((c, i) => (
                    <th key={`${a.id}:${c.name}`} title={c.description} className={`text-[12px] normal-case ${i === 0 ? groupBorder : ""}`}>
                      {c.name}
                      <div className="font-normal text-muted">{c.weight}%</div>
                    </th>
                  )),
                  <th key={`${a.id}:total`} className={`text-[12px] normal-case ${rubric.length ? "" : groupBorder}`}>
                    Total
                    <div className="font-normal text-muted">maks {a.maxScore}</div>
                  </th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={2 + cols.reduce((n, c) => n + c.rubric.length + 1, 0)} className="text-muted">
                    Belum ada nilai. Lengkapi materi &amp; rubrik tiap tugas, lalu klik <b>Koreksi</b>.
                  </td>
                </tr>
              )}
              {rows.map(([studentId, st], i) => (
                <tr key={studentId}>
                  <td className="text-muted">{i + 1}</td>
                  <td>
                    <div>{st.name}</div>
                    {st.email && <div className="text-[13px] text-muted">{st.email}</div>}
                  </td>
                  {cols.map(({ a, rubric }) => {
                    const s = byKey.get(`${studentId}:${a.id}`);
                    const scores: CriterionScore[] = s?.breakdown ? JSON.parse(s.breakdown) : [];
                    const done = s && (s.status === "graded" || s.status === "reviewed");
                    return [
                      ...rubric.map((c, j) => {
                        const sc = scores.find((x) => x.name === c.name);
                        return (
                          <td key={`${a.id}:${c.name}`} title={sc?.comment} className={j === 0 ? groupBorder : ""}>
                            {done && sc ? sc.score : <span className="text-muted">—</span>}
                          </td>
                        );
                      }),
                      <td key={`${a.id}:total`} title={s?.feedback ?? s?.error ?? undefined} className={rubric.length ? "" : groupBorder}>
                        {!s ? (
                          <span className="text-muted">—</span>
                        ) : s.status === "processing" ? (
                          <span className="badge badge-warn">dinilai…</span>
                        ) : s.status === "error" ? (
                          <span className="badge badge-err">gagal</span>
                        ) : s.finalScore != null ? (
                          <b>{s.finalScore}</b>
                        ) : (
                          <span className="text-muted">belum</span>
                        )}
                      </td>,
                    ];
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
    </section>
  );
}
