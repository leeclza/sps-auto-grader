"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingText = "Memproses...",
  className = "btn btn-primary",
  name,
  value,
  disabled,
  formAction,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  const { pending, action } = useFormStatus();
  // Spinner hanya di tombol yang diklik bila form punya beberapa formAction.
  const busy = pending && (!formAction || action === formAction);
  // `disabled` baru berlaku setelah render ulang; ref menahan klik cepat berulang sebelum itu.
  const submitted = useRef(false);
  useEffect(() => {
    if (!pending) submitted.current = false;
  }, [pending]);
  return (
    <button
      type="submit"
      className={className}
      disabled={pending || disabled}
      name={name}
      value={value}
      formAction={formAction}
      aria-busy={busy}
      onClick={(e) => {
        if (submitted.current) e.preventDefault();
        else submitted.current = true;
      }}
    >
      {busy && <span className="spinner" aria-hidden="true" />}
      {busy ? pendingText : children}
    </button>
  );
}
