import { NextRequest, NextResponse } from "next/server";
import { ensureDatabase, getDb } from "../../../../../db";
import { canAccessWork, parseSession, SESSION_COOKIE, withActiveWork } from "../../../../../lib/access-control";
import { works } from "../../../../../db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const workId = Number(id);
    if (!workId) {
      return NextResponse.redirect(new URL("/selecionar-obra?error=Obra inválida", request.url));
    }

    const session = parseSession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!session) {
      return NextResponse.redirect(new URL("/acesso", request.url));
    }

    await ensureDatabase();
    const db = getDb();

    const work = await db.select().from(works).where(eq(works.id, workId)).then((rows) => rows[0]);
    if (!work || !work.active) {
      return NextResponse.redirect(new URL("/selecionar-obra?error=Obra não encontrada ou inativa", request.url));
    }

    if (!canAccessWork(session, workId)) {
      return NextResponse.redirect(new URL("/selecionar-obra?error=Sem permissão para acessar esta obra", request.url));
    }

    const newSessionToken = withActiveWork(session, workId);
    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.set(SESSION_COOKIE, newSessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 8 * 60 * 60,
      path: "/",
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.redirect(new URL(`/selecionar-obra?error=${encodeURIComponent(message)}`, request.url));
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const workId = Number(id);
    if (!workId) return Response.json({ error: "Obra inválida." }, { status: 400 });

    const session = parseSession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!session) return Response.json({ error: "Sessão inválida." }, { status: 401 });

    await ensureDatabase();
    const db = getDb();

    const work = await db.select().from(works).where(eq(works.id, workId)).then((rows) => rows[0]);
    if (!work || !work.active) return Response.json({ error: "Obra não encontrada ou inativa." }, { status: 404 });

    if (!canAccessWork(session, workId)) {
      return Response.json({ error: "Sem permissão para acessar esta obra." }, { status: 403 });
    }

    const newSessionToken = withActiveWork(session, workId);
    const response = Response.json({ ok: true, activeWorkId: workId });
    const cookieValue = `${SESSION_COOKIE}=${newSessionToken}; HttpOnly; Path=/; Max-Age=${8 * 60 * 60}; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
    response.headers.set("Set-Cookie", cookieValue);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
