import { and, desc, eq, max } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../../../../db";
import { rncResponseDocuments, rncs } from "../../../../../../db/schema";
import {
  canAccessType,
  forbidden,
  sessionFromRequest,
  unauthorized,
} from "../../../../../../lib/access-control";
import { enforceRateLimit } from "../../../../../../lib/rate-limit";
import { normalizeResponseType } from "../../../../../../lib/response-types";

const MAX_DOCUMENT_SIZE = 3 * 1024 * 1024;
const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function authorizedRnc(request: Request, id: string) {
  const session = sessionFromRequest(request);
  if (!session) return { error: unauthorized() };
  const rncId = Number(id);
  if (!rncId) return { error: Response.json({ error: "RNC inválida." }, { status: 400 }) };
  await ensureDatabase();
  const db = getDb();
  const [rnc] = await db.select({ id: rncs.id, type: rncs.type })
    .from(rncs).where(eq(rncs.id, rncId)).limit(1);
  if (!rnc) return { error: Response.json({ error: "RNC não encontrada." }, { status: 404 }) };
  if (!canAccessType(session, rnc.type)) {
    return { error: forbidden("Esta RNC pertence a uma disciplina não autorizada para você.") };
  }
  return { db, rncId, session };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await authorizedRnc(request, id);
  if ("error" in access) return access.error;

  const requestedId = Number(new URL(request.url).searchParams.get("document"));
  if (requestedId) {
    const limited = await enforceRateLimit(request, {
      scope: "word-download",
      limit: 60,
      windowSeconds: 300,
      identity: access.session.email,
    });
    if (limited) return limited;
    const [document] = await access.db.select().from(rncResponseDocuments)
      .where(and(eq(rncResponseDocuments.id, requestedId), eq(rncResponseDocuments.rncId, access.rncId)))
      .limit(1);
    if (!document) return Response.json({ error: "Documento não encontrado." }, { status: 404 });
    const bytes = Buffer.from(document.contentBase64, "base64");
    return new Response(bytes, {
      headers: {
        "content-type": document.contentType,
        "content-length": String(bytes.length),
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
        "cache-control": "private, no-store",
      },
    });
  }

  // `type=ALL` lista todos os tipos (dossiê/histórico); sem parâmetro, mantém o padrão TRATATIVA.
  const typeParam = new URL(request.url).searchParams.get("type");
  const listAll = typeParam?.toUpperCase() === "ALL";
  const responseType = normalizeResponseType(typeParam);
  const documents = await access.db.select({
    id: rncResponseDocuments.id,
    responseType: rncResponseDocuments.responseType,
    version: rncResponseDocuments.version,
    fileName: rncResponseDocuments.fileName,
    contentType: rncResponseDocuments.contentType,
    size: rncResponseDocuments.size,
    uploadedBy: rncResponseDocuments.uploadedBy,
    createdAt: rncResponseDocuments.createdAt,
  }).from(rncResponseDocuments)
    .where(listAll
      ? eq(rncResponseDocuments.rncId, access.rncId)
      : and(eq(rncResponseDocuments.rncId, access.rncId), eq(rncResponseDocuments.responseType, responseType)))
    .orderBy(desc(rncResponseDocuments.createdAt), desc(rncResponseDocuments.id));
  return Response.json({ documents });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await authorizedRnc(request, id);
  if ("error" in access) return access.error;
  const limited = await enforceRateLimit(request, {
    scope: "word-upload",
    limit: 12,
    windowSeconds: 600,
    identity: access.session.email,
  });
  if (limited) return limited;

  const form = await request.formData();
  const file = form.get("document");
  if (!(file instanceof File)) {
    return Response.json({ error: "Selecione um documento Word." }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".docx")) {
    return Response.json({ error: "O arquivo deve estar no formato .docx." }, { status: 400 });
  }
  if (!file.size || file.size > MAX_DOCUMENT_SIZE) {
    return Response.json({ error: "O documento deve ter no máximo 3 MB." }, { status: 413 });
  }
  const content = Buffer.from(await file.arrayBuffer());
  // A DOCX is a ZIP package and must begin with the ZIP signature.
  if (content[0] !== 0x50 || content[1] !== 0x4b) {
    return Response.json({ error: "O arquivo selecionado não é um documento Word válido." }, { status: 400 });
  }

  const responseType = normalizeResponseType(form.get("responseType"));
  const [currentVersion] = await access.db.select({ value: max(rncResponseDocuments.version) })
    .from(rncResponseDocuments)
    .where(and(eq(rncResponseDocuments.rncId, access.rncId), eq(rncResponseDocuments.responseType, responseType)));
  const version = Number(currentVersion?.value || 0) + 1;
  const [document] = await access.db.insert(rncResponseDocuments).values({
    rncId: access.rncId,
    responseType,
    version,
    fileName: file.name,
    contentType: DOCX_CONTENT_TYPE,
    size: file.size,
    contentBase64: content.toString("base64"),
    uploadedBy: `${access.session.name} <${access.session.email}>`,
  }).returning({
    id: rncResponseDocuments.id,
    version: rncResponseDocuments.version,
    fileName: rncResponseDocuments.fileName,
    size: rncResponseDocuments.size,
    uploadedBy: rncResponseDocuments.uploadedBy,
    createdAt: rncResponseDocuments.createdAt,
  });
  return Response.json({ document }, { status: 201 });
}
