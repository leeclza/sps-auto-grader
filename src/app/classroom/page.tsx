import Link from "next/link";
import { SyncCoursesButton } from "@/components/SyncCoursesButton";
import { requireUser } from "@/lib/auth";
import { and, asc, count, eq, getTableColumns, sql } from "drizzle-orm";
import { db } from "@/db";
import { assignments, courses as coursesT } from "@/db/schema";

export default async function ClassroomPage() {
  const user = await requireUser();
  const rows = await db
    .select({ ...getTableColumns(coursesT), importedCount: count(assignments.id) })
    .from(coursesT)
    .leftJoin(assignments, and(eq(assignments.courseId, coursesT.id), eq(assignments.imported, true)))
    .where(and(eq(coursesT.userId, user.id), eq(coursesT.provider, "gcr")))
    .groupBy(coursesT.id)
    .orderBy(sql`${coursesT.createdAt} desc nulls last`, asc(coursesT.name));
  const courses = rows.map(({ importedCount, ...c }) => ({ ...c, _count: { assignments: importedCount } }));

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <span className="eyebrow">Google Classroom</span>
          <h1>Classroom Saya</h1>
          <p className="mb-[26px] max-w-[68ch] text-muted">Course Google Classroom tempat Anda menjadi pengajar, akun {user.email}.</p>
        </div>
        <span className="flex-1" />
        <SyncCoursesButton />
      </div>

      {courses.length === 0 ? (
        <div className="card border-dashed px-5 py-10 text-center text-muted shadow-none">
          Belum ada course. Klik <b>Sinkronkan dari Google Classroom</b> untuk mengambil daftar course.
        </div>
      ) : (
        <div className="stagger grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3.5">
          {courses.map((c) => (
            <div
              key={c.id}
              className="card card-hover group flex flex-col overflow-hidden pt-[22px] before:absolute before:inset-x-0 before:top-0 before:h-1 before:origin-left before:scale-x-[0.15] before:bg-primary before:transition-transform before:duration-500 before:ease-out-soft before:content-[''] hover:before:scale-x-100"
            >
              <h3 className="mb-1 font-serif text-[19px] leading-[1.25] font-semibold">{c.name}</h3>
              <div className="text-[13px] text-muted">{c.section || "—"}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="badge font-mono">{c.enrollmentCode || "—"}</span>
                <span className={`badge${c._count.assignments ? " badge-ok" : ""}`}>{c._count.assignments} tugas di SPS</span>
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-3 pt-4">
                <Link className="btn btn-primary" href={`/classroom/${c.id}`}>Buka</Link>
                {c.link && <a className="btn" href={c.link} target="_blank" rel="noreferrer">Lihat di GCR ↗</a>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
