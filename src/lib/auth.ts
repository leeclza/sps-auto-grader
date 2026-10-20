import { and, eq } from "drizzle-orm";
import { getServerSession, type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { DrizzleAdapter } from "./auth-adapter";

// Classroom read-only, Drive read-only (baca lampiran submission), drive.file (buat & isi spreadsheet SPS).
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.students.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.profile.emails",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

// Hanya email di ALLOWED_EMAILS (dipisah koma) yang boleh login.
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS ?? "christopher.124140097@student.itera.ac.id")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAllowedEmail(email?: string | null) {
  return !!email && ALLOWED_EMAILS.includes(email.toLowerCase());
}

export const authOptions: NextAuthOptions = {
  adapter: DrizzleAdapter(),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: GOOGLE_SCOPES.join(" "),
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: "true",
        },
      },
    }),
  ],
  events: {
    // Adapter hanya menyimpan token saat akun pertama kali ditautkan;
    // saat login ulang, perbarui token & scope agar tetap valid.
    async signIn({ account }) {
      if (!account) return;
      await db
        .update(accounts)
        .set({
          access_token: account.access_token,
          expires_at: account.expires_at,
          scope: account.scope,
          id_token: account.id_token,
          ...(account.refresh_token ? { refresh_token: account.refresh_token } : {}),
        })
        .where(and(eq(accounts.provider, account.provider), eq(accounts.providerAccountId, account.providerAccountId)));
    },
  },
  callbacks: {
    signIn({ user, profile }) {
      const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified !== false;
      return verified && isAllowedEmail(user.email);
    },
    // Sesi disimpan di cookie JWT terenkripsi: cek login tidak perlu query ke database.
    // Database hanya dipakai saat login (simpan user + token Google).
    session({ session, token }) {
      if (session.user) (session.user as { id?: string }).id = token.sub;
      return session;
    },
  },
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
};

/** Satu kali baca sesi per request, dipakai bersama oleh layout dan halaman. */
export const getSession = cache(() => getServerSession(authOptions));

export async function requireUser() {
  const session = await getSession();
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!session?.user || !id || !isAllowedEmail(session.user.email)) redirect("/login");
  return { id, name: session.user.name, email: session.user.email, image: session.user.image };
}
