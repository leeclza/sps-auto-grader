"use client";

export interface PickerMaterial {
  id: string;
  title: string;
  subject: string;
  meeting: number | null;
  status: string;
}

export const MATERIAL_STATUS_LABEL: Record<string, string> = {
  pending: "belum dipelajari",
  processing: "sedang dipelajari",
  error: "gagal dipelajari",
};

const label = (m: PickerMaterial) => (m.meeting ? `P${m.meeting}` : m.title);

/** Preview materi acuan di tabel tugas (read-only); ubah lewat halaman Setup. */
export function MaterialPicker({
  materials,
  selectedIds,
}: {
  assignmentId?: string;
  materials: PickerMaterial[];
  selectedIds: string[];
}) {
  const chosen = materials.filter((m) => selectedIds.includes(m.id));
  if (chosen.length === 0) return <span className="text-muted">Belum ada materi</span>;
  return (
    <details className="relative">
      <summary className="cursor-pointer">{chosen.map(label).join(", ")}</summary>
      <div className="absolute z-10 mt-1.5 w-72 rounded-card border border-line bg-surface p-2 shadow-sm">
        {chosen.map((m) => (
          <div key={m.id} className="p-1.5">
            {m.meeting && <b>P{m.meeting} · </b>}
            {m.title}
            <span className="text-muted"> · {m.subject}</span>
            {m.status !== "ready" && (
              <span className="block text-xs text-muted">{MATERIAL_STATUS_LABEL[m.status] ?? m.status}</span>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
