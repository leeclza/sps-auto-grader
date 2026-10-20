"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/Toaster";

interface MaterialStatus {
  id: string;
  title: string;
  meeting: number | null;
  status: string;
  error: string | null;
}

const label = (m: MaterialStatus) => (m.meeting ? `P${m.meeting} · ${m.title}` : m.title);

/** Munculkan toast saat materi berubah dari "processing" menjadi "ready" atau "error". */
export function MaterialStatusToasts({ materials }: { materials: MaterialStatus[] }) {
  const toast = useToast();
  const prev = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = new Map(materials.map((m) => [m.id, m.status]));
    if (!before) return; // render pertama: hanya catat status awal

    const finished = materials.filter((m) => before.get(m.id) === "processing");
    const ready = finished.filter((m) => m.status === "ready");
    const failed = finished.filter((m) => m.status === "error");

    if (ready.length === 1) {
      toast({ tone: "ok", title: "Materi selesai dipelajari", message: label(ready[0]) });
    } else if (ready.length > 1) {
      toast({
        tone: "ok",
        title: `${ready.length} materi selesai dipelajari`,
        message: ready.map(label).join(", "),
      });
    }
    for (const m of failed) {
      toast({ tone: "err", title: `Gagal mempelajari ${label(m)}`, message: m.error ?? "Terjadi kesalahan." });
    }
  }, [materials, toast]);

  return null;
}
