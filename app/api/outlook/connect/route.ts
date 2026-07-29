import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { graphScopes, microsoftConfig } from "../../../../lib/outlook-auth";
import { canEditRnc, sessionFromRequest } from "../../../../lib/access-control";

export async function GET(request: Request) {
  try {
    const session = sessionFromRequest(request);
    if (!session || !canEditRnc(session)) {
      return NextResponse.redirect(new URL("/?outlook=error&message=Somente%20a%20administradora%20pode%20conectar%20o%20Outlook.", request.url));
    }
    const origin = new URL(request.url).origin;
    const config = microsoftConfig(origin);
    const state = randomBytes(24).toString("base64url");
    const authorize = new URL(`${config.authority}/authorize`);
    authorize.search = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: config.redirectUri,
      response_mode: "query",
      scope: graphScopes,
      state,
      prompt: "select_account",
    }).toString();
    const response = NextResponse.redirect(authorize);
    response.cookies.set("outlook_oauth_state", state, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/",
    });
    return response;
  } catch (error) {
    return NextResponse.redirect(new URL(`/?outlook=error&message=${encodeURIComponent(error instanceof Error ? error.message : "Falha ao iniciar conexão.")}`, request.url));
  }
}
