import { eq, inArray } from "drizzle-orm";
import { rncGroupMembers, rncGroups } from "../../../../db/schema";
import { groupsContext, scopedReprovadas } from "../../../../lib/rnc-groups-api";

// Move RNCs para um grupo (groupId) ou tira de qualquer grupo (groupId = null).
export async function PUT(request: Request) {
  try {
    const context = await groupsContext(request);
    if ("error" in context) return context.error;
    const { db, session } = context;
    const body = await request.json() as { rncIds?: unknown; groupId?: unknown };
    const allowed = new Set((await scopedReprovadas(db, session)).map((rnc) => rnc.id));
    const rncIds = [...new Set((Array.isArray(body.rncIds) ? body.rncIds : []).map(Number))].filter((id) => allowed.has(id));
    if (!rncIds.length) return Response.json({ error: "Nenhuma RNC válida selecionada." }, { status: 400 });

    if (body.groupId === null || body.groupId === undefined || body.groupId === "") {
      await db.delete(rncGroupMembers).where(inArray(rncGroupMembers.rncId, rncIds));
      return Response.json({ moved: rncIds.length });
    }
    const groupId = Number(body.groupId);
    const [group] = await db.select({ id: rncGroups.id }).from(rncGroups).where(eq(rncGroups.id, groupId)).limit(1);
    if (!group) return Response.json({ error: "Grupo não encontrado." }, { status: 404 });
    for (const rncId of rncIds) {
      await db.insert(rncGroupMembers).values({ rncId, groupId }).onConflictDoUpdate({ target: rncGroupMembers.rncId, set: { groupId } });
    }
    return Response.json({ moved: rncIds.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao agrupar as RNCs." }, { status: 500 });
  }
}
