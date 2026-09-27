import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { SignOutButton } from "@/components/AuthButtons";
import { NavLinks } from "@/components/NavLinks";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "SPS Auto Grader",
  description: "Penilaian tugas otomatis dengan Gemini AI berbasis materi kuliah",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? "";
  return (
    <html lang="id" className={`${geist.variable} ${geistMono.variable} ${fraunces.variable}`}>
      <body>
        {session && (
          <header className="topbar">
            <Link href="/" className="brand">
              <span className="brand-mark">S</span>
              <span className="brand-name">SPS Auto Grader</span>
            </Link>
            <NavLinks />
            <span className="user-chip" title={email}>
              <span className="avatar">{(session.user?.name ?? email).charAt(0).toUpperCase()}</span>
              <span className="email">{email}</span>
            </span>
            <SignOutButton />
          </header>
        )}
        <main>{children}</main>
      </body>
    </html>
  );
}
