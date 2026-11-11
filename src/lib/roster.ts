export type RosterEntry = { nim: string; name: string };

/**
 * Baca daftar mahasiswa hasil copy dari spreadsheet SPS. Tiap baris: [No] NIM Nama [Prodi...].
 * NIM = angka pertama yang panjangnya >= 6 digit; nama = kolom sesudahnya.
 */
export function parseRoster(text: string): RosterEntry[] {
  const out: RosterEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split("\t").map((c) => c.trim());
    const parts = cells.length > 1 ? cells : line.trim().split(/\s+/);
    const i = parts.findIndex((c) => /^\d{6,}$/.test(c));
    if (i === -1) continue;
    const name = cells.length > 1 ? (parts[i + 1] ?? "") : parts.slice(i + 1).join(" ");
    out.push({ nim: parts[i], name });
  }
  return out;
}

export function readRoster(json: string | null): RosterEntry[] {
  if (!json) return [];
  try {
    return JSON.parse(json) as RosterEntry[];
  } catch {
    return [];
  }
}
