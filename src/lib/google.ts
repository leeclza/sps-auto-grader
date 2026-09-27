import { google } from "googleapis";
import { prisma } from "./prisma";

/** OAuth2 client milik user; token di-refresh otomatis dan disimpan kembali ke DB. */
export async function getGoogleAuth(userId: string) {
  const account = await prisma.account.findFirst({ where: { userId, provider: "google" } });
  if (!account?.refresh_token && !account?.access_token) {
    throw new Error("Akun Google belum terhubung. Silakan login ulang dengan Google.");
  }
  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  client.setCredentials({
    access_token: account.access_token ?? undefined,
    refresh_token: account.refresh_token ?? undefined,
    expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
  });
  client.on("tokens", async (tokens) => {
    await prisma.account.update({
      where: { id: account.id },
      data: {
        access_token: tokens.access_token ?? undefined,
        expires_at: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : undefined,
        ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      },
    });
  });
  return client;
}
