"use client";

import { useRouter, useSearchParams } from "next/navigation";

/** Dropdown pilih tugas untuk rekap nilai SPS; navigasi lewat query ?rekap=. */
export function RecapTaskSelect({
  courseId,
  tasks,
  selectedId,
}: {
  courseId: string;
  tasks: { id: string; title: string }[];
  selectedId: string;
}) {
  const router = useRouter();
  const urut = useSearchParams().get("urut");
  return (
    <select
      className="w-full max-w-md"
      value={selectedId}
      onChange={(e) => router.push(`/classroom/${courseId}?rekap=${e.target.value}${urut ? `&urut=${urut}` : ""}`, { scroll: false })}
      aria-label="Pilih tugas"
    >
      {tasks.map((t) => (
        <option key={t.id} value={t.id}>
          {t.title}
        </option>
      ))}
    </select>
  );
}
