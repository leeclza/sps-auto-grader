"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card">
      <h1>Terjadi kesalahan</h1>
      <div className="alert err">{error.message || "Kesalahan tidak diketahui."}</div>
      <p className="muted small">
        Jika pesan menyebut izin/scope Google, keluar lalu masuk lagi dengan Google agar izin Classroom diberikan.
      </p>
      <button className="btn" onClick={reset}>Coba lagi</button>
    </div>
  );
}
