"use client";

import { useState, useTransition } from "react";
import { setAssignmentMaterials } from "@/app/actions";

export interface PickerMaterial {
  id: string;
  title: string;
  subject: string;
  meeting: number | null;
}

const label = (m: PickerMaterial) => (m.meeting ? `P${m.meeting}` : m.title);

/** Pilih materi acuan langsung dari tabel tugas; tersimpan otomatis saat dicentang. */
export function MaterialPicker({
  assignmentId,
  materials,
  selectedIds,
}: {
  assignmentId: string;
  materials: PickerMaterial[];
  selectedIds: string[];
}) {
  const [selected, setSelected] = useState(() => new Set(selectedIds));
  const [pending, startTransition] = useTransition();

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    startTransition(() => setAssignmentMaterials(assignmentId, [...next]));
  }

  const chosen = materials.filter((m) => selected.has(m.id));
  return (
    <details className="relative">
      <summary className="cursor-pointer" aria-busy={pending}>
        {chosen.length ? chosen.map(label).join(", ") : <span className="text-muted">Pilih materi</span>}
        {pending && <span className="spinner ml-1.5" aria-hidden="true" />}
      </summary>
      <div className="absolute z-10 mt-1.5 max-h-72 w-72 overflow-y-auto rounded-card border border-line bg-surface p-2 shadow-sm">
        {materials.length === 0 && <p className="p-1 text-muted">Belum ada materi.</p>}
        {materials.map((m) => (
          <label key={m.id} className="flex cursor-pointer items-start gap-2 rounded p-1.5 hover:bg-line/40">
            <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} className="mt-[3px] flex-none" />
            <span>
              {m.meeting && <b>P{m.meeting} · </b>}
              {m.title}
              <span className="text-muted"> · {m.subject}</span>
            </span>
          </label>
        ))}
      </div>
    </details>
  );
}
