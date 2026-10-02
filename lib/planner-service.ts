import { and, asc, eq, ilike, inArray, max } from "drizzle-orm";
import type { getDb } from "../db";
import {
  auditLog,
  emailEvents,
  plannerCommitments,
  plannerPams,
  plannerSettings,
  rncResponseVersions,
  rncs,
} from "../db/schema";
import {
  DEFAULT_URGENCY_BANDS,
  computeSchedule,
  isIsoDate,
  isoInBrazil,
  sanitizeBands,
  type BaseType,
  type DeadlineUnit,
  type PlanItem,
  type UrgencyBands,
} from "./planner-calc";
import { extractCommitments } from "./planner-extract";
import { looksLikeFg06Name, parseFg06 } from "./planner-fg06";
import { pairSendings } from "./planner-pairing";
import { parsePamFormData } from "./response-types";

type Db = ReturnType<typeof getDb>;
export type PlannerCommitment = typeof plannerCommitments.$inferSelect;
export type PlannerPam = typeof plannerPams.$inferSelect;

export function todayIsoInBrazil() {
  return isoInBrazil(new Date());
}

function fmtBr(iso: string | null) {
  return iso ? iso.split("-").reverse().join("/") : "—";
}

async function writeAudit(db: Db, rncId: number, userName: string, field: string, oldValue: string | null, newValue: string) {
  await db.insert(auditLog).values({ rncId, userName, field, oldValue, newValue });
}

// Recalcula datas/estado de todos os compromissos de um PAM a partir da data de envio, marcos e conclusões.
export async function recalcPam(db: Db, plannerPamId: number) {
  const [pam] = await db.select().from(plannerPams).where(eq(plannerPams.id, plannerPamId)).limit(1);
  if (!pam) return;
  const rows = await db.select().from(plannerCommitments)
    .where(eq(plannerCommitments.plannerPamId, plannerPamId)).orderBy(asc(plannerCommitments.orderIndex), asc(plannerCommitments.id));
  const plan: PlanItem[] = rows.map((row) => ({
    key: row.id,
    quantity: row.quantity,
    unit: row.unit as DeadlineUnit,
    baseType: row.baseType as BaseType,
    fixedDate: row.fixedDate,
    predecessorKey: row.predecessorId,
    milestoneDate: row.milestoneDate,
    manualDue: row.adjustedDue,
    completedAt: row.completedAt,
  }));
  const results = computeSchedule(plan, pam.sentAt);
  for (const row of rows) {
    const result = results.get(row.id);
    if (!result) continue;
    const originalDue = row.originalDue ?? result.calculatedDue;
    const unchanged = row.baseDate === result.baseDate && row.calculatedDue === result.calculatedDue
      && row.currentDue === result.due && row.isProjected === result.projected && row.state === result.state
      && row.originalDue === originalDue;
    if (unchanged) continue;
    await db.update(plannerCommitments).set({
      baseDate: result.baseDate,
      calculatedDue: result.calculatedDue,
      originalDue,
      currentDue: result.due,
      isProjected: result.projected,
      state: result.state,
      updatedAt: new Date().toISOString(),
    }).where(eq(plannerCommitments.id, row.id));
  }
}

type Extracted = ReturnType<typeof extractCommitments>;

async function insertExtractedCommitments(
  db: Db,
  target: { rncId: number; plannerPamId: number; pamVersion: number; sentAt: string | null },
  extracted: Extracted,
) {
  const idByOrder = new Map<number, number>();
  for (const item of extracted) {
    // Data expressa anterior ao envio do PAM costuma ser erro de redação ou prazo já vencido: pede conferência.
    const beforeSending = item.fixedDate && target.sentAt && item.fixedDate < target.sentAt;
    const [row] = await db.insert(plannerCommitments).values({
      rncId: target.rncId,
      plannerPamId: target.plannerPamId,
      pamVersion: target.pamVersion,
      orderIndex: item.order,
      kind: item.kind,
      source: item.source,
      title: item.title,
      originalText: item.originalText,
      quantity: item.quantity,
      unit: item.unit,
      baseType: item.baseType,
      fixedDate: item.fixedDate,
      milestoneLabel: item.milestoneLabel,
      extracted: JSON.stringify({
        quantity: item.quantity, unit: item.unit, baseType: item.baseType, fixedDate: item.fixedDate,
        milestoneLabel: item.milestoneLabel, predecessorOrder: item.predecessorOrder, order: item.order,
      }),
      needsReview: item.needsReview || Boolean(beforeSending),
      reviewReason: item.reviewReason ?? (beforeSending ? "Data expressa anterior à data de envio do PAM; confirme se está correta." : null),
    }).returning({ id: plannerCommitments.id });
    idByOrder.set(item.order, row.id);
  }
  for (const item of extracted) {
    if (item.predecessorOrder === null) continue;
    await db.update(plannerCommitments).set({ predecessorId: idByOrder.get(item.predecessorOrder) ?? null })
      .where(eq(plannerCommitments.id, idByOrder.get(item.order)!));
  }
  await recalcPam(db, target.plannerPamId);
}

