import Link from "next/link";
import { DownloadCsvButton } from "@/components/DownloadCsvButton";
import { FeedbackCell } from "@/components/FeedbackCell";
import { RecapSortSelect } from "@/components/RecapSortSelect";
import { RecapTaskSelect } from "@/components/RecapTaskSelect";
import type { assignments, submissions } from "@/db/schema";
import { sheetUrl, type CriterionScore } from "@/lib/grading";
import { parseRubric } from "@/lib/rubric";
import type { RosterEntry } from "@/lib/roster";
import { CopyScoresButton } from "@/components/CopyScoresButton";
import { saveSpsRoster } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";

export type RecapSort = "sps" | "nim" | "nama";

type Assignment = typeof assignments.$inferSelect;
type Submission = Omit<typeof submissions.$inferSelect, "content" | "textSegments">;

/** Email kampus berformat nama.nim@...; ambil NIM dari angka sebelum "@". */
/** Cocokkan nama kriteria tanpa peduli kapital/spasi (rubrik bisa diedit setelah dinilai). */
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const nimFromEmail = (email: string | null) => email?.match(/(\d+)@/)?.[1] ?? "";

/**
 * Rekap nilai SPS satu tugas (dipilih lewat tab): baris = mahasiswa; kolom per kriteria rubrik
 * (skor 0-100 + bobot) dan kolom Total (skala nilai maks tugas).
 */
export function SpsRecap({
  courseName,
  courseId,
  tasks,
  assignment,
  submissions,
  sort = "nim",
  roster = [],
}: {
  courseName: string;
  courseId: string;
  tasks: Assignment[];
  assignment: Assignment | undefined;
  submissions: Submission[];
  sort?: RecapSort;
  roster?: RosterEntry[];
}) {
  if (!assignment) return null;
  const assignments = [assignment];

  const taskLabel = assignments.map((a) => a.title).join(", ");

  const cols = assignments.map((a) => ({ a, rubric: parseRubric(a.rubric) }));
  const students = new Map<string, { name: string; email: string | null }>();
  const byKey = new Map<string, Submission>();
  for (const s of submissions) {
    if (!students.has(s.studentId)) students.set(s.studentId, { name: s.studentName ?? s.studentId, email: s.studentEmail });
    byKey.set(`${s.studentId}:${s.assignmentId}`, s);
  }
  const all = [...students.entries()].map(([id, st]) => [id, { ...st, nim: nimFromEmail(st.email) }] as const);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  // Urut SPS: ikuti daftar yang di-paste dari spreadsheet (cocokkan NIM, lalu nama).
  // Mahasiswa di daftar tanpa submission tetap jadi baris kosong supaya nilai yang disalin pas dengan baris spreadsheet.
  const spsRows = (() => {
    if (sort !== "sps" || !roster.length) return null;
    const used = new Set<string>();
    const list = roster.map((r, i) => {
      const hit = all.find(([id, st]) => !used.has(id) && st.nim === r.nim) ?? all.find(([id, st]) => !used.has(id) && norm(st.name) === norm(r.name));
      if (hit) used.add(hit[0]);
      return hit ? ([hit[0], { ...hit[1], nim: hit[1].nim || r.nim }] as const) : ([`sps:${i}`, { name: r.name, email: null, nim: r.nim }] as const);
    });
    return { list, extra: all.filter(([id]) => !used.has(id)) };
  })();
  // Urut NIM (tanpa NIM di akhir, urut nama) atau urut abjad nama.
  const rows = spsRows ? [...spsRows.list, ...spsRows.extra] : [...all]
    .sort(([, a], [, b]) =>
      sort === "nama"
        ? a.name.localeCompare(b.name, "id", { sensitivity: "base" })
        : a.nim && b.nim
          ? a.nim.localeCompare(b.nim, undefined, { numeric: true })
          : a.nim ? -1 : b.nim ? 1 : a.name.localeCompare(b.name),
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
        `${a.title} - Feedback`,
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
          s?.feedback ?? "",
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
        {spsRows && (
          <CopyScoresButton
            label={assignment.title}
            values={spsRows.list.map(([id]) => {
              const s = byKey.get(`${id}:${assignment.id}`);
              return s?.finalScore ?? "";
            })}
          />
        )}
        {rows.length > 0 && (
          <DownloadCsvButton
            rows={csvRows}
            filename={`Rekap Nilai SPS - ${courseName} - ${taskLabel}.csv`.replace(/[\\/:*?"<>|]/g, "-")}
          />
        )}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {tasks.length > 1 && <RecapTaskSelect courseId={courseId} tasks={tasks} selectedId={assignment.id} />}
        {rows.length > 1 && <RecapSortSelect selected={sort} hasRoster={roster.length > 0} />}
        {spsRows && spsRows.extra.length > 0 && (
          <span className="badge badge-warn" title={spsRows.extra.map(([, st]) => st.name).join(", ")}>
            {spsRows.extra.length} mahasiswa tidak ada di daftar SPS (di bawah, tidak ikut disalin)
          </span>
        )}
      </div>
      <details className="mb-3">
        <summary className="cursor-pointer text-[13px] text-muted">
          Daftar urutan SPS {roster.length ? `(${roster.length} mahasiswa)` : "(belum diisi)"}
        </summary>
        <form action={saveSpsRoster.bind(null, courseId)} className="mt-2 grid gap-2">
          <textarea
            name="roster"
            rows={6}
            defaultValue={roster.map((r, i) => `${i + 1}\t${r.nim}\t${r.name}`).join("\n")}
            placeholder={"Copy kolom No, NIM, NAMA dari spreadsheet SPS lalu paste di sini"}
            className="font-mono text-[13px]"
          />
          <div><SubmitButton pendingText="Menyimpan...">Simpan urutan SPS</SubmitButton></div>
        </form>
      </details>
        <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-sm" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--line-strong) transparent" }}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th rowSpan={2}>No</th>
                <th rowSpan={2}>NIM</th>
                <th rowSpan={2}>Mahasiswa</th>
                {cols.map(({ a, rubric }) => (
                  <th key={a.id} colSpan={rubric.length + 2} className={`${groupBorder} text-center`}>
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
                  <th key={`${a.id}:feedback`} className="text-[12px] normal-case">Feedback</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3 + cols.reduce((n, c) => n + c.rubric.length + 2, 0)} className="text-muted">
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
                      <td key={`${a.id}:feedback`}>
                        <FeedbackCell
                          student={st.name}
                          text={(s?.status === "error" ? s.error : s?.feedback) ?? ""}
                          error={s?.status === "error"}
                          comments={scores}
                        />
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
