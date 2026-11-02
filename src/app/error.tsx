"use client";

import { signIn } from "next-auth/react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // invalid_grant: refresh token Google kedaluwarsa/dicabut (app status "Testing" = hangus tiap 7 hari).
  const expired = /invalid_grant|belum terhubung/i.test(error.message ?? "");
  return (
    <div className="card">
      <h1>{expired ? "Sesi Google kedaluwarsa" : "Terjadi kesalahan"}</h1>
      <div className="alert alert-err">
        {expired
          ? "Izin akses Google Classroom sudah kedaluwarsa. Masuk lagi dengan Google untuk memperbaruinya."
          : error.message || "Kesalahan tidak diketahui."}
      </div>
      {!expired && (
        <p className="mb-4 text-[13px] text-muted">
          Jika pesan menyebut izin/scope Google, keluar lalu masuk lagi dengan Google agar izin Classroom diberikan.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {expired && (
          <button className="btn btn-primary" onClick={() => signIn("google", { callbackUrl: window.location.href })}>
            Masuk lagi dengan Google
          </button>
        )}
        <button className="btn" onClick={reset}>Coba lagi</button>
      </div>
    </div>
  );
}
