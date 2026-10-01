import { and, eq } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";
import { db } from "@/db";
import { accounts } from "@/db/schema";

/** OAuth2 client milik user; token di-refresh otomatis dan disimpan kembali ke DB. */
export async function getGoogleAuth(userId: string) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
    .limit(1);
  if (!account?.refresh_token && !account?.access_token) {
    throw new Error("Akun Google belum terhubung. Silakan login ulang dengan Google.");
  }
  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  client.setCredentials({
    access_token: account.access_token ?? undefined,
    refresh_token: account.refresh_token ?? undefined,
    expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
  });
  client.on("tokens", async (tokens) => {
    await db
      .update(accounts)
      .set({
        access_token: tokens.access_token ?? undefined,
        expires_at: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : undefined,
        ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      })
      .where(eq(accounts.id, account.id));
  });
  return client;
}
