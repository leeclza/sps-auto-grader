import Link from "next/link";
import { CountUp } from "@/components/CountUp";
import { requireUser } from "@/lib/auth";
import { and, count, eq, exists } from "drizzle-orm";
import { db } from "@/db";
import { assignmentMaterials, assignments, courses as coursesT, materials as materialsT } from "@/db/schema";

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12.5l4.5 4.5L19 7.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={24}
        strokeDashoffset={24}
        className="animate-draw [animation-delay:0.35s]"
      />
    </svg>
  );
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat("id-ID", { hour: "numeric", hour12: false, timeZone: "Asia/Jakarta" }).format(new Date()));
  return h < 11 ? "Selamat pagi" : h < 15 ? "Selamat siang" : h < 18 ? "Selamat sore" : "Selamat malam";
}

export default async function Home() {
  const user = await requireUser();
  const importedOwned = and(eq(assignments.imported, true), eq(coursesT.userId, user.id));
  const countAssignments = (where: ReturnType<typeof and>) =>
    db.select({ n: count() }).from(assignments).innerJoin(coursesT, eq(assignments.courseId, coursesT.id)).where(where);
  const [[{ n: courses }], [{ n: imported }], [{ n: ready }], [{ n: materials }]] = await Promise.all([
    db.select({ n: count() }).from(coursesT).where(eq(coursesT.userId, user.id)),
    countAssignments(importedOwned),
    countAssignments(
      and(
        importedOwned,
        exists(db.select().from(assignmentMaterials).where(eq(assignmentMaterials.assignmentId, assignments.id))),
      ),
    ),
    db.select({ n: count() }).from(materialsT),
  ]);
  const stats = [
    { label: "Classroom", value: courses, href: "/classroom" },
    { label: "Tugas di-import", value: imported, href: "/classroom" },
    { label: "Siap dinilai", value: ready, href: "/classroom" },
    { label: "Materi acuan", value: materials, href: "/materials" },
  ];
  const steps = [
    { n: 1, title: "Hubungkan Google Classroom", done: courses > 0, href: "/classroom" },
    { n: 2, title: "Upload materi acuan (link / file)", done: materials > 0, href: "/materials" },
    { n: 3, title: "Import tugas dari GCR ke SPS", done: imported > 0, href: "/classroom" },
    { n: 4, title: "Setup tugas: pilih materi & rubrik", done: ready > 0, href: "/classroom" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const firstName = (user.name ?? "").split(" ")[0];

  return (
    <>
      <div>
        <span className="eyebrow">Beranda</span>
        <h1>
          {greeting()}
          {firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="mb-[26px] max-w-[68ch] text-muted">
          Classroom → Tugas → Submission → Gemini (berdasarkan materi) → Nilai → Spreadsheet SPS
        </p>
      </div>

      <div className="stagger grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3.5">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="card card-hover group block overflow-hidden text-inherit hover:text-inherit before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:origin-top before:scale-y-0 before:bg-primary before:transition-transform before:duration-400 before:ease-out-soft before:content-[''] hover:before:scale-y-100"
          >
            <div className="text-[13px] text-muted">{s.label}</div>
            <div className="mt-1.5 font-mono text-[40px] leading-[1.1] font-medium tracking-[-0.03em]">
              <CountUp value={s.value} />
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h2>Langkah persiapan</h2>
        <span className="flex-1" />
        <span className="badge font-mono">{doneCount}/{steps.length} selesai</span>
      </div>
      <ol className="stagger grid gap-2.5">
        {steps.map((s) => (
          <li key={s.n}>
            <Link
              href={s.href}
              className="group flex items-center gap-4 rounded-card border border-line bg-surface px-[18px] py-3.5 text-inherit shadow-sm transition duration-300 ease-out-soft hover:translate-x-1 hover:border-line-strong hover:text-inherit hover:shadow-md"
            >
              <span
                className={`grid size-[34px] flex-none place-items-center rounded-full font-mono text-sm ${
                  s.done ? "animate-pop bg-ok-bg text-ok" : "border-[1.5px] border-dashed border-line-strong text-muted"
                }`}
              >
                {s.done ? <Check /> : s.n}
              </span>
              <span
                className={`font-medium ${s.done ? "text-muted line-through decoration-line-strong" : ""}`}
              >
                {s.title}
              </span>
              <span className="flex-1" />
              <span className="text-muted transition duration-300 ease-out-soft group-hover:translate-x-1 group-hover:text-primary">
                →
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
