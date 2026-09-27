import type { Metadata } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { SignOutButton } from "@/components/AuthButtons";
import "./globals.css";

export const metadata: Metadata = {
  title: "SPS Auto Grader",
  description: "Penilaian tugas otomatis dengan Gemini AI berbasis materi kuliah",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  return (
    <html lang="id">
      <body>
        {session && (
          <header className="topbar">
            <Link href="/" className="brand">SPS Auto Grader</Link>
            <nav>
              <Link href="/classroom">Google Classroom</Link>
              <Link href="/materials">Materi</Link>
            </nav>
            <span className="user">{session.user?.email}</span>
            <SignOutButton />
          </header>
        )}
        <main>{children}</main>
      </body>
    </html>
  );
}