async function createPamFromVersion(db: Db, version: typeof rncResponseVersions.$inferSelect, sent?: { at: string; eventId: number }) {
  let snapshot: Record<string, unknown> = {};
  try { snapshot = JSON.parse(version.snapshot || "{}"); } catch { /* snapshot inválido: nenhum compromisso */ }
  const form = parsePamFormData(typeof snapshot.formData === "string" ? snapshot.formData : "{}");
  const referenceYear = Number(isoInBrazil(sent ? `${sent.at}T12:00:00-03:00` : version.createdAt).slice(0, 4));
  const extracted = extractCommitments({ proposal: form.improvementProposal, deadline: form.deadline, referenceYear });
  if (!extracted.length) return null;

  const [pam] = await db.insert(plannerPams).values({
    rncId: version.rncId,
    responseVersionId: version.id,
    pamVersion: version.version,
    sentAt: sent?.at ?? null,
    sentSource: sent ? "EMAIL" : null,
    sentEventId: sent?.eventId ?? null,
  }).returning();

  await insertExtractedCommitments(db, { rncId: version.rncId, plannerPamId: pam.id, pamVersion: version.version, sentAt: sent?.at ?? null }, extracted);
  await recalcPam(db, pam.id);
  return pam;
}

async function deletePam(db: Db, plannerPamId: number) {
  await db.delete(plannerCommitments).where(eq(plannerCommitments.plannerPamId, plannerPamId));
  await db.delete(plannerPams).where(eq(plannerPams.id, plannerPamId));
}

// Um PAM enviado substitui formalmente o anterior: os prazos antigos ficam no histórico como SUBSTITUÍDO.
async function supersedeOlderSentPams(db: Db, rncId: number) {
  const pams = await db.select().from(plannerPams).where(eq(plannerPams.rncId, rncId));
  const sent = pams.filter((pam) => pam.sentAt).sort((a, b) => (a.sentAt! < b.sentAt! ? -1 : a.sentAt! > b.sentAt! ? 1 : a.pamVersion - b.pamVersion));
  const older = sent.slice(0, -1).filter((pam) => pam.status !== "SUBSTITUIDO");
  for (const pam of older) {
    await db.update(plannerPams).set({ status: "SUBSTITUIDO", updatedAt: new Date().toISOString() }).where(eq(plannerPams.id, pam.id));
    await db.update(plannerCommitments).set({ status: "SUBSTITUIDO", updatedAt: new Date().toISOString() })
      .where(and(eq(plannerCommitments.plannerPamId, pam.id), eq(plannerCommitments.status, "PENDENTE")));
  }
}

function nameMentionsRnc(name: string, number: string, year: number) {
  const target = parseInt(number, 10);
  return [...name.matchAll(/(\d{2,4})[_\/\s-](\d{4})/g)].some(([, n, y]) => parseInt(n, 10) === target && parseInt(y, 10) === year);
}

