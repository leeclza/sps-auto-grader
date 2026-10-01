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
          <header className="sticky top-0 z-20 flex animate-fade flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-line bg-bg/80 px-[max(16px,calc((100vw-1100px)/2))] py-3 backdrop-blur-md backdrop-saturate-[1.2] md:flex-nowrap md:gap-7">
            <Link href="/" className="group inline-flex items-center gap-2.5 font-semibold text-ink hover:text-ink">
              <span className="grid size-[30px] place-items-center rounded-lg bg-ink font-serif text-[17px] font-bold text-bg transition-transform duration-400 ease-out-soft group-hover:-rotate-8 group-hover:scale-105">
                S
              </span>
              <span className="font-serif text-lg tracking-[-0.01em]">SPS Auto Grader</span>
            </Link>
            <NavLinks />
            <span
              className="ml-auto inline-flex items-center gap-2 rounded-full border border-line bg-surface py-1 pr-2.5 pl-1 text-[13px] text-muted md:ml-0"
              title={email}
            >
              <span className="grid size-6 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary">
                {(session.user?.name ?? email).charAt(0).toUpperCase()}
              </span>
              <span className="hidden md:inline">{email}</span>
            </span>
            <SignOutButton />
          </header>
        )}
        <main className="stagger mx-auto max-w-[1100px] px-4 pt-9 pb-20">{children}</main>
      </body>
    </html>
  );
}
