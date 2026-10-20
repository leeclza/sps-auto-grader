"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * Tombol submit yang hanya aktif bila minimal satu checkbox `name` di form yang sama dicentang.
 * Selama belum ada yang dipilih, tombol tampil abu-abu.
 */
export function CheckedSubmitButton({
  name,
  children,
  pendingText = "Memproses...",
}: {
  name: string;
  children: React.ReactNode;
  pendingText?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [count, setCount] = useState(0);
  const { pending } = useFormStatus();

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const recount = () => setCount(form.querySelectorAll(`input[type="checkbox"][name="${name}"]:checked`).length);
    recount();
    form.addEventListener("change", recount);
    // Baris tugas bisa hilang/berubah setelah submit tanpa event "change".
    const observer = new MutationObserver(recount);
    observer.observe(form, { childList: true, subtree: true });
    return () => {
      form.removeEventListener("change", recount);
      observer.disconnect();
    };
  }, [name]);

  const empty = count === 0;
  return (
    <button
      ref={ref}
      type="submit"
      disabled={empty || pending}
      aria-busy={pending}
      title={empty ? "Centang dulu tugas yang mau dinilai" : undefined}
      className={empty ? "btn cursor-not-allowed text-muted opacity-60 hover:border-line-strong hover:bg-surface hover:text-muted active:scale-100" : "btn btn-primary"}
    >
      {pending && <span className="spinner" aria-hidden="true" />}
      {pending ? pendingText : empty ? children : <>{children} ({count})</>}
    </button>
  );
}
