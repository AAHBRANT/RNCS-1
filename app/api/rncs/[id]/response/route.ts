import { and, desc, eq, max } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../../../db";
import {
  emailEvents,
  rncResponseDocuments,
  rncResponseDrafts,
  rncResponseVersions,
  rncs,
  works,
} from "../../../../../db/schema";
import {
  canAccessType,
  canSaveResponseStatus,
  accessControlEnabled,
  forbidden,
  sessionFromRequest,
  unauthorized,
} from "../../../../../lib/access-control";
import { enforceRateLimit } from "../../../../../lib/rate-limit";
import { normalizeResponseType, sanitizePamFormData } from "../../../../../lib/response-types";

const textFields = [
  "directive",
  "analysis",
  "actionsTaken",
  "technicalResponse",
  "evidence",
  "conclusion",
  "agentResponse",
  "emailBody",
  "locationFront",
  "contract",
  "observations",
  "photoLegend1",
  "photoLegend2",
  "photoLegend3",
  "photoLegend4",
  "internalComment",
] as const;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = sessionFromRequest(request);
  if (!session) return unauthorized();
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
    inspectionOwner: rncs.inspectionOwner,
    contract: rncs.contract,
    analysisOwner: rncs.analysisOwner,
  }).from(rncs).innerJoin(works, eq(rncs.workId, works.id)).where(eq(rncs.id, rncId)).limit(1);
  if (!rnc) return Response.json({ error: "RNC não encontrada." }, { status: 404 });
  if (!canAccessType(session, rnc.type)) return forbidden("Esta RNC pertence a uma disciplina não autorizada para você.");

  const responseType = normalizeResponseType(new URL(request.url).searchParams.get("type"));
  const [allDrafts, allVersions, emails] = await Promise.all([
    db.select().from(rncResponseDrafts).where(eq(rncResponseDrafts.rncId, rncId)),
    db.select().from(rncResponseVersions)
      .where(eq(rncResponseVersions.rncId, rncId))
      .orderBy(desc(rncResponseVersions.responseSequence), desc(rncResponseVersions.id)),
    db.select().from(emailEvents)
      .where(eq(emailEvents.rncId, rncId))
      .orderBy(desc(emailEvents.occurredAt)),
  ]);
  // `versions` e `draft` seguem o tipo pedido (padrão TRATATIVA, igual ao comportamento anterior);
  // `drafts` e `allVersions` expõem todos os tipos para o histórico completo da RNC.
  const draft = allDrafts.find((item) => item.responseType === responseType) || null;
  const versions = allVersions
    .filter((item) => item.responseType === responseType)
    .sort((a, b) => b.version - a.version);
  const drafts = allDrafts.map((item) => ({
    responseType: item.responseType,
    status: item.status,
    updatedBy: item.updatedBy,
    updatedAt: item.updatedAt,
  }));
  return Response.json({
    rnc, responseType, draft, drafts, versions, allVersions, emails,
    user: accessControlEnabled() ? session : null,
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = sessionFromRequest(request);
  if (!session) return unauthorized();
  const { id } = await context.params;
  const rncId = Number(id);
  if (!rncId) return Response.json({ error: "RNC inválida." }, { status: 400 });

  const body = await request.json() as Record<string, unknown>;
  await ensureDatabase();
  const db = getDb();
  const [rnc] = await db.select({ id: rncs.id, status: rncs.status, type: rncs.type })
    .from(rncs).where(and(eq(rncs.id, rncId))).limit(1);
  if (!rnc) return Response.json({ error: "RNC não encontrada." }, { status: 404 });
  if (!canAccessType(session, rnc.type)) return forbidden("Esta RNC pertence a uma disciplina não autorizada para você.");
  if (rnc.status === "Aprovada") {
    return Response.json({ error: "RNC aprovada não permite nova elaboração." }, { status: 409 });
  }
  const limited = await enforceRateLimit(request, {
    scope: "response-save",
    limit: 30,
    windowSeconds: 300,
    identity: session.email,
  });
  if (limited) return limited;

  const values = Object.fromEntries(textFields.map((field) => [field, String(body[field] || "")]));
  const selectedAttachments = Array.isArray(body.selectedAttachments)
    ? body.selectedAttachments.map(String)
    : [];
  const status = ["Rascunho", "Em revisão", "Documento aprovado"].includes(String(body.status))
    ? String(body.status)
    : "Rascunho";
  if (!canSaveResponseStatus(session, status)) {
    return forbidden(
      status === "Documento aprovado"
        ? "Somente revisores/aprovadores podem aprovar o documento."
        : "Seu perfil não pode realizar esta transição.",
    );
  }
  const responseType = normalizeResponseType(body.responseType);
  if (status === "Documento aprovado") {
    const [latestDocument] = await db.select({ id: rncResponseDocuments.id })
      .from(rncResponseDocuments)
      .where(and(
        eq(rncResponseDocuments.rncId, rncId),
        eq(rncResponseDocuments.responseType, responseType),
      ))
      .orderBy(desc(rncResponseDocuments.version))
      .limit(1);
    if (!latestDocument) {
      return Response.json(
        { error: "Anexe o documento Word final antes de aprová-lo." },
        { status: 409 },
      );
    }
  }
  const now = new Date().toISOString();
  const formData = responseType === "PAM" ? JSON.stringify(sanitizePamFormData(body.formData)) : "{}";
  const draftValues = {
    rncId,
    responseType,
    ...values,
    formData,
    selectedAttachments: JSON.stringify(selectedAttachments),
    status,
    updatedBy: `${session.name} <${session.email}>`,
    updatedAt: now,
  };
  const [draft] = await db.insert(rncResponseDrafts).values(draftValues)
    .onConflictDoUpdate({
      target: [rncResponseDrafts.rncId, rncResponseDrafts.responseType],
      set: draftValues,
    }).returning();

  // Versão numerada dentro do tipo (Tratativa V1, V2 / PAM V1, V2); a sequência é global na RNC.
  const [currentVersion] = await db.select({ value: max(rncResponseVersions.version) })
    .from(rncResponseVersions)
    .where(and(eq(rncResponseVersions.rncId, rncId), eq(rncResponseVersions.responseType, responseType)));
  const [currentSequence] = await db.select({ value: max(rncResponseVersions.responseSequence) })
    .from(rncResponseVersions).where(eq(rncResponseVersions.rncId, rncId));
  const version = Number(currentVersion?.value || 0) + 1;
  const responseSequence = Number(currentSequence?.value || 0) + 1;
  await db.insert(rncResponseVersions).values({
    rncId,
    responseType,
    responseSequence,
    version,
    snapshot: JSON.stringify({ ...draftValues, savedAt: now }),
    createdBy: `${session.name} <${session.email}>`,
  });
  return Response.json({ draft, version, responseType, responseSequence });
}
