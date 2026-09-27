"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Muat ulang data halaman secara berkala selama masih ada proses di background. */
export function AutoRefresh({ active, intervalMs = 5000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}
