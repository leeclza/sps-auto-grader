import Link from "next/link";
import { notFound } from "next/navigation";
import { importAssignments, setImported, syncCourse } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseRubric } from "@/lib/rubric";

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const user = await requireUser();
  const { courseId } = await params;
  const { saved } = await searchParams;
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId: user.id },
    include: {
      assignments: {
        orderBy: [{ dueDate: "desc" }, { title: "asc" }],
        include: { materials: { include: { material: true } } },
      },
    },
  });
  if (!course) notFound();
  const neverSynced = course.studentCount === null;

  return (
    <>
      <p className="small"><Link href="/classroom">← Classroom Saya</Link></p>
      <div className="card">
        <div className="row">
          <h1>{course.name}</h1>
          <span className="spacer" />
          <form action={syncCourse.bind(null, course.id)}>
            <SubmitButton pendingText="Menyinkronkan...">
              {neverSynced ? "Ambil tugas dari GCR" : "Sinkronkan ulang"}
            </SubmitButton>
          </form>
        </div>
        <table style={{ marginTop: 8 }}>
          <tbody>
            <tr><th>Nama Course</th><td>{course.name}{course.section ? ` — ${course.section}` : ""}</td></tr>
            <tr><th>Kode Course</th><td>{course.enrollmentCode || "—"}</td></tr>
            <tr><th>Dosen</th><td>{course.teacherNames || "—"}</td></tr>
            <tr><th>Jumlah Mahasiswa</th><td>{course.studentCount ?? "—"}</td></tr>
            <tr><th>Terakhir sinkron</th><td>{course.syncedAt.toLocaleString("id-ID")}</td></tr>
          </tbody>
        </table>
      </div>

      {saved && <div className="alert ok">Setup tugas tersimpan.</div>}

      <h2>Daftar Tugas</h2>
      {course.assignments.length === 0 ? (
        <div className="card muted">
          {neverSynced ? "Klik “Ambil tugas dari GCR” untuk menarik daftar tugas." : "Tidak ada tugas di course ini."}
        </div>
      ) : (
        <form action={importAssignments.bind(null, course.id)}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
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
                  return (
                    <tr key={a.id}>
                      <td>{!a.imported && <input type="checkbox" name="assignmentId" value={a.id} />}</td>
                      <td>
                        <div>{a.title}</div>
                        <div className="muted small">
                          Maks {a.maxScore} · {a.dueDate ? `Tenggat ${a.dueDate.toLocaleDateString("id-ID")}` : "Tanpa tenggat"}
                          {a.link && <> · <a href={a.link} target="_blank" rel="noreferrer">GCR ↗</a></>}
                        </div>
                      </td>
                      <td>
                        {!a.imported ? (
                          <span className="badge">Belum di-import</span>
                        ) : ready ? (
                          <span className="badge ok">Siap dinilai</span>
                        ) : (
                          <span className="badge warn">Imported</span>
                        )}
                      </td>
                      <td className="small">
                        {a.materials.length
                          ? a.materials.map((m) => (m.material.meeting ? `P${m.material.meeting}` : m.material.title)).join(", ")
                          : <span className="muted">Belum dipilih</span>}
                        {a.imported && !hasRubric && <div className="muted">Rubrik belum dibuat</div>}
                      </td>
                      <td>
                        <div className="row">
                          <Link className="btn" href={`/assignments/${a.id}/setup`}>Setup</Link>
                          {a.imported && (
                            <button className="btn danger" formAction={setImported.bind(null, a.id, false)}>
                              Keluarkan
                            </button>
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
            <div className="row" style={{ marginTop: 12 }}>
              <SubmitButton pendingText="Mengimpor...">Import ke SPS</SubmitButton>
              <span className="muted small">Centang tugas yang ingin dinilai oleh SPS.</span>
            </div>
          )}
        </form>
      )}
    </>
  );
}
