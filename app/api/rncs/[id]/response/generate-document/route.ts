import { eq, max } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../../../../db";
import { rncResponseDocuments, rncs, works } from "../../../../../../db/schema";
import {
  canAccessType,
  forbidden,
  sessionFromRequest,
  unauthorized,
} from "../../../../../../lib/access-control";
import { fillRncTemplate } from "../../../../../../lib/docx-template";
import { enforceRateLimit } from "../../../../../../lib/rate-limit";

const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_PHOTO_SIZE = 800 * 1024;
const MAX_DOCUMENT_SIZE = 4 * 1024 * 1024;

function formatDate(value?: string | null) {
  if (!value) return "";
  const date = value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(date);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
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
    description: rncs.description,
    type: rncs.type,
    receivedAt: rncs.receivedAt,
    responseOwner: rncs.responseOwner,
    inspectionOwner: rncs.inspectionOwner,
    contract: rncs.contract,
    workName: works.name,
  }).from(rncs).innerJoin(works, eq(rncs.workId, works.id))
    .where(eq(rncs.id, rncId)).limit(1);
  if (!rnc) return Response.json({ error: "RNC não encontrada." }, { status: 404 });
  if (!canAccessType(session, rnc.type)) {
    return forbidden("Esta RNC pertence a uma disciplina não autorizada para você.");
  }
  const limited = await enforceRateLimit(request, {
    scope: "generate-word",
    limit: 8,
    windowSeconds: 600,
    identity: session.email,
  });
  if (limited) return limited;

  const form = await request.formData();
  let draft: Record<string, string>;
  try {
    draft = JSON.parse(String(form.get("draft") || "{}")) as Record<string, string>;
  } catch {
    return Response.json({ error: "Os dados da tratativa são inválidos." }, { status: 400 });
  }

  const photos: Array<{ buffer: Buffer; contentType: "image/png" | "image/jpeg" } | null> = [];
  for (let number = 1; number <= 4; number++) {
    const item = form.get(`photo${number}`);
    if (!(item instanceof File) || !item.size) { photos.push(null); continue; }
    if (!["image/png", "image/jpeg"].includes(item.type)) {
      return Response.json({ error: `A foto ${number} deve estar em PNG ou JPEG.` }, { status: 400 });
    }
    if (item.size > MAX_PHOTO_SIZE) {
      return Response.json({ error: `A foto ${number} deve ter no máximo 800 KB.` }, { status: 413 });
    }
    photos.push({
      buffer: Buffer.from(await item.arrayBuffer()),
      contentType: item.type as "image/png" | "image/jpeg",
    });
  }

  const replacements = {
    "[NÚMERO_RNC]": `${rnc.number}/${rnc.year}`,
    "[DATA_EMISSÃO]": formatDate(rnc.receivedAt),
    "[DATA_HOJE]": new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date()),
    "[LOCAL/ FRENTE]": rnc.workName,
    "[CONTRATO]": rnc.contract || "Não identificado",
    "[RESPONSÁVEL PELA ÁREA]": rnc.responseOwner || "Não identificado",
    "[DESCRIÇÃO_OCORRÊNCIA]": String(draft.analysis || ""),
    "[MEDIDAS_CORRETIVAS]": String(draft.actionsTaken || ""),
    "[OBSERVAÇÕES]": String(draft.observations || ""),
    "[LEGENDA1]": String(draft.photoLegend1 || ""),
    "[LEGENDA2]": String(draft.photoLegend2 || ""),
    "[LEGENDA3]": String(draft.photoLegend3 || ""),
    "[LEGENDA4]": String(draft.photoLegend4 || ""),
  };
  const documentBuffer = await fillRncTemplate(replacements, photos);
  if (documentBuffer.length > MAX_DOCUMENT_SIZE) {
    return Response.json(
      { error: "O Word gerado ultrapassou 4 MB. Reduza o tamanho das fotografias." },
      { status: 413 },
    );
  }

  const [currentVersion] = await db.select({ value: max(rncResponseDocuments.version) })
    .from(rncResponseDocuments).where(eq(rncResponseDocuments.rncId, rncId));
  const version = Number(currentVersion?.value || 0) + 1;
  const fileName = `Tratativa_RNC_${rnc.number}_${rnc.year}.docx`;
  const [document] = await db.insert(rncResponseDocuments).values({
    rncId,
    version,
    fileName,
    contentType: DOCX_CONTENT_TYPE,
    size: documentBuffer.length,
    contentBase64: documentBuffer.toString("base64"),
    uploadedBy: `${session.name} <${session.email}>`,
  }).returning({ id: rncResponseDocuments.id });

  return new Response(documentBuffer, {
    headers: {
      "content-type": DOCX_CONTENT_TYPE,
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "private, no-store",
      "x-document-id": String(document.id),
      "x-document-version": String(version),
    },
  });
}
