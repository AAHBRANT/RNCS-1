import { NextRequest, NextResponse } from "next/server";
import { accessUserByEmail, createSession, SESSION_COOKIE } from "../../../../lib/access-control";
import { microsoftConfig } from "../../../../lib/outlook-auth";

export async function GET(request: NextRequest) {
  const destination = new URL("/", request.url);
  try {
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const expectedState = request.cookies.get("rnc_auth_state")?.value;
    if (!code || !state || state !== expectedState) throw new Error("Identificação Microsoft inválida ou expirada.");
    const config = microsoftConfig(request.nextUrl.origin);
    const redirectUri = `${request.nextUrl.origin}/api/auth/callback`;
    const tokenResponse = await fetch(`${config.authority}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        scope: "openid profile email https://graph.microsoft.com/User.Read",
      }),
      cache: "no-store",
    });
    const token = await tokenResponse.json() as { access_token?: string; error_description?: string };
    if (!tokenResponse.ok || !token.access_token) throw new Error(token.error_description || "A Microsoft não confirmou a identidade.");
    const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName", {
      headers: { authorization: `Bearer ${token.access_token}` }, cache: "no-store",
    });
    if (!profileResponse.ok) throw new Error("Não foi possível consultar o perfil corporativo.");
    const profile = await profileResponse.json() as { mail?: string; userPrincipalName?: string };
    const email = (profile.mail || profile.userPrincipalName || "").trim().toLowerCase();
    const user = await accessUserByEmail(email);
    if (!user) throw new Error("Esta conta não está autorizada a acessar o Controle de RNC.");

    const response = NextResponse.redirect(destination);
    response.cookies.set(SESSION_COOKIE, createSession(user), {
      httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax",
      maxAge: 8 * 60 * 60, path: "/",
    });
    response.cookies.delete("rnc_auth_state");
    return response;
  } catch (error) {
    destination.pathname = "/acesso";
    destination.searchParams.set("error", error instanceof Error ? error.message : "Falha ao identificar usuário.");
    const response = NextResponse.redirect(destination);
    response.cookies.delete("rnc_auth_state");
    return response;
  }
}
