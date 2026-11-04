"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Baris tabel lanjutan yang baru diambil dari server saat di-scroll mendekati bawah,
 * `pageSize` baris sekali ambil. Taruh di dalam <tbody> setelah baris awal.
 */
export function InfiniteRows({
  ids,
  load,
  colSpan,
  version,
  pageSize = 30,
}: {
  ids: string[];
  load: (ids: string[]) => Promise<ReactNode>;
  colSpan: number;
  /** Berubah tiap halaman dirender ulang (mis. auto refresh): baris yang sudah dimuat diambil ulang. */
  version: number;
  pageSize?: number;
}) {
  const [rows, setRows] = useState<ReactNode[]>([]);
  const [count, setCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const sentinel = useRef<HTMLTableRowElement>(null);
  const latest = useRef({ ids, load, count });
  latest.current = { ids, load, count };

  const loadMore = useCallback(async () => {
    const { ids, load, count } = latest.current;
    if (busy.current || count >= ids.length) return;
    busy.current = true;
    try {
      const next = Math.min(count + pageSize, ids.length);
      const node = await load(ids.slice(count, next));
      setRows((r) => [...r, node]);
      setCount(next);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
    }
  }, [pageSize]);

  // Data halaman berubah (refresh): ambil ulang baris yang sudah tampil supaya tidak basi.
  useEffect(() => {
    const { ids, load, count } = latest.current;
    if (count === 0) return;
    const n = Math.min(count, ids.length);
    let cancelled = false;
    busy.current = true;
    load(ids.slice(0, n))
      .then((node) => {
        if (cancelled) return;
        setRows([node]);
        setCount(n);
      })
      .catch(() => {})
      .finally(() => {
        busy.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  // Observer dibuat ulang tiap selesai memuat, jadi kalau penanda masih terlihat langsung lanjut.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || count >= ids.length || failed) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [count, ids.length, failed, loadMore]);

  const remaining = ids.length - count;
  return (
    <>
      {rows}
      {remaining > 0 && (
        <tr ref={sentinel}>
          <td colSpan={colSpan} className="text-center text-[13px] text-muted">
            {failed ? (
              <button type="button" className="btn" onClick={() => setFailed(false)}>
                Gagal memuat, coba lagi
              </button>
            ) : (
              <>Memuat {Math.min(remaining, pageSize)} dari {remaining} mahasiswa berikutnya…</>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
