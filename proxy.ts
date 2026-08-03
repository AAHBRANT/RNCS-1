import { NextRequest, NextResponse } from "next/server";
import { accessControlEnabled, parseSession, SESSION_COOKIE } from "./lib/access-control";

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/acesso" || path === "/selecionar-obra" || path.startsWith("/api/auth/") || path.startsWith("/api/works/")) return NextResponse.next();
  if (!accessControlEnabled()) return NextResponse.next();
  const session = parseSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Identifique-se com a conta Microsoft autorizada." }, { status: 401 });
    }
    const destination = new URL("/acesso", request.url);
    return NextResponse.redirect(destination);
  }
  // Checagem barata: se sessão existe mas obra ativa não foi escolhida, redirecionar pra seleção
  if (session.activeWorkId === null && !path.startsWith("/api/")) {
    const destination = new URL("/selecionar-obra", request.url);
    return NextResponse.redirect(destination);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon-rnc.png|favicon.svg|og.png).*)"],
};