// FG 06 preenchido e enviado por e-mail (ex.: PDF "FG 06 - PAM - RNC 317-2026"): vira o PAM da RNC,
// com a data do próprio e-mail de envio como data-base. Formulários em branco recebidos não entram (só e-mails enviados).
async function reconcileEmailPams(db: Db, rncId: number) {
  const [rnc] = await db.select({ number: rncs.number, year: rncs.year }).from(rncs).where(eq(rncs.id, rncId)).limit(1);
  if (!rnc) return 0;
  const events = await db.select().from(emailEvents)
    .where(and(eq(emailEvents.rncId, rncId), eq(emailEvents.eventType, "envio_resposta"))).orderBy(asc(emailEvents.occurredAt));
  const pams = await db.select().from(plannerPams).where(eq(plannerPams.rncId, rncId));
  const known = new Set(pams.filter((pam) => pam.emailEventId !== null).map((pam) => `${pam.emailEventId}|${pam.attachmentName}`));
  let created = 0;

  for (const event of events) {
    let attachments: Array<{ id?: string; name: string; extractedText?: string }> = [];
    try { attachments = JSON.parse(event.attachmentMetadata || "[]"); } catch { continue; }
    for (const attachment of attachments) {
      if (!looksLikeFg06Name(attachment.name) || !attachment.extractedText?.trim()) continue;
      if (known.has(`${event.id}|${attachment.name}`)) continue;
      const parsed = parseFg06(attachment.extractedText);
      const belongs = parsed.rncNumber
        ? parseInt(parsed.rncNumber, 10) === parseInt(rnc.number, 10) && parsed.rncYear === rnc.year
        : nameMentionsRnc(attachment.name, rnc.number, rnc.year);
      if (!belongs) continue;

      const sentAt = isoInBrazil(event.occurredAt);
      const extracted = extractCommitments({ proposal: parsed.proposal, deadline: parsed.deadline, referenceYear: Number(sentAt.slice(0, 4)) });
      if (!extracted.length) continue;
      const [current] = await db.select({ value: max(plannerPams.pamVersion) }).from(plannerPams).where(eq(plannerPams.rncId, rncId));
      const pamVersion = Number(current?.value || 0) + 1;
      let pam: PlannerPam;
      try {
        [pam] = await db.insert(plannerPams).values({
          rncId, responseVersionId: null, source: "EMAIL", pamVersion, sentAt, sentSource: "EMAIL", sentEventId: event.id,
          emailEventId: event.id, attachmentId: attachment.id ?? null, attachmentName: attachment.name, documentDate: parsed.documentDate,
        }).returning();
      } catch {
        continue; // outra requisição simultânea já registrou este anexo
      }
      await insertExtractedCommitments(db, { rncId, plannerPamId: pam.id, pamVersion, sentAt }, extracted);
      known.add(`${event.id}|${attachment.name}`);
      created += 1;
    }
  }
  return created;
}

// Liga cada PAM ao e-mail de envio real (nunca à data de gravação/importação) e analisa PAMs antigos.
export async function reconcileRnc(db: Db, rncId: number) {
  const versions = await db.select().from(rncResponseVersions).where(eq(rncResponseVersions.rncId, rncId))
    .orderBy(asc(rncResponseVersions.responseSequence), asc(rncResponseVersions.id));
  const pamVersions = versions.filter((version) => version.responseType === "PAM");
  const emailCreated = await reconcileEmailPams(db, rncId);
  if (!pamVersions.length) {
    await supersedeOlderSentPams(db, rncId);
    return { created: emailCreated };
  }

  let pams = await db.select().from(plannerPams).where(eq(plannerPams.rncId, rncId));
  const events = await db.select().from(emailEvents)
    .where(and(eq(emailEvents.rncId, rncId), eq(emailEvents.eventType, "envio_resposta"))).orderBy(asc(emailEvents.occurredAt));
  let created = emailCreated;

  for (const pairing of pairSendings({ versions, events, pams })) {
    const version = versions.find((item) => item.id === pairing.versionId)!;
    const existing = pams.find((pam) => pam.responseVersionId === pairing.versionId);
    if (existing) {
      await db.update(plannerPams).set({ sentAt: pairing.sentAt, sentSource: "EMAIL", sentEventId: pairing.eventId, updatedAt: new Date().toISOString() })
        .where(eq(plannerPams.id, existing.id));
      await recalcPam(db, existing.id);
    } else if (await createPamFromVersion(db, version, { at: pairing.sentAt, eventId: pairing.eventId })) {
      created += 1;
    }
    pams = await db.select().from(plannerPams).where(eq(plannerPams.rncId, rncId));
  }

  // Rascunhos de PAM nunca enviados: só o mais recente interessa (os demais foram substituídos ao salvar).
  const lastPam = pamVersions.at(-1)!;
  for (const pam of pams) {
    if (!pam.sentAt && pam.responseVersionId !== lastPam.id) await deletePam(db, pam.id);
  }
  pams = await db.select().from(plannerPams).where(eq(plannerPams.rncId, rncId));
  if (!pams.some((pam) => pam.responseVersionId === lastPam.id)) {
    if (await createPamFromVersion(db, lastPam)) created += 1;
  }

  await supersedeOlderSentPams(db, rncId);
  return { created };
}

