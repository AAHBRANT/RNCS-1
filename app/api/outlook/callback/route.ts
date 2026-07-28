import { NextRequest, NextResponse } from "next/server";
import { ensureDatabase, getDb } from "../../../../db";
import { outlookConnections } from "../../../../db/schema";
import { encryptToken, microsoftConfig, redeemToken } from "../../../../lib/outlook-auth";

export async function GET(request: NextRequest) {
  const destination = new URL("/", request.url);
  try {
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const expectedState = request.cookies.get("outlook_oauth_state")?.value;
    if (!code || !state || !expectedState || state !== expectedState) throw new Error("Retorno OAuth inválido ou expirado.");
    const config = microsoftConfig(request.nextUrl.origin);
    const token = await redeemToken(new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: config.redirectUri,
    }), request.nextUrl.origin);
    if (!token.refresh_token) throw new Error("A Microsoft não forneceu acesso contínuo. Tente conectar novamente.");
    const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
      headers: { authorization: `Bearer ${token.access_token}` }, cache: "no-store",
    });
    if (!profileResponse.ok) throw new Error("Não foi possível confirmar a conta Microsoft.");
    const profile = await profileResponse.json() as { mail?: string; userPrincipalName?: string };
    const email = (profile.mail || profile.userPrincipalName || "").toLowerCase();
    const allowed = (process.env.OUTLOOK_ACCOUNT_EMAIL || "").trim().toLowerCase();
    if (!email || !allowed) throw new Error("OUTLOOK_ACCOUNT_EMAIL não configurada.");
    if (email !== allowed) throw new Error(`A conta selecionada não é a conta Outlook autorizada.`);
    await ensureDatabase();
    const db = getDb();
    await db.insert(outlookConnections).values({
      accountEmail: email, encryptedRefreshToken: encryptToken(token.refresh_token),
    }).onConflictDoUpdate({
      target: outlookConnections.accountEmail,
      set: { encryptedRefreshToken: encryptToken(token.refresh_token), connectedAt: new Date().toISOString() },
    });
    destination.searchParams.set("outlook", "connected");
  } catch (error) {
    destination.searchParams.set("outlook", "error");
    destination.searchParams.set("message", error instanceof Error ? error.message : "Falha ao conectar Outlook.");
  }
  const response = NextResponse.redirect(destination);
  response.cookies.delete("outlook_oauth_state");
  return response;
}
