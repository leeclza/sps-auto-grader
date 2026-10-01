import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { SignInButton } from "@/components/AuthButtons";
import { authOptions, isAllowedEmail } from "@/lib/auth";

const SAMPLE = [
  { name: "Kalkulus · Integral Parsial", nim: "1231200xx", score: 88 },
  { name: "Basis Data · Normalisasi", nim: "1241400xx", score: 92 },
  { name: "Fisika Dasar · Hukum Newton", nim: "1251100xx", score: 79 },
  { name: "Struktur Data · Linked List", nim: "1221400xx", score: 95 },
];

function Check({ delay }: { delay: number }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12.5l4.5 4.5L19 7.5"
        stroke="var(--ok)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={24}
        strokeDashoffset={24}
        className="animate-draw"
        style={{ animationDelay: `${delay}s` }}
      />
    </svg>
  );
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getServerSession(authOptions);
  if (session && isAllowedEmail(session.user?.email)) redirect("/classroom");
  const { error } = await searchParams;

  return (
    <div className="grid items-center gap-8 pt-3 lg:min-h-[calc(100vh-116px)] lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:pt-0">
      <section>
        <span className="eyebrow">Asisten Praktikum · DTD ITERA</span>
        <h1 className="text-[clamp(34px,5vw,54px)] leading-[1.05]">
          Koreksi tugas, <em className="text-primary italic">tanpa</em> begadang.
        </h1>
        <p className="mb-6 max-w-[68ch] text-[17px] text-muted">
          Ambil tugas dari Google Classroom, nilai berdasarkan materi kuliah dan rubrik, lalu rekap ke spreadsheet SPS.
        </p>
        <div
          className="relative mt-7 hidden max-w-[440px] -rotate-[1.2deg] rounded-card border border-line bg-surface py-2 shadow-md lg:block"
          aria-hidden="true"
        >
          {SAMPLE.map((s, i) => (
            <div
              key={s.name}
              className="grid animate-rise grid-cols-[1fr_auto_40px] items-center gap-3 border-b border-dashed border-line px-[18px] py-[9px] text-sm last:border-b-0"
              style={{ animationDelay: `${0.3 + i * 0.15}s` }}
            >
              <span>
                {s.name}
                <br />
                <span className="font-mono text-[12.5px] text-muted">{s.nim}</span>
              </span>
              <Check delay={0.7 + i * 0.15} />
              <span className="text-right font-mono font-semibold text-primary">{s.score}</span>
            </div>
          ))}
          <span className="absolute -right-3.5 -bottom-[22px] animate-stamp rounded-lg border-[2.5px] border-primary bg-surface/85 px-3.5 py-1.5 font-mono text-[13px] font-bold tracking-[0.12em] text-primary">
            DINILAI
          </span>
        </div>
      </section>

      <div className="card w-full max-w-[400px] animate-[rise_0.6s_0.1s_var(--ease-out-soft)_both] justify-self-center px-[30px] py-[34px]">
        <h2 className="mt-0 mb-1.5 text-2xl">Masuk</h2>
        <p className="mb-[22px] text-[13px] text-muted">
          Gunakan akun Google yang terdaftar sebagai pengajar di Classroom.
        </p>
        {error && (
          <p className="mb-3.5 animate-shake rounded-field bg-err-bg px-3 py-2.5 text-sm text-err">
            {error === "AccessDenied" ? "Akun ini tidak diizinkan mengakses aplikasi." : "Login gagal, silakan coba lagi."}
          </p>
        )}
        <SignInButton />
        <ul className="mt-[22px] grid gap-2 border-t border-dashed border-line-strong pt-[18px] text-[13px] text-muted">
          {[
            "Akses Google Classroom hanya-baca",
            "Password Google tidak pernah dilihat aplikasi",
            "Hanya akun yang diizinkan yang bisa masuk",
          ].map((t) => (
            <li key={t} className="flex items-start gap-2 before:font-bold before:text-ok before:content-['✓']">
              {t}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
