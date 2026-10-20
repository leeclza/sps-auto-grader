"use client";

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
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled} name={name} value={value} formAction={formAction} aria-busy={pending}>
      {pending && <span className="spinner" aria-hidden="true" />}
      {pending ? pendingText : children}
    </button>
  );
}
