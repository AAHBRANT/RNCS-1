import { eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../../../db";
import { rncComments, rncs } from "../../../../../db/schema";
import { forbidden, sessionFromRequest, unauthorized } from "../../../../../lib/access-control";
import { canSeeRnc } from "../../../../../lib/planner-api";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = sessionFromRequest(request);
    if (!session) return unauthorized();
    const id = Number((await context.params).id);
    const body = await request.json() as { comment?: unknown };
    const comment = String(body.comment ?? "").slice(0, 5000);
    if (!id) return Response.json({ error: "RNC inválida." }, { status: 400 });
    await ensureDatabase();
    const db = getDb();
    const [rnc] = await db.select({ type: rncs.type, workId: rncs.workId }).from(rncs).where(eq(rncs.id, id)).limit(1);
    if (!rnc) return Response.json({ error: "RNC não encontrada." }, { status: 404 });
    if (!canSeeRnc(session, rnc)) return forbidden("Você não tem permissão para comentar nesta RNC.");
    const updatedAt = new Date().toISOString();
    await db.insert(rncComments).values({ rncId: id, comment, updatedBy: session.name, updatedAt })
      .onConflictDoUpdate({ target: rncComments.rncId, set: { comment, updatedBy: session.name, updatedAt } });
    return Response.json({ comment, commentBy: session.name, commentAt: updatedAt });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao salvar comentário." }, { status: 500 });
  }
}
