"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { generateRubric, saveAssignmentSetup } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import type { RubricCriterion } from "@/lib/rubric";

interface MaterialOption {
  id: string;
  title: string;
  subject: string;
  meeting: number | null;
  status: string;
}

export function SetupForm({
  assignment,
  materials,
  selectedMaterialIds,
  initialRubric,
}: {
  assignment: { id: string; title: string; description: string; instructions: string; gradingNotes: string; maxScore: number };
  materials: MaterialOption[];
  selectedMaterialIds: string[];
  initialRubric: RubricCriterion[];
}) {
  const [instructions, setInstructions] = useState(assignment.instructions);
  const [selected, setSelected] = useState(new Set(selectedMaterialIds));
  const [rubric, setRubric] = useState(initialRubric);
  const [aiError, setAiError] = useState<string | null>(null);
  const [generating, startGenerating] = useTransition();
  const totalWeight = rubric.reduce((s, c) => s + (Number(c.weight) || 0), 0);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const updateRow = (i: number, patch: Partial<RubricCriterion>) =>
    setRubric((r) => r.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const aiRubric = () =>
    startGenerating(async () => {
      setAiError(null);
      const res = await generateRubric(assignment.id, instructions, [...selected]);
      if (res.rubric?.length) setRubric(res.rubric);
      else setAiError(res.error ?? "Gemini tidak mengembalikan rubrik.");
    });

  const bySubject = materials.reduce<Record<string, MaterialOption[]>>((acc, m) => {
    (acc[m.subject] ??= []).push(m);
    return acc;
  }, {});

  return (
    <form action={saveAssignmentSetup.bind(null, assignment.id)}>
      <div className="card mb-3.5">
        <label htmlFor="title">Nama Tugas</label>
        <input id="title" name="title" type="text" defaultValue={assignment.title} required />

        <label htmlFor="description">Deskripsi <span className="text-[13px] font-normal text-muted">(diambil dari GCR)</span></label>
        <textarea id="description" name="description" defaultValue={assignment.description} />

        <label htmlFor="instructions">Instruksi <span className="text-[13px] font-normal text-muted">(dipakai AI sebagai soal)</span></label>
        <textarea
          id="instructions"
          name="instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className="min-h-[140px]"
        />

        <label htmlFor="maxScore">Max Score</label>
        <input id="maxScore" name="maxScore" type="number" min={1} step="any" defaultValue={assignment.maxScore} className="max-w-40" />
      </div>

      <div className="card mb-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="m-0">Materi Acuan</h2>
          <span className="flex-1" />
          <Link href="/materials" className="text-[13px]">+ Tambah materi</Link>
        </div>
        <p className="mt-2 text-[13px] text-muted">AI hanya menilai berdasarkan materi yang dicentang.</p>
        {materials.length === 0 && <p className="text-muted">Belum ada materi. Upload dulu di halaman Materi.</p>}
        {Object.entries(bySubject).map(([subject, items]) => (
          <div key={subject}>
            <div className="mt-2 text-[13px] font-semibold text-muted">{subject}</div>
            {items.map((m) => (
              <label className="my-2.5 flex cursor-pointer items-start gap-2.5 font-normal text-ink" key={m.id}>
                <input type="checkbox" name="materialId" value={m.id} checked={selected.has(m.id)} onChange={() => toggle(m.id)} className="mt-[3px] flex-none" />
                <span>
                  {m.meeting ? <b>Pertemuan {m.meeting}</b> : null} {m.title}
                  {m.status !== "ready" && <span className="badge badge-warn ml-1.5">{m.status}</span>}
                </span>
              </label>
            ))}
          </div>
        ))}
      </div>

      <div className="card mb-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="m-0">Rubrik</h2>
          <span className={`badge ${totalWeight === 100 ? "badge-ok" : "badge-warn"}`}>Total bobot {totalWeight}%</span>
          <span className="flex-1" />
          <button type="button" className="btn" onClick={aiRubric} disabled={generating}>
            {generating ? "Membuat rubrik..." : "✨ Buat dengan AI"}
          </button>
        </div>
        {aiError && <div className="alert alert-err mt-3">{aiError}</div>}
        <div className="mt-3">
          {rubric.map((c, i) => (
            <div className="mb-2 grid animate-[rise_0.3s_var(--ease-out-soft)_both] grid-cols-1 gap-2 md:grid-cols-[1.2fr_2fr_90px_auto]" key={i}>
              <input type="text" placeholder="Kriteria" value={c.name} onChange={(e) => updateRow(i, { name: e.target.value })} />
              <input type="text" placeholder="Indikator / deskripsi" value={c.description} onChange={(e) => updateRow(i, { description: e.target.value })} />
              <input type="number" min={0} max={100} value={c.weight} onChange={(e) => updateRow(i, { weight: Number(e.target.value) })} aria-label="Bobot (%)" />
              <button type="button" className="btn btn-danger" onClick={() => setRubric((r) => r.filter((_, j) => j !== i))}>Hapus</button>
            </div>
          ))}
        </div>
        <button type="button" className="btn" onClick={() => setRubric((r) => [...r, { name: "", description: "", weight: 0 }])}>
          + Kriteria
        </button>
        <input type="hidden" name="rubric" value={JSON.stringify(rubric)} />

        <label htmlFor="gradingNotes">Catatan untuk AI <span className="text-[13px] font-normal text-muted">(opsional)</span></label>
        <textarea
          id="gradingNotes"
          name="gradingNotes"
          defaultValue={assignment.gradingNotes}
          placeholder="Mis. toleransi typo, wajib ada flowchart, bahasa pemrograman bebas, dll."
        />
      </div>

      <SubmitButton pendingText="Menyimpan...">Simpan Setup</SubmitButton>
    </form>
  );
}
