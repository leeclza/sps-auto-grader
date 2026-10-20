"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { generateRubric, saveAssignmentSetup } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { MATERIAL_STATUS_LABEL } from "@/components/MaterialPicker";
import { useToast } from "@/components/Toaster";
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
  const toast = useToast();
  const [generating, startGenerating] = useTransition();
  const totalWeight = rubric.reduce((s, c) => s + (Number(c.weight) || 0), 0);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmedRef = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Hanya materi "ready" yang bisa dipilih; yang sudah terpilih tetap bisa dilepas.
  const locked = (m: MaterialOption) => m.status !== "ready" && !selected.has(m.id);

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
      const res = await generateRubric(assignment.id, instructions, [...selected]);
      if (res.rubric?.length) {
        setRubric(res.rubric);
        toast({ tone: "ok", message: `Rubrik dibuat AI (${res.rubric.length} kriteria${res.samples ? `, dari ${res.samples} contoh jawaban + materi` : ""}). Cek lalu simpan.` });
      } else {
        toast({ tone: "err", title: "Gagal membuat rubrik", message: res.error ?? "Gemini tidak mengembalikan rubrik." });
      }
    });

  const bySubject = materials.reduce<Record<string, MaterialOption[]>>((acc, m) => {
    (acc[m.subject] ??= []).push(m);
    return acc;
  }, {});

  return (
    <form
      ref={formRef}
      action={saveAssignmentSetup.bind(null, assignment.id)}
      onSubmit={(e) => {
        if (rubric.length > 0 && totalWeight !== 100 && !confirmedRef.current) {
          e.preventDefault();
          setConfirmOpen(true);
        }
        confirmedRef.current = false;
      }}
    >
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
              <label
                key={m.id}
                title={locked(m) ? "Pelajari materi ini dulu di halaman Materi" : undefined}
                className={`my-2.5 flex items-start gap-2.5 font-normal text-ink ${locked(m) ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
              >
                <input
                  type="checkbox"
                  name="materialId"
                  value={m.id}
                  checked={selected.has(m.id)}
                  disabled={locked(m)}
                  onChange={() => toggle(m.id)}
                  className="mt-[3px] flex-none disabled:cursor-not-allowed"
                />
                <span>
                  {m.meeting ? <b>Pertemuan {m.meeting}</b> : null} {m.title}
                  {m.status !== "ready" && (
                    <span className="badge ml-1.5">{MATERIAL_STATUS_LABEL[m.status] ?? m.status}</span>
                  )}
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
        {rubric.length > 0 && totalWeight !== 100 && (
          <p className="mt-2 text-[13px] text-warn">
            ⚠ Total bobot harus 100% (sekarang {totalWeight}%, {totalWeight < 100 ? `kurang ${100 - totalWeight}%` : `lebih ${totalWeight - 100}%`}).
          </p>
        )}
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

      {/* Portal ke body: ancestor beranimasi (transform) membuat `fixed` tidak relatif ke layar. */}
      {confirmOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-weight-title"
            className="card w-full max-w-sm animate-[rise_0.3s_var(--ease-out-soft)_both]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="confirm-weight-title" className="m-0">Total bobot belum 100%</h2>
            <p className="mt-2 text-muted">
              Total bobot rubrik sekarang <b className="text-warn">{totalWeight}%</b>. Yakin tetap simpan?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="btn"
                ref={(el) => el?.focus({ preventScroll: true })}
                onClick={() => setConfirmOpen(false)}
              >
                Batal
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setConfirmOpen(false);
                  confirmedRef.current = true;
                  formRef.current?.requestSubmit();
                }}
              >
                Tetap simpan
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </form>
  );
}
