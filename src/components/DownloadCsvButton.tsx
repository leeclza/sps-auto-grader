"use client";

/** Unduh data tabel sebagai CSV (dengan BOM agar Excel membaca UTF-8 dengan benar). */
export function DownloadCsvButton({ rows, filename }: { rows: (string | number)[][]; filename: string }) {
  const download = () => {
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button type="button" className="btn" onClick={download}>
      ⬇ Download CSV
    </button>
  );
}
