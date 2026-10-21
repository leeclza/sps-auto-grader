"use client";

import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SubmitButton } from "@/components/SubmitButton";

/** Tombol "Nilai ulang semua" dengan konfirmasi karena menghapus nilai yang sudah ada. */
export function RegradeAllButton({
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
        Nilai ulang semua
      </button>
      {/* Tombol submit asli disembunyikan; diklik setelah dikonfirmasi agar tetap memakai form & status pending. */}
      <div ref={submitRef} hidden>
        <SubmitButton className="btn" pendingText="Memproses..." formAction={action}>
          Nilai ulang semua
        </SubmitButton>
      </div>
      {open && (
        <ConfirmDialog
          title="Nilai ulang semua?"
          confirmText="Nilai ulang"
          danger
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setOpen(false);
            submitRef.current?.querySelector("button")?.click();
          }}
        >
          Semua nilai, rincian, dan feedback dari <b className="text-ink">{count} submission</b> akan dihapus lalu dinilai ulang
          oleh AI, termasuk nilai yang sudah Anda koreksi manual. Anda yakin?
        </ConfirmDialog>
      )}
    </>
  );
}
