import { and, desc, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../db";
import { auditLog, rncs, works } from "../../../db/schema";
import { accessControlEnabled, canAccessType, canAccessWork, canEditRnc, forbidden, sessionFromRequest, unauthorized } from "../../../lib/access-control";
import { enforceRateLimit } from "../../../lib/rate-limit";

const editableFields = [
  "workId", "number", "year", "description", "type", "receivedAt", "dueAt",
  "sentAt", "returnedAt", "status", "notes",
] as const;

function addBusinessDays(dateValue: string, days = 5) {
  const date = new Date(`${dateValue}T12:00:00`);
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() !== 0 && date.getDay() !== 6) added += 1;
  }
  return date.toISOString().slice(0, 10);
}

async function ensureWorks() {
  await ensureDatabase();
}

export async function GET(request: Request) {
  try {
    const session = sessionFromRequest(request);
    if (!session) return unauthorized();
    await ensureWorks();
    const db = getDb();
    const [workRows, rncRows] = await Promise.all([
      db.select().from(works).where(eq(works.active, true)).orderBy(works.name),
      db.select({
        id: rncs.id,
        workId: rncs.workId,
        workName: works.name,
        number: rncs.number,
        year: rncs.year,
        description: rncs.description,
        type: rncs.type,
        receivedAt: rncs.receivedAt,
        dueAt: rncs.dueAt,
        sentAt: rncs.sentAt,
        returnedAt: rncs.returnedAt,
        inspectionDate: rncs.inspectionDate,
        status: rncs.status,
        notes: rncs.notes,
        responseOwner: rncs.responseOwner,
        inspectionOwner: rncs.inspectionOwner,
        contract: rncs.contract,
        analysisOwner: rncs.analysisOwner,
        fieldSources: rncs.fieldSources,
        fieldConfidence: rncs.fieldConfidence,
        manualFields: rncs.manualFields,
        sourceSummary: rncs.sourceSummary,
        updatedAt: rncs.updatedAt,
      }).from(rncs).innerJoin(works, eq(rncs.workId, works.id)).orderBy(desc(rncs.year), desc(rncs.id)),
    ]);
    return Response.json({
      works: workRows,
      rncs: rncRows.filter(
        (rnc) => canAccessType(session, rnc.type) && (session.activeWorkId === null || rnc.workId === session.activeWorkId) && canAccessWork(session, rnc.workId),
      ),
      user: accessControlEnabled() ? session : null,
      activeWorkId: session.activeWorkId,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao carregar dados." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = sessionFromRequest(request);
    if (!session) return unauthorized();
    if (!canEditRnc(session)) return forbidden("Somente a administradora pode cadastrar RNCs manualmente.");
    const limited = await enforceRateLimit(request, {
      scope: "rnc-write",
      limit: 30,
      windowSeconds: 300,
      identity: session.email,
    });
    if (limited) return limited;
    const body = await request.json() as Record<string, unknown>;
    const receivedAt = body.receivedAt ? String(body.receivedAt) : null;
    const number = String(body.number ?? "").trim().padStart(3, "0");
    if (!body.workId || !number || !body.year) {
      return Response.json({ error: "Obra, número e ano são obrigatórios." }, { status: 400 });
    }
    const workId = Number(body.workId);
    if (!canAccessWork(session, workId)) {
      return forbidden("Você não tem permissão para criar RNCs nesta obra.");
    }
    const outlookAudit = body.source === "outlook-browser-audit";
    const db = getDb();
    const [created] = await db.insert(rncs).values({
      workId,
      number,
      year: Number(body.year),
      description: String(body.description || "Descrição não identificada"),
      type: String(body.type || "A classificar"),
      receivedAt,
      dueAt: receivedAt ? addBusinessDays(receivedAt) : null,
      status: String(body.status || "Recebida"),
      notes: String(body.notes || ""),
      responseOwner: String(body.responseOwner || ""),
      inspectionOwner: String(body.inspectionOwner || ""),
      contract: String(body.contract || ""),
      analysisOwner: String(body.analysisOwner || ""),
      sentAt: body.sentAt ? String(body.sentAt) : null,
      returnedAt: body.returnedAt ? String(body.returnedAt) : null,
      fieldSources: JSON.stringify(outlookAudit ? {
        workId: "Identificado no e-mail recebido",
        number: "Identificado no e-mail",
        year: "Identificado no e-mail",
        description: body.description ? "Identificado no nome do anexo" : "Não identificado",
        type: body.type && body.type !== "A classificar" ? "Identificado no nome do anexo" : "Não identificado",
        receivedAt: receivedAt ? "Identificado no e-mail recebido" : "Não identificado",
        sentAt: body.sentAt ? "Identificado nos Itens Enviados" : "Não identificado",
        returnedAt: body.returnedAt ? "Identificado no e-mail de análise" : "Não identificado",
        status: body.returnedAt ? "Identificado no e-mail de análise" : body.sentAt ? "Identificado nos Itens Enviados" : "Identificado no e-mail recebido",
        responseOwner: "Não identificado",
      } : {
        workId: "Preenchido manualmente", number: "Preenchido manualmente", year: "Preenchido manualmente",
        description: "Preenchido manualmente", type: "Preenchido manualmente",
        receivedAt: "Preenchido manualmente", sentAt: body.sentAt ? "Preenchido manualmente" : undefined,
        returnedAt: body.returnedAt ? "Preenchido manualmente" : undefined,
        status: "Preenchido manualmente", notes: "Preenchido manualmente",
        responseOwner: "Não identificado — preenchimento automático pelo PDF",
      }),
      fieldConfidence: JSON.stringify({}),
      manualFields: JSON.stringify(outlookAudit ? [] : ["workId", "description", "type", "notes"]),
      sourceSummary: outlookAudit ? "Importado após conferência das comunicações oficiais no Outlook." : "",
    }).returning();
    await db.insert(auditLog).values({
      rncId: created.id,
      field: "registro",
      newValue: outlookAudit ? "RNC importada da comunicação oficial no Outlook" : "RNC criada manualmente",
      userName: session.name,
    });
    return Response.json({ rnc: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao cadastrar RNC.";
    const duplicate = message.includes("UNIQUE");
    return Response.json({ error: duplicate ? "Já existe uma RNC com esta obra, número e ano." : message }, { status: duplicate ? 409 : 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = sessionFromRequest(request);
    if (!session) return unauthorized();
    if (!canEditRnc(session)) return forbidden("Somente a administradora pode editar os dados cadastrais da RNC.");
    const limited = await enforceRateLimit(request, {
      scope: "rnc-write",
      limit: 30,
      windowSeconds: 300,
      identity: session.email,
    });
    if (limited) return limited;
    const body = await request.json() as Record<string, unknown>;
    const id = Number(body.id);
    if (!id) return Response.json({ error: "RNC inválida." }, { status: 400 });
    const db = getDb();
    const [current] = await db.select().from(rncs).where(eq(rncs.id, id)).limit(1);
    if (!current) return Response.json({ error: "RNC não encontrada." }, { status: 404 });
    if (!canAccessWork(session, current.workId)) {
      return forbidden("Você não tem permissão para editar RNCs nesta obra.");
    }
    if (body.workId && Number(body.workId) !== current.workId && !canAccessWork(session, Number(body.workId))) {
      return forbidden("Você não tem permissão para mover RNCs para esta obra.");
    }

    const changes: Record<string, string | number | null> = {};
    const auditRows: Array<typeof auditLog.$inferInsert> = [];
    const manualFields = new Set<string>(JSON.parse(current.manualFields || "[]"));
    const fieldSources = JSON.parse(current.fieldSources || "{}") as Record<string, string>;
    const fieldConfidence = JSON.parse(current.fieldConfidence || "{}") as Record<string, { score: number; reason: string }>;
    const outlookAudit = body.source === "outlook-browser-audit";
    for (const field of editableFields) {
      if (!(field in body)) continue;
      let next: string | number | null = body[field] === "" ? null : body[field] as string | number | null;
      if (field === "year" || field === "workId") next = Number(next);
      if (field === "number") next = String(next).padStart(3, "0");
      const previous = current[field];
      if (String(previous ?? "") !== String(next ?? "")) {
        changes[field] = next;
        if (!outlookAudit) manualFields.add(field);
        fieldSources[field] = outlookAudit
          ? field === "sentAt"
            ? "Identificado nos Itens Enviados"
            : field === "returnedAt"
              ? "Identificado no e-mail de análise"
              : field === "receivedAt"
                ? "Identificado no e-mail recebido"
                : field === "description" || field === "type"
                  ? "Identificado no nome do anexo"
                  : "Identificado no e-mail"
          : "Preenchido manualmente";
        if (!outlookAudit) {
          fieldConfidence[field] = { score: 5, reason: "Valor confirmado manualmente pelo usuário." };
        }
        auditRows.push({ rncId: id, field, oldValue: String(previous ?? ""), newValue: String(next ?? ""), userName: session.name });
      }
    }
    if ("receivedAt" in changes && changes.receivedAt) changes.dueAt = addBusinessDays(String(changes.receivedAt));
    if (!Object.keys(changes).length) return Response.json({ rnc: current });
    changes.manualFields = JSON.stringify([...manualFields]);
    changes.fieldSources = JSON.stringify(fieldSources);
    changes.fieldConfidence = JSON.stringify(fieldConfidence);
    changes.updatedAt = new Date().toISOString();
    const [updated] = await db.update(rncs).set(changes).where(and(eq(rncs.id, id))).returning();
    if (auditRows.length) await db.insert(auditLog).values(auditRows);
    return Response.json({ rnc: updated });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao atualizar RNC." }, { status: 500 });
  }
}
