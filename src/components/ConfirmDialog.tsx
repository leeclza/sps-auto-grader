"use client";

import { createPortal } from "react-dom";

/** Modal konfirmasi di tengah layar. */
export function ConfirmDialog({
  title,
  children,
  confirmText,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: React.ReactNode;
  confirmText: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Portal ke body: ancestor beranimasi (transform) membuat `fixed` tidak relatif ke layar.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="card w-full max-w-sm animate-[rise_0.3s_var(--ease-out-soft)_both]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      >
        <h2 id="confirm-dialog-title" className="m-0">{title}</h2>
        <p className="mt-2 text-muted">{children}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn" ref={(el) => el?.focus({ preventScroll: true })} onClick={onCancel}>
            Batal
          </button>
          <button type="button" className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
