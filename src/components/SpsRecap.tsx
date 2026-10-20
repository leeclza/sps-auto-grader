import Link from "next/link";
import { DownloadCsvButton } from "@/components/DownloadCsvButton";
import type { assignments, submissions } from "@/db/schema";
import { sheetUrl, type CriterionScore } from "@/lib/grading";
import { parseRubric } from "@/lib/rubric";

type Assignment = typeof assignments.$inferSelect;
type Submission = typeof submissions.$inferSelect;

/** Email kampus berformat nama.nim@...; ambil NIM dari angka sebelum "@". */
/** Cocokkan nama kriteria tanpa peduli kapital/spasi (rubrik bisa diedit setelah dinilai). */
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const nimFromEmail = (email: string | null) => email?.match(/(\d+)@/)?.[1] ?? "";

/**
 * Rekap nilai SPS per course: baris = mahasiswa; tiap tugas punya kolom per kriteria rubrik
 * (skor 0-100 + bobot) dan kolom Total (skala nilai maks tugas).
 */
export function SpsRecap({
  courseName,
  assignments,
  submissions,
}: {
  courseName: string;
  assignments: Assignment[];
  submissions: Submission[];
}) {
  if (assignments.length === 0) return null;

  const taskLabel = assignments.map((a) => a.title).join(", ");

  const cols = assignments.map((a) => ({ a, rubric: parseRubric(a.rubric) }));
  const students = new Map<string, { name: string; email: string | null }>();
  const byKey = new Map<string, Submission>();
  for (const s of submissions) {
    if (!students.has(s.studentId)) students.set(s.studentId, { name: s.studentName ?? s.studentId, email: s.studentEmail });
    byKey.set(`${s.studentId}:${s.assignmentId}`, s);
  }
  // Urut NIM; mahasiswa tanpa NIM di akhir, urut nama.
  const rows = [...students.entries()]
    .map(([id, st]) => [id, { ...st, nim: nimFromEmail(st.email) }] as const)
    .sort(([, a], [, b]) =>
      a.nim && b.nim ? a.nim.localeCompare(b.nim, undefined, { numeric: true }) : a.nim ? -1 : b.nim ? 1 : a.name.localeCompare(b.name),
    );
  const groupBorder = "border-l border-line";

  const csvRows: (string | number)[][] = [
    [
      "No",
      "NIM",
      "Mahasiswa",
      "Email",
      ...cols.flatMap(({ a, rubric }) => [
        ...rubric.map((c) => `${a.title} - ${c.name} (${c.weight}%)`),
        `${a.title} - Total Nilai (maks ${a.maxScore})`,
      ]),
    ],
    ...rows.map(([studentId, st], i) => [
      i + 1,
      st.nim,
      st.name,
      st.email ?? "",
      ...cols.flatMap(({ a, rubric }) => {
        const s = byKey.get(`${studentId}:${a.id}`);
        const scores: CriterionScore[] = s?.breakdown ? JSON.parse(s.breakdown) : [];
        return [
          ...rubric.map((c) => scores.find((x) => sameName(x.name, c.name))?.score ?? ""),
          s?.finalScore ?? "",
        ];
      }),
    ]),
  ];

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div>
          <h2 className="m-0">Rekap Nilai SPS — {taskLabel}</h2>
          <div className="text-[13px] text-muted">{courseName}</div>
        </div>
        <span className="flex-1" />
        {rows.length > 0 && (
          <DownloadCsvButton
            rows={csvRows}
            filename={`Rekap Nilai SPS - ${courseName} - ${taskLabel}.csv`.replace(/[\\/:*?"<>|]/g, "-")}
          />
        )}
      </div>
        <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-sm" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--line-strong) transparent" }}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th rowSpan={2}>No</th>
                <th rowSpan={2}>NIM</th>
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
                    Total Nilai
                    <div className="font-normal text-muted">maks {a.maxScore}</div>
                  </th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3 + cols.reduce((n, c) => n + c.rubric.length + 1, 0)} className="text-muted">
                    Belum ada nilai. Lengkapi materi &amp; rubrik tiap tugas, lalu klik <b>Koreksi</b>.
                  </td>
                </tr>
              )}
              {rows.map(([studentId, st], i) => (
                <tr key={studentId}>
                  <td className="text-muted">{i + 1}</td>
                  <td className="tabular-nums">{st.nim || <span className="text-muted">—</span>}</td>
                  <td>
                    <div>{st.name}</div>
                    {st.email && <div className="text-[13px] text-muted">{st.email}</div>}
                  </td>
                  {cols.map(({ a, rubric }) => {
                    const s = byKey.get(`${studentId}:${a.id}`);
                    const scores: CriterionScore[] = s?.breakdown ? JSON.parse(s.breakdown) : [];
                    return [
                      ...rubric.map((c, j) => {
                        const sc = scores.find((x) => sameName(x.name, c.name));
                        return (
                          <td key={`${a.id}:${c.name}`} title={sc?.comment} className={j === 0 ? groupBorder : ""}>
                            {sc ? sc.score : <span className="text-muted">—</span>}
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
                          <span className="text-[13px] text-muted">Belum dinilai</span>
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