// Chamado ao salvar uma versão de PAM: gera os compromissos (aguardando a data de envio, se ainda não houve).
export async function syncPamVersion(db: Db, rncId: number, versionId: number) {
  const [version] = await db.select().from(rncResponseVersions).where(eq(rncResponseVersions.id, versionId)).limit(1);
  if (!version || version.rncId !== rncId || version.responseType !== "PAM") return;
  // Antes de substituir rascunhos, garante que um envio já ocorrido seja atribuído ao PAM certo.
  await reconcileRnc(db, rncId);
}

export async function reconcileAll(db: Db, rncIds?: number[]) {
  const versions = await db.select({ rncId: rncResponseVersions.rncId }).from(rncResponseVersions)
    .where(eq(rncResponseVersions.responseType, "PAM"));
  const withAttachment = await db.selectDistinct({ rncId: emailEvents.rncId }).from(emailEvents)
    .where(and(eq(emailEvents.eventType, "envio_resposta"), ilike(emailEvents.attachmentMetadata, "%fg%06%")));
  const ids = [...new Set([...versions, ...withAttachment].map((row) => row.rncId))].filter((id) => !rncIds || rncIds.includes(id));
  let created = 0;
  for (const id of ids) created += (await reconcileRnc(db, id)).created;
  return { rncs: ids.length, created };
}

type Actor = { name: string; email: string };
const actorLabel = (actor: Actor) => `${actor.name} <${actor.email}>`;

async function loadCommitment(db: Db, id: number) {
  const [row] = await db.select().from(plannerCommitments).where(eq(plannerCommitments.id, id)).limit(1);
  return row;
}

export class PlannerError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function requireReason(reason: unknown) {
  const text = String(reason ?? "").trim();
  if (text.length < 3) throw new PlannerError("Informe o motivo da alteração.");
  return text.slice(0, 500);
}

function requireDate(value: unknown, label: string) {
  if (!isIsoDate(value)) throw new PlannerError(`${label} inválida.`);
  return value;
}

export async function completeCommitment(db: Db, id: number, actor: Actor, completedAt?: string) {
  const row = await loadCommitment(db, id);
  if (!row) throw new PlannerError("Compromisso não encontrado.", 404);
  const date = requireDate(completedAt || todayIsoInBrazil(), "Data de conclusão");
  await db.update(plannerCommitments).set({
    status: "CONCLUIDO", completedAt: date, completedBy: actorLabel(actor),
    completedRegisteredAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }).where(eq(plannerCommitments.id, id));
  await recalcPam(db, row.plannerPamId);
  await writeAudit(db, row.rncId, actor.name, "planner_conclusao", row.currentDue ? `previsto ${fmtBr(row.currentDue)}` : null, `${row.title}: concluído em ${fmtBr(date)}`);
  return row.rncId;
}

export async function reopenCommitment(db: Db, id: number, actor: Actor) {
  const row = await loadCommitment(db, id);
  if (!row) throw new PlannerError("Compromisso não encontrado.", 404);
  await db.update(plannerCommitments).set({
    status: "PENDENTE", completedAt: null, completedBy: null, completedRegisteredAt: null, updatedAt: new Date().toISOString(),
  }).where(eq(plannerCommitments.id, id));
  await recalcPam(db, row.plannerPamId);
  await writeAudit(db, row.rncId, actor.name, "planner_conclusao", `${row.title}: concluído em ${fmtBr(row.completedAt)}`, `${row.title}: reaberto`);
  return row.rncId;
}

export async function adjustCommitmentDue(db: Db, id: number, actor: Actor, input: { date?: unknown; reason?: unknown; clear?: boolean }) {
  const row = await loadCommitment(db, id);
  if (!row) throw new PlannerError("Compromisso não encontrado.", 404);
  const reason = requireReason(input.reason);
  const before = row.currentDue;
  if (input.clear) {
    await db.update(plannerCommitments).set({
      adjustedDue: null, manualAdjust: false, adjustReason: reason, adjustedBy: actorLabel(actor), adjustedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }).where(eq(plannerCommitments.id, id));
  } else {
    const date = requireDate(input.date, "Data");
    await db.update(plannerCommitments).set({
      adjustedDue: date, manualAdjust: true, adjustReason: reason, adjustedBy: actorLabel(actor), adjustedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }).where(eq(plannerCommitments.id, id));
  }
  await recalcPam(db, row.plannerPamId);
  const after = (await loadCommitment(db, id))!.currentDue;
  await writeAudit(db, row.rncId, actor.name, "planner_prazo", fmtBr(before),
    `${fmtBr(after)} · ${row.title} · ${input.clear ? "ajuste removido" : "ajustado"} por ${actor.name} · motivo: ${reason}`);
  return row.rncId;
}

