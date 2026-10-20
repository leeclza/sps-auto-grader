"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { generateRubric, saveAssignmentSetup } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { MATERIAL_STATUS_LABEL } from "@/components/MaterialPicker";
import { useToast } from "@/components/Toaster";
import type { RubricCriterion } from "@/lib/rubric";

// generateRubric adalah satu panggilan tanpa progres; status ini perkiraan tahap berdasarkan waktu.
const AI_STEPS = [
  { at: 0, text: "Membaca instruksi tugas…" },
  { at: 2, text: "Mempelajari materi acuan…" },
  { at: 5, text: "Mengambil contoh jawaban mahasiswa dari GCR…" },
  { at: 10, text: "Menganalisis format jawaban…" },
  { at: 16, text: "Menyusun kriteria penilaian…" },
  { at: 24, text: "Menyeimbangkan bobot rubrik…" },
  { at: 32, text: "Hampir selesai, AI masih berpikir…" },
];

type RubricRow = Omit<RubricCriterion, "weight"> & { weight: number | "" };

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
  // Bobot boleh "" sementara agar input bisa dikosongkan; dihitung 0 saat dijumlah/disimpan.
  const [rubric, setRubric] = useState<RubricRow[]>(initialRubric);
  const toast = useToast();
  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!generating) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [generating]);
  const aiStatus = AI_STEPS.filter((s) => elapsed >= s.at).at(-1)!.text;
  const totalWeight = rubric.reduce((s, c) => s + (Number(c.weight) || 0), 0);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmedRef = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);

  // Hanya materi "ready" yang bisa dipilih; yang sudah terpilih tetap bisa dilepas.
  const locked = (m: MaterialOption) => m.status !== "ready" && !selected.has(m.id);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const updateRow = (i: number, patch: Partial<RubricRow>) =>
    setRubric((r) => r.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  // Server action tidak bisa dibatalkan; "Hentikan" cukup mengabaikan hasil run yang sedang jalan.
  const aiRun = useRef(0);
  const stopAi = () => {
    aiRun.current++;
    setGenerating(false);
  };

  const aiRubric = async () => {
    const run = ++aiRun.current;
    setGenerating(true);
    try {
      const res = await generateRubric(assignment.id, instructions, [...selected]);
      if (run !== aiRun.current) return;
      if (res.rubric?.length) {
        setRubric(res.rubric);
        toast({ tone: "ok", message: `Rubrik dibuat AI (${res.rubric.length} kriteria${res.samples ? `, dari ${res.samples} contoh jawaban + materi` : ""}). Cek lalu simpan.` });
      } else {
        toast({ tone: "err", title: "Gagal membuat rubrik", message: res.error ?? "Gemini tidak mengembalikan rubrik." });
      }
    } catch {
      if (run === aiRun.current) toast({ tone: "err", title: "Gagal membuat rubrik", message: "Terjadi kesalahan jaringan." });
    } finally {
      if (run === aiRun.current) setGenerating(false);
    }
  };

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
          {generating ? (
            <>
              <span className="text-[13px] text-muted" role="status" aria-live="polite">
                <span className="spinner mr-1.5" aria-hidden="true" />
                <span key={aiStatus} className="inline-block animate-[rise_0.3s_var(--ease-out-soft)_both]">{aiStatus}</span>
                <span className="ml-1.5 tabular-nums opacity-70">{elapsed}s</span>
              </span>
              <button type="button" className="btn btn-danger" onClick={stopAi}>
                Hentikan
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={aiRubric}>
              ✨ Buat dengan AI
            </button>
          )}
        </div>
        {rubric.length > 0 && totalWeight !== 100 && (
          <p className="mt-2 text-[13px] text-warn">
            ⚠ Total bobot harus 100% (sekarang {totalWeight}%, {totalWeight < 100 ? `kurang ${100 - totalWeight}%` : `lebih ${totalWeight - 100}%`}).
          </p>
        )}
        {/* Rubrik dikunci selama AI bekerja, kecuali dihentikan. */}
        <fieldset disabled={generating} className={`m-0 min-w-0 border-0 p-0 ${generating ? "opacity-60" : ""}`}>
        <div className="mt-3">
          {rubric.map((c, i) => (
            <div className="mb-2 grid animate-[rise_0.3s_var(--ease-out-soft)_both] grid-cols-1 gap-2 md:grid-cols-[1.2fr_2fr_90px_auto]" key={i}>
              <input type="text" placeholder="Kriteria" value={c.name} onChange={(e) => updateRow(i, { name: e.target.value })} />
              <input type="text" placeholder="Indikator / deskripsi" value={c.description} onChange={(e) => updateRow(i, { description: e.target.value })} />
              <input type="number" min={0} max={100} value={c.weight} onChange={(e) => updateRow(i, { weight: e.target.value === "" ? "" : Number(e.target.value) })} aria-label="Bobot (%)" />
              <button type="button" className="btn btn-danger" onClick={() => setDeleteIndex(i)}>Hapus</button>
            </div>
          ))}
        </div>
        <button type="button" className="btn" onClick={() => setRubric((r) => [...r, { name: "", description: "", weight: 0 }])}>
          + Kriteria
        </button>
        </fieldset>
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

      {confirmOpen && (
        <ConfirmDialog
          title="Total bobot belum 100%"
          confirmText="Tetap simpan"
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            confirmedRef.current = true;
            formRef.current?.requestSubmit();
          }}
        >
          Total bobot rubrik sekarang <b className="text-warn">{totalWeight}%</b>. Yakin tetap simpan?
        </ConfirmDialog>
      )}

      {deleteIndex !== null && (
        <ConfirmDialog
          title="Hapus kriteria?"
          confirmText="Hapus"
          danger
          onCancel={() => setDeleteIndex(null)}
          onConfirm={() => {
            setRubric((r) => r.filter((_, j) => j !== deleteIndex));
            setDeleteIndex(null);
          }}
        >
          Anda yakin ingin menghapus kriteria <b className="text-ink">{rubric[deleteIndex]?.name || "tanpa nama"}</b>?
        </ConfirmDialog>
      )}
    </form>
  );
}
