"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";

/**
 * Tombol dengan pop-up konfirmasi agar tidak tak sengaja terpencet.
 * `href`: pindah halaman setelah dikonfirmasi; `formAction`: kirim form induk setelah dikonfirmasi.
 */
export function ConfirmButton({
  className,
  children,
  title,
  message,
  confirmText,
  danger = false,
  href,
  formAction,
}: {
  className: string;
  children: React.ReactNode;
  title: string;
  message: React.ReactNode;
  confirmText: string;
  danger?: boolean;
  href?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const submitRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      {formAction && <button ref={submitRef} type="submit" formAction={formAction} hidden />}
      {open && (
        <ConfirmDialog
          title={title}
          confirmText={confirmText}
          danger={danger}
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setOpen(false);
            if (href) router.push(href);
            else submitRef.current?.click();
          }}
        >
          {message}
        </ConfirmDialog>
      )}
    </>
  );
}
