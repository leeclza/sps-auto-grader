import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function Home() {
  const user = await requireUser();
  const [courses, imported, ready, materials] = await Promise.all([
    prisma.course.count({ where: { userId: user.id } }),
    prisma.assignment.count({ where: { imported: true, course: { userId: user.id } } }),
    prisma.assignment.count({ where: { imported: true, course: { userId: user.id }, materials: { some: {} } } }),
    prisma.material.count(),
  ]);
  const steps = [
    { n: 1, title: "Hubungkan Google Classroom", done: courses > 0, href: "/classroom" },
    { n: 2, title: "Upload materi acuan (link / file)", done: materials > 0, href: "/materials" },
    { n: 3, title: "Import tugas dari GCR ke SPS", done: imported > 0, href: "/classroom" },
    { n: 4, title: "Setup tugas: pilih materi & rubrik", done: ready > 0, href: "/classroom" },
  ];
  return (
    <>
      <h1>Halo, {user.name}</h1>
      <p className="sub">Alur: Google Classroom → Tugas → Submission → Gemini (berdasarkan materi) → Nilai → Spreadsheet SPS</p>
      <div className="grid">
        <div className="card"><div className="muted small">Classroom</div><h2 style={{ margin: 0 }}>{courses}</h2></div>
        <div className="card"><div className="muted small">Tugas di-import</div><h2 style={{ margin: 0 }}>{imported}</h2></div>
        <div className="card"><div className="muted small">Tugas siap dinilai</div><h2 style={{ margin: 0 }}>{ready}</h2></div>
        <div className="card"><div className="muted small">Materi</div><h2 style={{ margin: 0 }}>{materials}</h2></div>
      </div>
      <h2>Langkah</h2>
      {steps.map((s) => (
        <div className="card row" key={s.n}>
          <span className={`badge ${s.done ? "ok" : ""}`}>{s.done ? "Selesai" : `Langkah ${s.n}`}</span>
          <span>{s.title}</span>
          <span className="spacer" />
          <Link className="btn" href={s.href}>Buka</Link>
        </div>
      ))}
    </>
  );
}
