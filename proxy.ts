import { NextRequest, NextResponse } from "next/server";
import { accessControlEnabled, parseSession, SESSION_COOKIE } from "./lib/access-control";

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/acesso" || path.startsWith("/api/auth/")) return NextResponse.next();
  if (!accessControlEnabled()) return NextResponse.next();
  const session = parseSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();
  if (path.startsWith("/api/")) {
    return NextResponse.json({ error: "Identifique-se com a conta Microsoft autorizada." }, { status: 401 });
  }
  const destination = new URL("/acesso", request.url);
  return NextResponse.redirect(destination);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon-rnc.png|favicon.svg|og.png).*)"],
};
