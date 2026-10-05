import { inArray } from "drizzle-orm";
import { rncGroupMembers, rncGroups } from "../../../db/schema";
import { accessControlEnabled } from "../../../lib/access-control";
import { cleanGroupName, groupsContext, scopedReprovadas, type GroupRnc } from "../../../lib/rnc-groups-api";

// Dados do relatório de grupos: cada grupo com suas RNCs reprovadas, mais as RNCs ainda sem grupo.
export async function GET(request: Request) {
  try {
    const context = await groupsContext(request);
    if ("error" in context) return context.error;
    const { db, session } = context;
    const reprovadas = await scopedReprovadas(db, session);
    const byId = new Map(reprovadas.map((rnc) => [rnc.id, rnc]));
    const groups = await db.select().from(rncGroups);
    const members = reprovadas.length ? await db.select().from(rncGroupMembers).where(inArray(rncGroupMembers.rncId, reprovadas.map((rnc) => rnc.id))) : [];

    const membersByGroup = new Map<number, GroupRnc[]>();
    const grouped = new Set<number>();
    for (const member of members) {
      const rnc = byId.get(member.rncId);
      if (!rnc) continue;
      grouped.add(rnc.id);
      membersByGroup.set(member.groupId, [...(membersByGroup.get(member.groupId) ?? []), rnc]);
    }
    const result = groups.map((group) => ({
      id: group.id, name: group.name, comment: group.comment, updatedBy: group.updatedBy, updatedAt: group.updatedAt,
      rncs: (membersByGroup.get(group.id) ?? []).sort((a, b) => (a.year - b.year) || a.number.localeCompare(b.number)),
    })).sort((a, b) => b.rncs.length - a.rncs.length || a.name.localeCompare(b.name, "pt-BR"));

    return Response.json({
      groups: result,
      ungrouped: reprovadas.filter((rnc) => !grouped.has(rnc.id)).sort((a, b) => (a.year - b.year) || a.number.localeCompare(b.number)),
      totalReprovadas: reprovadas.length,
      user: accessControlEnabled() ? session : null,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao carregar os grupos." }, { status: 500 });
  }
}

// Cria um grupo (opcionalmente já com RNCs dentro).
export async function POST(request: Request) {
  try {
    const context = await groupsContext(request);
    if ("error" in context) return context.error;
    const { db, session } = context;
    const body = await request.json() as { name?: unknown; rncIds?: unknown };
    const name = cleanGroupName(body.name);
    if (!name) return Response.json({ error: "Informe o nome do grupo." }, { status: 400 });
    const existing = await db.select({ name: rncGroups.name }).from(rncGroups);
    if (existing.some((group) => group.name.toLowerCase() === name.toLowerCase())) {
      return Response.json({ error: "Já existe um grupo com esse nome." }, { status: 409 });
    }
    const [group] = await db.insert(rncGroups).values({ name, createdBy: session.name, updatedBy: session.name }).returning();
    const allowed = new Set((await scopedReprovadas(db, session)).map((rnc) => rnc.id));
    const rncIds = (Array.isArray(body.rncIds) ? body.rncIds : []).map(Number).filter((id) => allowed.has(id));
    for (const rncId of rncIds) {
      await db.insert(rncGroupMembers).values({ rncId, groupId: group.id })
        .onConflictDoUpdate({ target: rncGroupMembers.rncId, set: { groupId: group.id } });
    }
    return Response.json({ id: group.id, name: group.name, moved: rncIds.length }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao criar o grupo." }, { status: 500 });
  }
}
