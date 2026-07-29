import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { microsoftConfig } from "../../../../lib/outlook-auth";

export async function GET(request: NextRequest) {
  const config = microsoftConfig(request.nextUrl.origin);
  const redirectUri = `${request.nextUrl.origin}/api/auth/callback`;
  const state = randomBytes(24).toString("base64url");
  const authorize = new URL(`${config.authority}/authorize`);
  authorize.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: "openid profile email https://graph.microsoft.com/User.Read",
    state,
  }).toString();
  const response = NextResponse.redirect(authorize);
  response.cookies.set("rnc_auth_state", state, {
    httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", maxAge: 600, path: "/",
  });
  return response;
}
