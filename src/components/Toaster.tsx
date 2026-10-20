"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type ToastTone = "ok" | "warn" | "err" | "info";

interface Toast {
  id: number;
  tone: ToastTone;
  title?: string;
  message: string;
}

type ShowToast = (t: Omit<Toast, "id">) => void;

// Lama tampil per jenis (ms). Error lebih lama supaya sempat dibaca.
const DURATION: Record<ToastTone, number> = { ok: 5000, info: 5000, warn: 7000, err: 10000 };

const TONE_CLASS: Record<ToastTone, string> = {
  ok: "border-ok/30 bg-ok-bg text-ok",
  warn: "border-warn/30 bg-warn-bg text-warn",
  err: "border-err/30 bg-err-bg text-err",
  info: "border-line-strong bg-surface text-ink",
};

const ToastContext = createContext<ShowToast>(() => {});

/** Panggil `toast({ tone, title?, message })` dari komponen client mana pun. */
export const useToast = () => useContext(ToastContext);

function ToastItem({ toast, onClose }: { toast: Toast; onClose: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(DURATION[toast.tone]);

  // Hilang otomatis; dijeda selama kursor di atas toast, lalu lanjut dari sisa waktunya.
  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const t = setTimeout(() => onClose(toast.id), remaining.current);
    return () => {
      clearTimeout(t);
      remaining.current -= Date.now() - startedAt;
    };
  }, [paused, toast.id, onClose]);

  return (
    <div
      role={toast.tone === "err" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`pointer-events-auto relative flex animate-rise items-start gap-3 overflow-hidden rounded-field border px-4 py-3 text-sm shadow-md ${TONE_CLASS[toast.tone]}`}
    >
      <div className="min-w-0 flex-1">
        {toast.title && <div className="font-semibold">{toast.title}</div>}
        <div className={toast.title ? "opacity-90" : ""}>{toast.message}</div>
      </div>
      <button
        type="button"
        onClick={() => onClose(toast.id)}
        aria-label="Tutup notifikasi"
        className="-mr-1 grid size-6 flex-none cursor-pointer place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
      >
        ✕
      </button>
      {/* Bilah sisa waktu */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-current opacity-30"
        style={{
          animation: `toast-timer ${DURATION[toast.tone]}ms linear forwards`,
          animationPlayState: paused ? "paused" : "running",
        }}
      />
    </div>
  );
}

export function Toaster({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const show = useCallback<ShowToast>((t) => {
    const id = ++nextId.current;
    // Maksimal 4 toast sekaligus; yang paling lama dibuang.
    setToasts((list) => [...list.slice(-3), { ...t, id }]);
  }, []);

  const close = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 left-4 z-50 flex flex-col items-stretch gap-2 sm:left-auto sm:w-sm"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={close} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Tampilkan satu toast saat komponen muncul (untuk pesan dari server, mis. setelah redirect). */
export function ToastOnMount({ tone, title, message }: Omit<Toast, "id">) {
  const toast = useToast();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    toast({ tone, title, message });
  }, [toast, tone, title, message]);
  return null;
}
