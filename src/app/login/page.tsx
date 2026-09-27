import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { SignInButton } from "@/components/AuthButtons";
import { authOptions, isAllowedEmail } from "@/lib/auth";

const SAMPLE = [
  { name: "Tugas 1 · Logika Boolean", nim: "1241400xx", score: 88 },
  { name: "Tugas 2 · Gerbang Logika", nim: "1241400xx", score: 92 },
  { name: "Tugas 3 · K-Map", nim: "1241400xx", score: 79 },
  { name: "Tugas 4 · Flip-Flop", nim: "1241400xx", score: 95 },
];

function Check() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" stroke="var(--ok)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getServerSession(authOptions);
  if (session && isAllowedEmail(session.user?.email)) redirect("/classroom");
  const { error } = await searchParams;

  return (
    <div className="login-wrap">
      <section className="login-hero">
        <span className="eyebrow">Asisten Praktikum · DTD ITERA</span>
        <h1>
          Koreksi tugas, <em>tanpa</em> begadang.
        </h1>
        <p className="sub">
          Ambil tugas dari Google Classroom, nilai berdasarkan materi kuliah dan rubrik, lalu rekap ke spreadsheet SPS.
        </p>
        <div className="sheet" aria-hidden="true">
          {SAMPLE.map((s) => (
            <div className="sheet-row" key={s.name}>
              <span>
                {s.name}
                <br />
                <span className="nim">{s.nim}</span>
              </span>
              <Check />
              <span className="score">{s.score}</span>
            </div>
          ))}
          <span className="sheet-stamp">DINILAI</span>
        </div>
      </section>

      <div className="card login-card">
        <h2>Masuk</h2>
        <p className="muted small" style={{ margin: "0 0 22px" }}>
          Gunakan akun Google yang terdaftar sebagai pengajar di Classroom.
        </p>
        {error && (
          <p className="login-error">
            {error === "AccessDenied" ? "Akun ini tidak diizinkan mengakses aplikasi." : "Login gagal, silakan coba lagi."}
          </p>
        )}
        <SignInButton />
        <ul className="login-points">
          <li>Akses Google Classroom hanya-baca</li>
          <li>Password Google tidak pernah dilihat aplikasi</li>
          <li>Hanya akun yang diizinkan yang bisa masuk</li>
        </ul>
      </div>
    </div>
  );
}
