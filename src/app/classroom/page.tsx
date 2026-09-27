import Link from "next/link";
import { syncCourses } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function ClassroomPage() {
  const user = await requireUser();
  const courses = await prisma.course.findMany({
    where: { userId: user.id, provider: "gcr" },
    orderBy: [{ createdAt: { sort: "desc", nulls: "last" } }, { name: "asc" }],
    include: { _count: { select: { assignments: { where: { imported: true } } } } },
  });

  return (
    <>
      <div className="row">
        <div>
          <h1>Classroom Saya</h1>
          <p className="sub">Course Google Classroom tempat Anda menjadi pengajar, akun {user.email}.</p>
        </div>
        <span className="spacer" />
        <form action={syncCourses}>
          <SubmitButton pendingText="Mengambil dari GCR...">Sinkronkan dari Google Classroom</SubmitButton>
        </form>
      </div>

      {courses.length === 0 ? (
        <div className="card muted">
          Belum ada course. Klik <b>Sinkronkan dari Google Classroom</b> untuk mengambil daftar course.
        </div>
      ) : (
        <div className="grid">
          {courses.map((c) => (
            <div className="card" key={c.id}>
              <h2 style={{ marginTop: 0 }}>{c.name}</h2>
              <div className="muted small">{c.section || "—"}</div>
              <div className="muted small">Kode: {c.enrollmentCode || "—"}</div>
              <div className="muted small">{c._count.assignments} tugas di-import ke SPS</div>
              <div className="row" style={{ marginTop: 12 }}>
                <Link className="btn primary" href={`/classroom/${c.id}`}>Buka</Link>
                {c.link && <a className="btn" href={c.link} target="_blank" rel="noreferrer">Lihat di GCR ↗</a>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
