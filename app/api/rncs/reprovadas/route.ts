import { and, desc, eq, inArray } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../../db";
import { emailEvents, rncComments, rncGroupMembers, rncGroups, rncs, works } from "../../../../db/schema";
import { accessControlEnabled, sessionFromRequest, unauthorized } from "../../../../lib/access-control";
import { canSeeRnc } from "../../../../lib/planner-api";
import { rejectionReason, type ReasonEvent } from "../../../../lib/rnc-reprovadas";

export async function GET(request: Request) {
  try {
    const session = sessionFromRequest(request);
    if (!session) return unauthorized();
    await ensureDatabase();
    const db = getDb();
    const rows = (await db.select({
      id: rncs.id, workId: rncs.workId, workName: works.name, number: rncs.number, year: rncs.year,
      description: rncs.description, type: rncs.type, status: rncs.status, receivedAt: rncs.receivedAt, returnedAt: rncs.returnedAt,
    }).from(rncs).innerJoin(works, eq(rncs.workId, works.id)).orderBy(desc(rncs.year), desc(rncs.number)))
      .filter((rnc) => rnc.status.startsWith("Reprovada") && canSeeRnc(session, rnc));

    const ids = rows.map((rnc) => rnc.id);
    const events = ids.length
      ? await db.select({ id: emailEvents.id, rncId: emailEvents.rncId, occurredAt: emailEvents.occurredAt, summary: emailEvents.summary, attachmentMetadata: emailEvents.attachmentMetadata })
        .from(emailEvents).where(and(inArray(emailEvents.rncId, ids), eq(emailEvents.eventType, "retorno_supervisao")))
      : [];
    const comments = ids.length ? await db.select().from(rncComments).where(inArray(rncComments.rncId, ids)) : [];
    const members = ids.length ? await db.select().from(rncGroupMembers).where(inArray(rncGroupMembers.rncId, ids)) : [];
    const groups = await db.select({ id: rncGroups.id, name: rncGroups.name }).from(rncGroups);
    const groupByRnc = new Map(members.map((member) => [member.rncId, member.groupId]));
    const eventsByRnc = new Map<number, ReasonEvent[]>();
    for (const event of events) eventsByRnc.set(event.rncId, [...(eventsByRnc.get(event.rncId) ?? []), event]);
    const commentByRnc = new Map(comments.map((comment) => [comment.rncId, comment]));

    return Response.json({
      rncs: rows.map((rnc) => {
        const comment = commentByRnc.get(rnc.id);
        return {
          ...rnc,
          reason: rejectionReason(rnc, eventsByRnc.get(rnc.id) ?? []),
          groupId: groupByRnc.get(rnc.id) ?? null,
          comment: comment?.comment ?? "",
          commentBy: comment?.updatedBy ?? "",
          commentAt: comment?.updatedAt ?? null,
        };
      }),
      groups: groups.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
      user: accessControlEnabled() ? session : null,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao carregar RNCs reprovadas." }, { status: 500 });
  }
}
