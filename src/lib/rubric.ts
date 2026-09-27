export interface RubricCriterion {
  name: string;
  description: string;
  weight: number; // persen, total 100
}

export function parseRubric(json?: string | null): RubricCriterion[] {
  if (!json) return [];
  try {
    const data = JSON.parse(json);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export const DEFAULT_RUBRIC: RubricCriterion[] = [
  { name: "Kebenaran jawaban", description: "Jawaban/solusi benar dan sesuai instruksi tugas.", weight: 50 },
  { name: "Kesesuaian dengan materi", description: "Menerapkan konsep dari materi yang dipilih.", weight: 30 },
  { name: "Kejelasan & kerapian", description: "Penjelasan runtut, kode/tulisan rapi dan mudah dipahami.", weight: 20 },
];
