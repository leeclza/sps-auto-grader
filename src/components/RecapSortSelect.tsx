"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Dropdown urutan baris rekap nilai SPS; navigasi lewat query ?urut= (sps | nim | nama). */
export function RecapSortSelect({ selected, hasRoster }: { selected: "sps" | "nim" | "nama"; hasRoster: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <select
      value={selected}
      onChange={(e) => {
        const q = new URLSearchParams(params);
        q.set("urut", e.target.value);
        router.push(`${pathname}?${q}`, { scroll: false });
      }}
      aria-label="Urutkan mahasiswa"
    >
      {hasRoster && <option value="sps">Urut SPS (spreadsheet)</option>}
      <option value="nim">Urut NIM</option>
      <option value="nama">Urut abjad (nama)</option>
    </select>
  );
}
