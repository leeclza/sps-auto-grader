import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { getServerSession, type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";

// Scope read-only Google Classroom. Sheets/Drive ditambahkan saat modul spreadsheet dibuat.
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.students.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.profile.emails",
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
  adapter: PrismaAdapter(prisma),
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
      await prisma.account.updateMany({
        where: { provider: account.provider, providerAccountId: account.providerAccountId },
        data: {
          access_token: account.access_token,
          expires_at: account.expires_at,
          scope: account.scope,
          id_token: account.id_token,
          ...(account.refresh_token ? { refresh_token: account.refresh_token } : {}),
        },
      });
    },
  },
  callbacks: {
    signIn({ user, profile }) {
      const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified !== false;
      return verified && isAllowedEmail(user.email);
    },
    session({ session, user }) {
      if (session.user) (session.user as { id?: string }).id = user.id;
      return session;
    },
  },
  pages: { signIn: "/login", error: "/login" },
};

export async function requireUser() {
  const session = await getServerSession(authOptions);
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!session?.user || !id || !isAllowedEmail(session.user.email)) redirect("/login");
  return { id, name: session.user.name, email: session.user.email, image: session.user.image };
}
