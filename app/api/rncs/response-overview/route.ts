import { eq, isNotNull, notInArray } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../../db";
import { rncResponseDrafts, rncs, works } from "../../../../db/schema";
import { accessControlEnabled, canAccessType, canAccessWork, sessionFromRequest, unauthorized } from "../../../../lib/access-control";

export async function GET(request: Request) {
  try {
    const session = sessionFromRequest(request);
    if (!session) return unauthorized();
    await ensureDatabase();
    const db = getDb();

    const rows = await db.select({
      id: rncs.id,
      workId: rncs.workId,
      workName: works.name,
      number: rncs.number,
      year: rncs.year,
      description: rncs.description,
      type: rncs.type,
      dueAt: rncs.dueAt,
      sentAt: rncs.sentAt,
      status: rncs.status,
      responseOwner: rncs.responseOwner,
      updatedAt: rncs.updatedAt,
      hasDraft: isNotNull(rncResponseDrafts.id),
    })
      .from(rncs)
      .innerJoin(works, eq(rncs.workId, works.id))
      .leftJoin(rncResponseDrafts, eq(rncResponseDrafts.rncId, rncs.id))
      .where(notInArray(rncs.status, ["Aprovada", "Reprovada"]));

    const scoped = rows.filter(
      (rnc) => canAccessType(session, rnc.type)
        && (session.activeWorkId === null || rnc.workId === session.activeWorkId)
        && canAccessWork(session, rnc.workId),
    );

    return Response.json({
      rncs: scoped,
      user: accessControlEnabled() ? session : null,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao carregar dados." }, { status: 500 });
  }
}
