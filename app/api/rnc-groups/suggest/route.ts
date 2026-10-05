import { inArray } from "drizzle-orm";
import { rncGroupMembers, rncGroups } from "../../../../db/schema";
import { groupsContext, scopedReprovadas } from "../../../../lib/rnc-groups-api";
import { suggestSubject } from "../../../../lib/rnc-grouping";

// Agrupa por assunto as RNCs reprovadas que ainda estão sem grupo. Não mexe em RNCs já agrupadas.
export async function POST(request: Request) {
  try {
    const context = await groupsContext(request);
    if ("error" in context) return context.error;
    const { db, session } = context;
    const reprovadas = await scopedReprovadas(db, session);
    const already = reprovadas.length ? await db.select().from(rncGroupMembers).where(inArray(rncGroupMembers.rncId, reprovadas.map((rnc) => rnc.id))) : [];
    const grouped = new Set(already.map((member) => member.rncId));

    const groups = await db.select().from(rncGroups);
    const byName = new Map(groups.map((group) => [group.name.toLowerCase(), group.id]));
    let assigned = 0;
    let created = 0;
    for (const rnc of reprovadas) {
      if (grouped.has(rnc.id)) continue;
      const subject = suggestSubject(rnc.description);
      if (!subject) continue;
      let groupId = byName.get(subject.toLowerCase());
      if (!groupId) {
        const [group] = await db.insert(rncGroups).values({ name: subject, createdBy: session.name, updatedBy: session.name }).returning();
        groupId = group.id;
        byName.set(subject.toLowerCase(), groupId);
        created += 1;
      }
      await db.insert(rncGroupMembers).values({ rncId: rnc.id, groupId }).onConflictDoNothing();
      assigned += 1;
    }
    return Response.json({ assigned, created, left: reprovadas.length - grouped.size - assigned });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao sugerir o agrupamento." }, { status: 500 });
  }
}
