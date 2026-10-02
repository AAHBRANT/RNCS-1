import { desc, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../../../db";
import {
  auditLog,
  emailEvents,
  rncConflicts,
  rncResponseDocuments,
  rncResponseVersions,
  rncs,
} from "../../../../../db/schema";
import { canAccessType, forbidden, sessionFromRequest, unauthorized } from "../../../../../lib/access-control";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = sessionFromRequest(request);
  if (!session) return unauthorized();
  const { id } = await context.params;
  const rncId = Number(id);
  if (!rncId) return Response.json({ error: "RNC inválida." }, { status: 400 });
  await ensureDatabase();
  const db = getDb();
  const [rnc] = await db.select({ type: rncs.type }).from(rncs).where(eq(rncs.id, rncId)).limit(1);
  if (!rnc) return Response.json({ error: "RNC não encontrada." }, { status: 404 });
  if (!canAccessType(session, rnc.type)) return forbidden("Esta RNC pertence a uma disciplina não autorizada para você.");
  const [changes, emails, conflicts, responses, documents] = await Promise.all([
    db.select().from(auditLog).where(eq(auditLog.rncId, rncId)).orderBy(desc(auditLog.changedAt)),
    db.select().from(emailEvents).where(eq(emailEvents.rncId, rncId)).orderBy(desc(emailEvents.occurredAt)),
    db.select().from(rncConflicts).where(eq(rncConflicts.rncId, rncId)).orderBy(desc(rncConflicts.createdAt)),
    db.select({
      id: rncResponseVersions.id,
      responseType: rncResponseVersions.responseType,
      responseSequence: rncResponseVersions.responseSequence,
      version: rncResponseVersions.version,
      createdBy: rncResponseVersions.createdBy,
      createdAt: rncResponseVersions.createdAt,
    }).from(rncResponseVersions).where(eq(rncResponseVersions.rncId, rncId))
      .orderBy(desc(rncResponseVersions.responseSequence), desc(rncResponseVersions.id)),
    db.select({
      id: rncResponseDocuments.id,
      responseType: rncResponseDocuments.responseType,
      version: rncResponseDocuments.version,
      fileName: rncResponseDocuments.fileName,
      size: rncResponseDocuments.size,
      uploadedBy: rncResponseDocuments.uploadedBy,
      createdAt: rncResponseDocuments.createdAt,
    }).from(rncResponseDocuments).where(eq(rncResponseDocuments.rncId, rncId))
      .orderBy(desc(rncResponseDocuments.createdAt)),
  ]);
  return Response.json({ changes, emails, conflicts, responses, documents });
}
