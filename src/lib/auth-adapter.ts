import { and, eq } from "drizzle-orm";
import type { Adapter, AdapterAccount, AdapterUser } from "next-auth/adapters";
import { db } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";

const first = <T,>(rows: T[]) => rows[0] ?? null;

/** Adapter NextAuth v4 untuk Drizzle (tabel sama dengan skema Prisma sebelumnya). */
export function DrizzleAdapter(): Adapter {
  return {
    async createUser(data: Omit<AdapterUser, "id">) {
      return (await db.insert(users).values(data).returning())[0] as AdapterUser;
    },
    async getUser(id) {
      return first(await db.select().from(users).where(eq(users.id, id))) as AdapterUser | null;
    },
    async getUserByEmail(email) {
      return first(await db.select().from(users).where(eq(users.email, email))) as AdapterUser | null;
    },
    async getUserByAccount({ provider, providerAccountId }) {
      const row = first(
        await db
          .select({ user: users })
          .from(accounts)
          .innerJoin(users, eq(accounts.userId, users.id))
          .where(and(eq(accounts.provider, provider), eq(accounts.providerAccountId, providerAccountId))),
      );
      return (row?.user ?? null) as AdapterUser | null;
    },
    async updateUser({ id, ...data }) {
      return (await db.update(users).set(data).where(eq(users.id, id)).returning())[0] as AdapterUser;
    },
    async deleteUser(id) {
      await db.delete(users).where(eq(users.id, id));
    },
    async linkAccount(account: AdapterAccount) {
      await db.insert(accounts).values(account as typeof accounts.$inferInsert);
      return account as AdapterAccount;
    },
    async unlinkAccount({ provider, providerAccountId }: Pick<AdapterAccount, "provider" | "providerAccountId">) {
      await db
        .delete(accounts)
        .where(and(eq(accounts.provider, provider), eq(accounts.providerAccountId, providerAccountId)));
    },
    async createSession(data) {
      return (await db.insert(sessions).values(data).returning())[0];
    },
    async getSessionAndUser(sessionToken) {
      const row = first(
        await db
          .select({ session: sessions, user: users })
          .from(sessions)
          .innerJoin(users, eq(sessions.userId, users.id))
          .where(eq(sessions.sessionToken, sessionToken)),
      );
      return row ? { session: row.session, user: row.user as AdapterUser } : null;
    },
    async updateSession(data) {
      return first(await db.update(sessions).set(data).where(eq(sessions.sessionToken, data.sessionToken)).returning());
    },
    async deleteSession(sessionToken) {
      await db.delete(sessions).where(eq(sessions.sessionToken, sessionToken));
    },
    async createVerificationToken(data) {
      return (await db.insert(verificationTokens).values(data).returning())[0];
    },
    async useVerificationToken({ identifier, token }) {
      return first(
        await db
          .delete(verificationTokens)
          .where(and(eq(verificationTokens.identifier, identifier), eq(verificationTokens.token, token)))
          .returning(),
      );
    },
  };
}