export async function setCommitmentMilestone(db: Db, id: number, actor: Actor, input: { date?: unknown; reason?: unknown }) {
  const row = await loadCommitment(db, id);
  if (!row) throw new PlannerError("Compromisso não encontrado.", 404);
  if (row.baseType !== "EXTERNAL_MILESTONE") throw new PlannerError("Este compromisso não depende de um marco externo.");
  const date = requireDate(input.date, "Data do marco");
  await db.update(plannerCommitments).set({ milestoneDate: date, updatedAt: new Date().toISOString() }).where(eq(plannerCommitments.id, id));
  await recalcPam(db, row.plannerPamId);
  await writeAudit(db, row.rncId, actor.name, "planner_marco", row.milestoneDate ? fmtBr(row.milestoneDate) : null,
    `${fmtBr(date)} · ${row.title} · marco "${row.milestoneLabel || "informado no PAM"}" registrado por ${actor.name}`);
  return row.rncId;
}

function wouldCycle(rows: PlannerCommitment[], id: number, predecessorId: number) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  let cursor: number | null = predecessorId;
  const seen = new Set<number>();
  while (cursor !== null && !seen.has(cursor)) {
    if (cursor === id) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.predecessorId ?? null;
  }
  return false;
}

// Correção manual da interpretação (predecessora, prazo, unidade, data-base, ordem). O valor extraído fica em `extracted`.
export async function editCommitmentRule(db: Db, id: number, actor: Actor, input: {
  quantity?: unknown; unit?: unknown; baseType?: unknown; fixedDate?: unknown; predecessorId?: unknown; orderIndex?: unknown; title?: unknown; reason?: unknown;
}) {
  const row = await loadCommitment(db, id);
  if (!row) throw new PlannerError("Compromisso não encontrado.", 404);
  const reason = requireReason(input.reason);
  const siblings = await db.select().from(plannerCommitments).where(eq(plannerCommitments.plannerPamId, row.plannerPamId));

  const changes: Partial<typeof plannerCommitments.$inferInsert> = {};
  const notes: string[] = [];
  if (input.quantity !== undefined) {
    const quantity = input.quantity === null || input.quantity === "" ? null : Number(input.quantity);
    if (quantity !== null && (!Number.isInteger(quantity) || quantity < 0 || quantity > 3650)) throw new PlannerError("Quantidade do prazo inválida.");
    changes.quantity = quantity; notes.push(`prazo ${row.quantity ?? "—"} → ${quantity ?? "—"}`);
  }
  if (input.unit !== undefined) {
    if (input.unit !== "CORRIDOS" && input.unit !== "UTEIS") throw new PlannerError("Unidade inválida.");
    changes.unit = input.unit; notes.push(`unidade ${row.unit === "UTEIS" ? "dias úteis" : "dias corridos"} → ${input.unit === "UTEIS" ? "dias úteis" : "dias corridos"}`);
  }
  if (input.title !== undefined) {
    const title = String(input.title).trim().slice(0, 200);
    if (!title) throw new PlannerError("O título não pode ficar vazio.");
    changes.title = title; notes.push("título");
  }
  if (input.orderIndex !== undefined) {
    const order = Number(input.orderIndex);
    if (!Number.isInteger(order) || order < 1 || order > 999) throw new PlannerError("Ordem inválida.");
    changes.orderIndex = order; notes.push(`ordem ${row.orderIndex} → ${order}`);
  }
  const baseType = (input.baseType ?? row.baseType) as BaseType;
  if (input.baseType !== undefined) {
    if (!["PAM_SENT_DATE", "FIXED_DATE", "PREDECESSOR_COMPLETION", "EXTERNAL_MILESTONE"].includes(String(input.baseType))) throw new PlannerError("Data-base inválida.");
    changes.baseType = baseType; notes.push(`data-base ${row.baseType} → ${baseType}`);
  }
  if (baseType === "FIXED_DATE") {
    const fixed = input.fixedDate !== undefined ? requireDate(input.fixedDate, "Data") : row.fixedDate;
    if (!fixed) throw new PlannerError("Informe a data.");
    changes.fixedDate = fixed; if (input.fixedDate !== undefined) notes.push(`data ${fmtBr(row.fixedDate)} → ${fmtBr(fixed)}`);
  }
  if (baseType === "PREDECESSOR_COMPLETION") {
    const raw = input.predecessorId !== undefined ? input.predecessorId : row.predecessorId;
    const predecessorId = raw === null || raw === "" ? null : Number(raw);
    if (predecessorId === null || !siblings.some((sibling) => sibling.id === predecessorId) || predecessorId === id) {
      throw new PlannerError("Escolha uma atividade predecessora válida deste PAM.");
    }
    if (wouldCycle(siblings, id, predecessorId)) throw new PlannerError("A dependência criaria um ciclo entre atividades.");
    if (predecessorId !== row.predecessorId) notes.push(`predecessora ${row.predecessorId ?? "—"} → ${predecessorId}`);
    changes.predecessorId = predecessorId;
  } else if (input.baseType !== undefined) {
    changes.predecessorId = null;
  }
  if (!notes.length && !Object.keys(changes).length) throw new PlannerError("Nenhuma alteração informada.");

  await db.update(plannerCommitments).set({ ...changes, needsReview: false, reviewReason: null, updatedAt: new Date().toISOString() })
    .where(eq(plannerCommitments.id, id));
  await recalcPam(db, row.plannerPamId);
  await writeAudit(db, row.rncId, actor.name, "planner_dependencia", row.title,
    `${row.title}: ${notes.join("; ") || "regra revisada"} · por ${actor.name} · motivo: ${reason}`);
  return row.rncId;
}

