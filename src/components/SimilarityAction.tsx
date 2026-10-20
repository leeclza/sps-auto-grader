"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { decideSimilarity } from "@/app/actions";
import { useToast } from "@/components/Toaster";
import type { SimilarityMatch } from "@/lib/similarity";

/** Tombol "Cek" di kolom Aksi: pop-up bukti kemiripan + keputusan Terima / Tolak. */
export function SimilarityAction({
  submissionId,
  student,
  matches,
  decision,
}: {
  submissionId: string;
  student: string;
  matches: SimilarityMatch[];
  decision: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  if (!matches.length) return <span className="text-muted">—</span>;

  const decide = (d: "accepted" | "rejected") =>
    startTransition(async () => {
      await decideSimilarity(submissionId, d);
      setOpen(false);
      toast({ tone: "ok", message: d === "accepted" ? `${student}: tetap dinilai.` : `${student}: ditolak, nilai 0.` });
    });

  return (
    <>
      <button type="button" className={`btn ${decision ? "" : "btn-primary"}`} onClick={() => setOpen(true)}>
        {decision ? "Ubah" : "Cek"}
      </button>
      {open &&
        // Portal ke body: ancestor beranimasi (transform) membuat `fixed` tidak relatif ke layar.
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="similarity-title"
              className="card max-h-[85vh] w-full max-w-2xl animate-[rise_0.3s_var(--ease-out-soft)_both] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
            >
              <h2 id="similarity-title" className="m-0">Kemiripan terdeteksi</h2>
              <div className="text-[13px] text-muted">
                {student}
                {decision && <> · keputusan sekarang: <b>{decision === "accepted" ? "diterima" : "ditolak (nilai 0)"}</b></>}
              </div>

              {matches.map((m) => (
                <div key={m.withId} className="mt-4 border-t border-line pt-3">
                  <div>
                    Mirip dengan <b>{m.withName}</b>{" "}
                    <span className="badge badge-warn">±{m.sharedWords} kata identik · {m.percent}%</span>
                  </div>
                  {m.passages.map((p, i) => (
                    <div key={i} className="mt-2.5 rounded-card border border-line p-2.5 text-[13px]">
                      <blockquote className="m-0 border-l-2 border-warn pl-2.5 italic">“{p.snippet}”</blockquote>
                      <div className="mt-1.5 text-muted">
                        <div>Di sini: <span className="text-ink">{p.here || "-"}</span></div>
                        <div>Di {m.withName}: <span className="text-ink">{p.there || "-"}</span></div>
                        <div>{p.words} kata berurutan sama persis</div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}

              <p className="mt-4 text-[13px] text-muted">
                Cek sendiri lampiran keduanya di lokasi di atas, lalu putuskan. Keputusan bisa diubah lagi nanti.
              </p>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button type="button" className="btn" ref={(el) => el?.focus({ preventScroll: true })} onClick={() => setOpen(false)}>
                  Batal
                </button>
                <button type="button" className="btn btn-danger" disabled={pending} onClick={() => decide("rejected")}>
                  Tolak (nilai 0)
                </button>
                <button type="button" className="btn btn-primary" disabled={pending} onClick={() => decide("accepted")}>
                  Terima (tetap dinilai)
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
