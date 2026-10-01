"use client";

import { useActionState, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { syncCourses, type SyncResult } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";

export function SyncCoursesButton() {
  const [result, action] = useActionState<SyncResult | null>(() => syncCourses(), null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!result) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), result.tone === "ok" ? 4000 : 10000);
    return () => clearTimeout(t);
  }, [result]);

  return (
    <>
      <form action={action}>
        <SubmitButton pendingText="Mengambil dari GCR...">Sinkronkan dari Google Classroom</SubmitButton>
      </form>
      {result && visible && createPortal(
        <div
          role={result.tone === "err" ? "alert" : "status"}
          className={`fixed right-4 bottom-4 left-4 z-50 flex animate-rise items-start gap-3 rounded-field border px-4 py-3 text-sm shadow-lg sm:left-auto sm:max-w-sm ${
            { ok: "border-ok/30 bg-ok-bg text-ok", warn: "border-warn/30 bg-warn-bg text-warn", err: "border-err/30 bg-err-bg text-err" }[result.tone]
          }`}
        >
          <span className="flex-1">{result.message}</span>
          <button type="button" onClick={() => setVisible(false)} aria-label="Tutup" className="cursor-pointer opacity-70 hover:opacity-100">
            ✕
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