export async function setPamSentDate(db: Db, plannerPamId: number, actor: Actor, input: { date?: unknown; reason?: unknown }) {
  const [pam] = await db.select().from(plannerPams).where(eq(plannerPams.id, plannerPamId)).limit(1);
  if (!pam) throw new PlannerError("PAM não encontrado no Planner.", 404);
  const reason = requireReason(input.reason);
  const date = requireDate(input.date, "Data de envio");
  await db.update(plannerPams).set({
    sentAt: date, sentSource: "MANUAL", sentEventId: null, sentAdjustedBy: actorLabel(actor), sentAdjustReason: reason, updatedAt: new Date().toISOString(),
  }).where(eq(plannerPams.id, plannerPamId));
  await recalcPam(db, plannerPamId);
  await supersedeOlderSentPams(db, pam.rncId);
  await writeAudit(db, pam.rncId, actor.name, "planner_envio", pam.sentAt ? fmtBr(pam.sentAt) : "pendente",
    `${fmtBr(date)} · PAM V${pam.pamVersion} · data de envio informada por ${actor.name} · motivo: ${reason}`);
  return pam.rncId;
}

export async function confirmPam(db: Db, plannerPamId: number, actor: Actor) {
  const [pam] = await db.select().from(plannerPams).where(eq(plannerPams.id, plannerPamId)).limit(1);
  if (!pam) throw new PlannerError("PAM não encontrado no Planner.", 404);
  await db.update(plannerPams).set({ confirmedAt: new Date().toISOString(), confirmedBy: actorLabel(actor), updatedAt: new Date().toISOString() })
    .where(eq(plannerPams.id, plannerPamId));
  await db.update(plannerCommitments).set({ needsReview: false, updatedAt: new Date().toISOString() }).where(eq(plannerCommitments.plannerPamId, plannerPamId));
  await writeAudit(db, pam.rncId, actor.name, "planner_confirmacao", null, `Interpretação dos prazos do PAM V${pam.pamVersion} confirmada por ${actor.name}`);
  return pam.rncId;
}

const BANDS_KEY = "urgency_bands";

export async function getBands(db: Db): Promise<UrgencyBands> {
  const [row] = await db.select().from(plannerSettings).where(eq(plannerSettings.key, BANDS_KEY)).limit(1);
  if (!row) return { ...DEFAULT_URGENCY_BANDS };
  try { return sanitizeBands(JSON.parse(row.value)); } catch { return { ...DEFAULT_URGENCY_BANDS }; }
}

export async function setBands(db: Db, value: unknown) {
  const bands = sanitizeBands(value);
  await db.insert(plannerSettings).values({ key: BANDS_KEY, value: JSON.stringify(bands) })
    .onConflictDoUpdate({ target: plannerSettings.key, set: { value: JSON.stringify(bands), updatedAt: new Date().toISOString() } });
  return bands;
}

export async function pamsForRncs(db: Db, rncIds: number[]) {
  if (!rncIds.length) return [] as PlannerPam[];
  return db.select().from(plannerPams).where(inArray(plannerPams.rncId, rncIds));
}
