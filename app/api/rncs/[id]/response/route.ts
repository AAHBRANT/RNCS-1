import { and, desc, eq, max } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../../../db";
import {
  emailEvents,
  rncResponseDrafts,
  rncResponseVersions,
  rncs,
  works,
} from "../../../../../db/schema";

const textFields = [
  "directive",
  "analysis",
  "actionsTaken",
  "technicalResponse",
  "evidence",
  "conclusion",
  "agentResponse",
  "emailBody",
] as const;

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const rncId = Number(id);
  if (!rncId) return Response.json({ error: "RNC inválida." }, { status: 400 });

  await ensureDatabase();
  const db = getDb();
  const [rnc] = await db.select({
    id: rncs.id,
    number: rncs.number,
    year: rncs.year,
    workName: works.name,
    description: rncs.description,
    type: rncs.type,
    receivedAt: rncs.receivedAt,
    dueAt: rncs.dueAt,
    sentAt: rncs.sentAt,
    returnedAt: rncs.returnedAt,
    status: rncs.status,
    responseOwner: rncs.responseOwner,
    analysisOwner: rncs.analysisOwner,
  }).from(rncs).innerJoin(works, eq(rncs.workId, works.id)).where(eq(rncs.id, rncId)).limit(1);
  if (!rnc) return Response.json({ error: "RNC não encontrada." }, { status: 404 });

  const [draftRows, versions, emails] = await Promise.all([
    db.select().from(rncResponseDrafts).where(eq(rncResponseDrafts.rncId, rncId)).limit(1),
    db.select().from(rncResponseVersions)
      .where(eq(rncResponseVersions.rncId, rncId))
      .orderBy(desc(rncResponseVersions.version)),
    db.select().from(emailEvents)
      .where(eq(emailEvents.rncId, rncId))
      .orderBy(desc(emailEvents.occurredAt)),
  ]);
  return Response.json({ rnc, draft: draftRows[0] || null, versions, emails });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const rncId = Number(id);
  if (!rncId) return Response.json({ error: "RNC inválida." }, { status: 400 });

  const body = await request.json() as Record<string, unknown>;
  await ensureDatabase();
  const db = getDb();
  const [rnc] = await db.select({ id: rncs.id, status: rncs.status })
    .from(rncs).where(and(eq(rncs.id, rncId))).limit(1);
  if (!rnc) return Response.json({ error: "RNC não encontrada." }, { status: 404 });
  if (rnc.status === "Aprovada") {
    return Response.json({ error: "RNC aprovada não permite nova elaboração." }, { status: 409 });
  }

  const values = Object.fromEntries(textFields.map((field) => [field, String(body[field] || "")]));
  const selectedAttachments = Array.isArray(body.selectedAttachments)
    ? body.selectedAttachments.map(String)
    : [];
  const status = ["Rascunho", "Em revisão", "Documento aprovado"].includes(String(body.status))
    ? String(body.status)
    : "Rascunho";
  const now = new Date().toISOString();
  const draftValues = {
    rncId,
    ...values,
    selectedAttachments: JSON.stringify(selectedAttachments),
    status,
    updatedAt: now,
  };
  const [draft] = await db.insert(rncResponseDrafts).values(draftValues)
    .onConflictDoUpdate({
      target: rncResponseDrafts.rncId,
      set: draftValues,
    }).returning();

  const [currentVersion] = await db.select({ value: max(rncResponseVersions.version) })
    .from(rncResponseVersions).where(eq(rncResponseVersions.rncId, rncId));
  const version = Number(currentVersion?.value || 0) + 1;
  await db.insert(rncResponseVersions).values({
    rncId,
    version,
    snapshot: JSON.stringify({ ...draftValues, savedAt: now }),
  });
  return Response.json({ draft, version });
}
