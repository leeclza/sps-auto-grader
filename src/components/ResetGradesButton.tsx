"use client";

import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SubmitButton } from "@/components/SubmitButton";

/** Tombol "Reset semua nilai" dengan konfirmasi karena menghapus nilai yang sudah ada. */
export function ResetGradesButton({
  action,
  count,
  disabled,
}: {
  action: (formData: FormData) => void | Promise<void>;
  count: number;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const submitRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <button type="button" className="btn" disabled={disabled} onClick={() => setOpen(true)}>
        Reset semua nilai
      </button>
      {/* Tombol submit asli disembunyikan; diklik setelah dikonfirmasi agar tetap memakai form & status pending. */}
      <div ref={submitRef} hidden>
        <SubmitButton className="btn" pendingText="Mereset..." formAction={action}>
          Reset semua nilai
        </SubmitButton>
      </div>
      {open && (
        <ConfirmDialog
          title="Reset semua nilai?"
          confirmText="Reset"
          danger
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setOpen(false);
            submitRef.current?.querySelector("button")?.click();
          }}
        >
          Semua nilai, rincian, dan feedback dari <b className="text-ink">{count} submission</b> akan dihapus, termasuk nilai
          yang sudah Anda koreksi manual. Setelah itu klik “Koreksi dengan AI” untuk mulai menilai. Anda yakin?
        </ConfirmDialog>
      )}
    </>
  );
}
