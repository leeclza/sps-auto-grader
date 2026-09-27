import Link from "next/link";
import { CountUp } from "@/components/CountUp";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat("id-ID", { hour: "numeric", hour12: false, timeZone: "Asia/Jakarta" }).format(new Date()));
  return h < 11 ? "Selamat pagi" : h < 15 ? "Selamat siang" : h < 18 ? "Selamat sore" : "Selamat malam";
}

export default async function Home() {
  const user = await requireUser();
  const [courses, imported, ready, materials] = await Promise.all([
    prisma.course.count({ where: { userId: user.id } }),
    prisma.assignment.count({ where: { imported: true, course: { userId: user.id } } }),
    prisma.assignment.count({ where: { imported: true, course: { userId: user.id }, materials: { some: {} } } }),
    prisma.material.count(),
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
        <p className="sub">Classroom → Tugas → Submission → Gemini (berdasarkan materi) → Nilai → Spreadsheet SPS</p>
      </div>

      <div className="grid">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="card stat">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">
              <CountUp value={s.value} />
            </div>
          </Link>
        ))}
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <h2>Langkah persiapan</h2>
        <span className="spacer" />
        <span className="badge mono">{doneCount}/{steps.length} selesai</span>
      </div>
      <ol className="steps">
        {steps.map((s) => (
          <li key={s.n}>
            <Link href={s.href} className={`step${s.done ? " done" : ""}`} style={{ color: "inherit" }}>
              <span className="step-num">{s.done ? <Check /> : s.n}</span>
              <span className="step-title">{s.title}</span>
              <span className="spacer" />
              <span className="arrow">→</span>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
