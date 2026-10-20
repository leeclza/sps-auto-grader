"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

/** Feedback satu baris di tabel; klik untuk membuka teks lengkap + komentar per kriteria. */
export function FeedbackCell({
  student,
  text,
  error = false,
  comments = [],
}: {
  student: string;
  text: string;
  error?: boolean;
  comments?: { name: string; score: number; comment: string }[];
}) {
  const [open, setOpen] = useState(false);
  if (!text) return null;

  return (
    <>
      {/* Satu baris, bisa digeser ke samping tanpa scrollbar; klik untuk pop-up. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen(true)}
        title="Geser ke samping, atau klik untuk lihat lengkap"
        style={{ scrollbarWidth: "none" }}
        className={`w-[32ch] cursor-pointer overflow-x-auto whitespace-nowrap text-[13px] hover:underline ${error ? "text-err" : "text-ink"}`}
      >
        {text}
      </div>
      {open &&
        // Portal ke body: ancestor beranimasi (transform) membuat `fixed` tidak relatif ke layar.
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="feedback-title"
              className="card max-h-[80vh] w-full max-w-lg animate-[rise_0.3s_var(--ease-out-soft)_both] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
            >
              <h2 id="feedback-title" className="m-0">{error ? "Gagal dinilai" : "Feedback"}</h2>
              <div className="text-[13px] text-muted">{student}</div>
              <p className={`mt-3 whitespace-pre-wrap ${error ? "text-err" : ""}`}>{text}</p>
              {comments.some((c) => c.comment) && (
                <div className="mt-3 border-t border-line pt-3">
                  {comments.map((c) => (
                    <div key={c.name} className="mb-2 text-[13px]">
                      <b>{c.name}</b> <span className="text-muted">· {c.score}</span>
                      {c.comment && <div className="text-muted">{c.comment}</div>}
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4 flex justify-end">
                <button type="button" className="btn" ref={(el) => el?.focus({ preventScroll: true })} onClick={() => setOpen(false)}>
                  Tutup
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
