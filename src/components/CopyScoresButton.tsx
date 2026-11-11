"use client";

import { useToast } from "@/components/Toaster";

/** Salin nilai (satu per baris, urut SPS) agar bisa langsung di-paste ke satu kolom spreadsheet. */
export function CopyScoresButton({ values, label }: { values: (string | number)[]; label: string }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(values.map(String).join("\n"));
      const filled = values.filter((v) => v !== "").length;
      toast({ tone: "ok", message: `${values.length} baris disalin (${filled} berisi nilai). Paste di sel baris pertama kolom ${label}.` });
    } catch {
      toast({ tone: "err", message: "Gagal menyalin ke clipboard." });
    }
  };
  return (
    <button type="button" className="btn" onClick={copy}>
      📋 Salin nilai (urut SPS)
    </button>
  );
}
