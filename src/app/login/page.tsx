import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { SignInButton } from "@/components/AuthButtons";
import { authOptions, isAllowedEmail } from "@/lib/auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getServerSession(authOptions);
  if (session && isAllowedEmail(session.user?.email)) redirect("/classroom");
  const { error } = await searchParams;
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="login-logo" aria-hidden="true">✓</div>
        <h1>SPS Auto Grader</h1>
        <p className="sub">Masuk untuk mengambil tugas dari Google Classroom dan menilainya otomatis dengan Gemini.</p>
        {error && (
          <p className="login-error">
            {error === "AccessDenied"
              ? "Akun ini tidak diizinkan mengakses aplikasi."
              : "Login gagal, silakan coba lagi."}
          </p>
        )}
        <SignInButton />
        <ul className="login-points">
          <li>Akses <b>baca saja</b> ke Google Classroom</li>
          <li>Password Google Anda tidak pernah dilihat aplikasi</li>
        </ul>
      </div>
    </div>
  );
}
