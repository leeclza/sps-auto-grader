import Link from "next/link";
import { notFound } from "next/navigation";
import { importAssignments, setImported, stopGrading, syncCourse } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { ToastOnMount } from "@/components/Toaster";
import { requireUser } from "@/lib/auth";
import { and, asc, eq, getTableColumns, sql } from "drizzle-orm";
import { db } from "@/db";
import { assignments, courses, materials, submissions } from "@/db/schema";
import { SpsRecap } from "@/components/SpsRecap";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CheckedSubmitButton } from "@/components/CheckedSubmitButton";
import { MaterialPicker } from "@/components/MaterialPicker";
import { ConfirmButton } from "@/components/ConfirmButton";
import { parseRubric } from "@/lib/rubric";
import { readRoster } from "@/lib/roster";

// Tanpa kolom teks besar (isi jawaban & segmen teks) yang tidak dipakai rekap.
const { content: _content, textSegments: _segments, ...recapColumns } = getTableColumns(submissions);

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ saved?: string; rekap?: string; urut?: string }>;
}) {
  const [user, { courseId }, { saved, rekap, urut }] = await Promise.all([requireUser(), params, searchParams]);
  // Semua query dijalankan paralel: tiap query ke Neon (HTTP) = satu round-trip.
  const [course, progressRows, allMaterials] = await Promise.all([
    db.query.courses.findFirst({
      where: and(eq(courses.id, courseId), eq(courses.userId, user.id)),
      with: {
        assignments: {
          orderBy: [sql`${assignments.dueDate} desc nulls last`, asc(assignments.title)],
          with: { materials: { with: { material: true } } },
        },
      },
    }),
    // Progres koreksi per tugas: selesai bila ada submission dan semuanya sudah dinilai.
    db
      .select({ assignmentId: submissions.assignmentId, status: submissions.status, n: sql<number>`count(*)::int` })
      .from(submissions)
      .innerJoin(assignments, eq(assignments.id, submissions.assignmentId))
      .where(eq(assignments.courseId, courseId))
      .groupBy(submissions.assignmentId, submissions.status),
    db
      .select({ id: materials.id, title: materials.title, subject: materials.subject, meeting: materials.meeting, status: materials.status })
      .from(materials)
      .orderBy(asc(materials.subject), asc(materials.meeting), asc(materials.title)),
  ]);
  if (!course) notFound();
  const progressOf = (id: string) => {
    const rows = progressRows.filter((r) => r.assignmentId === id);
    const total = rows.reduce((s, r) => s + r.n, 0);
    const done = rows.filter((r) => r.status === "graded" || r.status === "reviewed").reduce((s, r) => s + r.n, 0);
    return { total, done, finished: total > 0 && done === total, running: rows.some((r) => r.status === "processing") };
  };
  // Rekap ditampilkan per tugas (tidak digabung); hanya tugas yang sudah di-setup rubriknya.
  const recapTasks = course.assignments.filter((a) => a.imported && parseRubric(a.rubric).length > 0);
  const recapTask = recapTasks.find((a) => a.id === rekap) ?? recapTasks[0];
  const recapSubs = recapTask
    ? await db.select(recapColumns).from(submissions).where(eq(submissions.assignmentId, recapTask.id))
    : [];
  const neverSynced = course.studentCount === null;
  const roster = readRoster(course.spsRoster);

  return (
    <>
      <p className="mb-4 text-[13px]"><Link href="/classroom">← Classroom Saya</Link></p>
      <div className="card mb-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <h1>{course.name}</h1>
          <span className="flex-1" />
          <form action={syncCourse.bind(null, course.id)}>
            <SubmitButton pendingText="Menyinkronkan...">
              {neverSynced ? "Ambil tugas dari GCR" : "Sinkronkan ulang"}
            </SubmitButton>
          </form>
        </div>
        <table className="mt-2 w-full border-collapse">
          <tbody>
            <tr><th>Nama Course</th><td>{course.name}{course.section ? ` — ${course.section}` : ""}</td></tr>
            <tr><th>Kode Course</th><td>{course.enrollmentCode || "—"}</td></tr>
            <tr><th>Dosen</th><td>{course.teacherNames || "—"}</td></tr>
            <tr><th>Jumlah Mahasiswa</th><td>{course.studentCount ?? "—"}</td></tr>
            <tr><th>Terakhir sinkron</th><td>{course.syncedAt.toLocaleString("id-ID")}</td></tr>
          </tbody>
        </table>
      </div>

      {saved && <ToastOnMount key={saved} tone="ok" message="Setup tugas tersimpan." />}

      <h2>Daftar Tugas</h2>
      {course.assignments.length === 0 ? (
        <div className="card text-muted">
          {neverSynced ? "Klik “Ambil tugas dari GCR” untuk menarik daftar tugas." : "Tidak ada tugas di course ini."}
        </div>
      ) : (
        <form action={importAssignments.bind(null, course.id)}>
          <div className="overflow-x-auto md:overflow-visible rounded-card border border-line bg-surface shadow-sm">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="w-8"></th>
                  <th>Tugas GCR</th>
                  <th>Status</th>
                  <th>Materi</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {course.assignments.map((a) => {
                  const hasRubric = parseRubric(a.rubric).length > 0;
                  const ready = a.imported && a.materials.length > 0 && hasRubric;
                  const prog = progressOf(a.id);
                  return (
                    <tr key={a.id}>
                      <td>{!a.imported && <input type="checkbox" name="assignmentId" value={a.id} />}</td>
                      <td>
                        <div>{a.title}</div>
                        <div className="text-[13px] text-muted">
                          Maks {a.maxScore} · {a.dueDate ? `Tenggat ${a.dueDate.toLocaleDateString("id-ID")}` : "Tanpa tenggat"}
                          {a.link && <> · <a href={a.link} target="_blank" rel="noreferrer">GCR ↗</a></>}
                        </div>
                      </td>
                      <td>
                        {!a.imported ? (
                          <span className="badge">Belum di-import</span>
                        ) : ready && prog.finished ? (
                          <span className="badge badge-ok">Sudah dinilai ✓</span>
                        ) : ready && prog.running ? (
                          <span className="badge badge-warn">Sedang dinilai ({prog.done}/{prog.total})</span>
                        ) : ready && prog.done > 0 ? (
                          <span className="badge badge-warn">Dinilai {prog.done}/{prog.total}</span>
                        ) : ready ? (
                          <span className="badge">Siap dinilai</span>
                        ) : (
                          <span className="badge badge-warn">Imported</span>
                        )}
                      </td>
                      <td className="text-[13px]">
                        {a.imported ? (
                          <MaterialPicker
                            assignmentId={a.id}
                            materials={allMaterials}
                            selectedIds={a.materials.map((m) => m.materialId)}
                          />
                        ) : (
                          <span className="text-muted">Import dulu</span>
                        )}
                        {a.imported && !hasRubric && <div className="text-muted">Rubrik belum dibuat</div>}
                      </td>
                      <td>
                        <div className="flex flex-wrap items-center gap-3">
                          {ready &&
                            (prog.running ? (
                              // Sedang dinilai: tombol menampilkan progres; diklik = hentikan (dengan konfirmasi).
                              <ConfirmButton
                                className="btn btn-danger group min-w-30"
                                formAction={stopGrading.bind(null, a.id)}
                                title="Hentikan koreksi?"
                                confirmText="Hentikan"
                                danger
                                message={<>Koreksi <b className="text-ink">{a.title}</b> dihentikan. Nilai yang sudah keluar ({prog.done}/{prog.total}) tetap tersimpan; sisanya bisa dilanjutkan nanti.</>}
                              >
                                <span className="inline-flex items-center gap-2 group-hover:hidden">
                                  <span className="spinner" aria-hidden="true" />
                                  Menilai…
                                </span>
                                <span className="hidden group-hover:inline">■ Hentikan</span>
                              </ConfirmButton>
                            ) : prog.finished ? (
                              <ConfirmButton
                                className="btn"
                                href={`/assignments/${a.id}/grades`}
                                title="Koreksi ulang?"
                                confirmText="Buka halaman nilai"
                                message={<>Semua submission <b className="text-ink">{a.title}</b> sudah dinilai. Lanjut ke halaman nilai untuk mengoreksi ulang?</>}
                              >
                                Koreksi ulang
                              </ConfirmButton>
                            ) : (
                              <ConfirmButton
                                className="btn btn-primary"
                                href={`/assignments/${a.id}/grades`}
                                title={prog.done > 0 ? "Lanjutkan koreksi?" : "Mulai koreksi?"}
                                confirmText="Ya, lanjut"
                                message={<>Buka halaman koreksi untuk <b className="text-ink">{a.title}</b>?</>}
                              >
                                {prog.done > 0 ? "Lanjutkan" : "Koreksi"}
                              </ConfirmButton>
                            ))}
                          <Link className="btn" href={`/assignments/${a.id}/setup`}>Setup</Link>
                          {a.imported && (
                            <ConfirmButton
                              className="btn btn-danger"
                              formAction={setImported.bind(null, a.id, false)}
                              title="Keluarkan tugas?"
                              confirmText="Keluarkan"
                              danger
                              message={<><b className="text-ink">{a.title}</b> akan dikeluarkan dari daftar yang dinilai dan tidak tampil di Rekap SPS. Anda yakin?</>}
                            >
                              Keluarkan
                            </ConfirmButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {course.assignments.some((a) => !a.imported) && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <CheckedSubmitButton name="assignmentId" pendingText="Menambahkan...">Tambahkan untuk dinilai</CheckedSubmitButton>
              <span className="text-[13px] text-muted">Centang tugas yang ingin dikoreksi AI. Nilainya akan muncul di Rekap Nilai SPS di bawah.</span>
            </div>
          )}
        </form>
      )}

      <AutoRefresh active={progressRows.some((r) => r.status === "processing")} />
      <SpsRecap
        courseName={course.name}
        courseId={course.id}
        tasks={recapTasks}
        assignment={recapTask}
        submissions={recapSubs}
        roster={roster}
        // Default: urut SPS bila daftar urutan sudah diisi.
        sort={urut === "nama" || urut === "nim" ? urut : roster.length ? "sps" : "nim"}
      />
    </>
  );
}
