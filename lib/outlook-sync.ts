import { and, eq, ne } from "drizzle-orm";
import { ensureDatabase, getDb } from "../db";
import {
  auditLog, emailEvents, outlookConnections, outlookSyncFolders, rncConflicts, rncs, syncRuns, works,
} from "../db/schema";
import { encryptToken, refreshAccessToken } from "./outlook-auth";
import { processRncAttachment } from "./pdf/process-rnc-attachment";
import type { ProcessRncAttachmentResult } from "./pdf/types";
import { analysisStatusFromEmailBody } from "./rnc-analysis";

type FolderKind = "inbox" | "sent";
type GraphFolder = { id: string; displayName: string; childFolderCount?: number };
type GraphAddress = { emailAddress?: { address?: string } };
type GraphAttachment = {
  id: string; name?: string; contentType?: string; size?: number; isInline?: boolean;
  contentBytes?: string; "@odata.type"?: string;
};
type GraphMessage = {
  id: string; internetMessageId?: string; conversationId?: string; subject?: string;
  parentFolderId?: string;
  bodyPreview?: string; body?: { content?: string; contentType?: string };
  receivedDateTime?: string; sentDateTime?: string; sender?: GraphAddress; from?: GraphAddress;
  toRecipients?: GraphAddress[]; ccRecipients?: GraphAddress[]; hasAttachments?: boolean;
  internetMessageHeaders?: Array<{ name?: string; value?: string }>;
  "@removed"?: unknown;
};
type GraphPage<T> = { value: T[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
type Identity = { number: string; year: number };
type AttachmentInfo = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  extractedText?: string;
  pdfProcessing?: ProcessRncAttachmentResult;
};
type Confidence = { score: number; reason: string };
type SyncStats = {
  messagesAnalyzed: number; newRncs: number; updatedRncs: number; ownersIdentified: number;
  sentDatesCorrected: number; returnsProcessed: number; statusesUpdated: number; eventsImported: number;
};

const OFFICIAL_EMAIL = "contato@jampasustentavel.com";
const ONLY_WORK = "Parque Socioambiental do Roger – Fase II";
const protectedStatuses = new Set(["Aprovada", "Reprovada", "Retorno recebido — status a confirmar"]);

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function stripHtml(value: string) {
  return value.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ").trim();
}

function address(value?: string) {
  return normalize(value || "").trim();
}

function extractIdentities(subject: string, attachmentNames: string[], body: string) {
  const found = new Map<string, Identity>();
  const add = (number: string, year: string) => {
    const parsedYear = Number(year.length === 2 ? `20${year}` : year);
    const identity = { number: number.padStart(3, "0"), year: parsedYear };
    found.set(`${identity.number}/${identity.year}`, identity);
  };
  const strongSources = [subject, ...attachmentNames];
  for (const source of strongSources) {
    for (const match of source.matchAll(/\b(\d{1,6})\s*[\/_-]\s*(20\d{2}|\d{2})\b/g)) add(match[1], match[2]);
  }
  for (const match of `${subject}\n${body}`.matchAll(/\bRNCs?\s*(?:N[º°o.]?\s*)?[-–—:#]?\s*(\d{1,6})\s*[\/-]\s*(20\d{2}|\d{2})\b/gi)) {
    add(match[1], match[2]);
  }
  return [...found.values()];
}

function identityIsStrong(identity: Identity, subject: string, attachmentNames: string[]) {
  const key = `${Number(identity.number)}\\s*[\\/_-]\\s*${identity.year}`;
  const matcher = new RegExp(key, "i");
  return matcher.test(subject) || attachmentNames.some((name) => matcher.test(name));
}

function newMessageBody(body: string) {
  const replyMarkers = [
    /\bDe:\s+/i,
    /\bFrom:\s+/i,
    /\bEnviad[ao]\s+em:\s+/i,
    /\bSent:\s+/i,
    /-{2,}\s*Mensagem original\s*-{2,}/i,
    /-{2,}\s*Original Message\s*-{2,}/i,
  ];
  let end = body.length;
  for (const marker of replyMarkers) {
    const index = body.search(marker);
    if (index >= 0) end = Math.min(end, index);
  }
  return body.slice(0, end).trim();
}

export function explicitSentIdentities(subject: string, body: string, attachmentNames: string[]) {
  const currentBody = newMessageBody(body);
  const identities = extractIdentities("", attachmentNames, currentBody);
  const years = [...new Set(
    [...subject.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1])),
  )];
  const inferredYear = years.length === 1 ? years[0] : null;
  if (inferredYear) {
    for (const match of currentBody.matchAll(
      /\b(?:somente|apenas|exclusivamente)?\s*(?:a\s+)?(?:RNCs?\s*(?:N[º°o.]?\s*)?)?(\d{1,5})\b/gi,
    )) {
      if (Number(match[1]) === inferredYear) continue;
      const nearby = currentBody.slice(Math.max(0, match.index! - 35), match.index! + match[0].length + 20);
      if (!/\b(?:RNCs?|somente|apenas|exclusivamente)\b/i.test(nearby)) continue;
      identities.push({ number: match[1].padStart(3, "0"), year: inferredYear });
    }
  }
  return [...new Map(identities.map((identity) => [`${identity.number}/${identity.year}`, identity])).values()];
}

function classifyType(text: string) {
  const source = normalize(text);
  if (/dds|trabalho em altura|andaime|banheiro quimico|seguranca|acidente|epi|risco/.test(source)) return "Segurança do Trabalho";
  if (/ambient|residuo|poluic|licenca|betoneira|lata de tinta/.test(source)) return "Ambiental";
  if (/oxidacao|fissura|adensamento|concretagem|qualidade|inspecao|ensaio/.test(source)) return "Qualidade";
  if (/projeto|desenho|detalh/.test(source)) return "Projeto";
  if (/sistema eletrico|execucao|servico|obra/.test(source)) return "Execução";
  if (/document|registro|procedimento/.test(source)) return "Documental";
  return "A classificar";
}

function descriptionFromAttachment(identity: Identity, names: string[]) {
  const marker = new RegExp(`(?:RNC\\s*)?0*${Number(identity.number)}[\\/_-]${identity.year}\\s*[-–—_]\\s*`, "i");
  const name = names.find((item) => marker.test(item));
  if (!name) return "";
  return name.replace(/^.*?(?:RNC\s*)?0*\d+[\/_-]\d{4}\s*[-–—_]\s*/i, "")
    .replace(/_?(?:PARQUE|PONTE|COMPL\.?).*$/i, "").replace(/\.[^.]+$/, "").replaceAll("_", " ").trim();
}

function dateOnly(value?: string) {
  return (value || new Date().toISOString()).slice(0, 10);
}

export function addBusinessDays(value: string, days = 5) {
  const date = new Date(`${value}T12:00:00Z`);
  let added = 0;
  while (added < days) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) added++;
  }
  return date.toISOString().slice(0, 10);
}

async function graph<T>(accessToken: string, url: string): Promise<T> {
  const response = await fetch(url.startsWith("http") ? url : `https://graph.microsoft.com/v1.0${url}`, {
    headers: { authorization: `Bearer ${accessToken}`, Prefer: "odata.maxpagesize=100" },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Microsoft Graph respondeu ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response.json() as Promise<T>;
}

async function allPages<T>(accessToken: string, initialUrl: string) {
  const values: T[] = [];
  let url: string | undefined = initialUrl;
  while (url) {
    const page: GraphPage<T> = await graph(accessToken, url);
    values.push(...page.value);
    url = page["@odata.nextLink"];
  }
  return values;
}

async function childFolders(accessToken: string, parentId: string, path: string): Promise<Array<GraphFolder & { path: string }>> {
  const direct = await allPages<GraphFolder>(accessToken,
    `/me/mailFolders/${encodeURIComponent(parentId)}/childFolders?$select=id,displayName,childFolderCount&$top=100`);
  const result: Array<GraphFolder & { path: string }> = [];
  for (const folder of direct) {
    const folderPath = `${path}/${folder.displayName}`;
    result.push({ ...folder, path: folderPath });
    if (folder.childFolderCount) result.push(...await childFolders(accessToken, folder.id, folderPath));
  }
  return result;
}

async function discoverFolders(accessToken: string) {
  const [inbox, sent, topLevel] = await Promise.all([
    graph<GraphFolder>(accessToken, "/me/mailFolders/inbox?$select=id,displayName,childFolderCount"),
    graph<GraphFolder>(accessToken, "/me/mailFolders/sentitems?$select=id,displayName,childFolderCount"),
    allPages<GraphFolder>(accessToken, "/me/mailFolders?$select=id,displayName,childFolderCount&includeHiddenFolders=true&$top=100"),
  ]);
  const candidates: Array<GraphFolder & { path: string; kind: FolderKind }> = [
    { ...inbox, path: inbox.displayName, kind: "inbox" },
    ...(await childFolders(accessToken, inbox.id, inbox.displayName)).map((folder) => ({ ...folder, kind: "inbox" as const })),
    { ...sent, path: sent.displayName, kind: "sent" },
  ];
  for (const folder of topLevel.filter((item) => normalize(item.displayName) === "jampa sustentavel")) {
    candidates.push({ ...folder, path: folder.displayName, kind: "inbox" });
    candidates.push(...(await childFolders(accessToken, folder.id, folder.displayName)).map((child) => ({ ...child, kind: "inbox" as const })));
  }
  return [...new Map(candidates.map((folder) => [folder.id, folder])).values()];
}

async function extractAttachmentText(attachment: GraphAttachment) {
  if (!attachment.contentBytes || !attachment.name) return "";
  const buffer = Buffer.from(attachment.contentBytes, "base64");
  try {
    if (/\.docx$/i.test(attachment.name)) {
      const mammoth = await import("mammoth");
      return (await mammoth.extractRawText({ buffer })).value.slice(0, 30_000);
    }
    if (/\.txt$/i.test(attachment.name)) return buffer.toString("utf8").slice(0, 30_000);
  } catch {
    return "";
  }
  return "";
}

async function attachmentsForMessage(accessToken: string, message: GraphMessage) {
  if (!message.hasAttachments) return [] as AttachmentInfo[];
  const listed = await allPages<GraphAttachment>(accessToken,
    `/me/messages/${encodeURIComponent(message.id)}/attachments?$select=id,name,contentType,size,isInline&$top=100`);
  const result: AttachmentInfo[] = [];
  for (const attachment of listed.filter((item) => !item.isInline)) {
    const info: AttachmentInfo = {
      id: attachment.id, name: attachment.name || "Anexo sem nome",
      contentType: attachment.contentType || "application/octet-stream", size: attachment.size || 0,
    };
    const isPdf = /\.pdf$/i.test(info.name);
    const safeToProcess = isPdf ? info.size <= 1_500_000 : info.size <= 12_000_000;
    if (isPdf && !safeToProcess) {
      info.pdfProcessing = {
        success: false,
        needsOcr: false,
        fileName: info.name,
        pageCount: 0,
        information: null,
        error: "PDF acima de 1,5 MB — mantido no histórico sem leitura automática para preservar a sincronização.",
      };
    } else if (safeToProcess && /\.(pdf|docx|txt)$/i.test(info.name)) {
      const detail = await graph<GraphAttachment>(accessToken,
        `/me/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachment.id)}`);
      if (isPdf && detail.contentBytes) {
        info.pdfProcessing = await processRncAttachment({
          fileName: info.name,
          contentType: info.contentType,
          contentBuffer: Buffer.from(detail.contentBytes, "base64"),
        });
        info.extractedText = info.pdfProcessing.information?.extractedText.slice(0, 30_000) || "";
      } else {
        info.extractedText = await extractAttachmentText(detail);
      }
    }
    result.push(info);
  }
  return result;
}

function extractOwners(text: string) {
  const values = new Set<string>();
  for (const pattern of [
    /respons[aá]vel\s+da\s+[áa]rea\s+inspecionada\s*[:\-]?\s*([^\n\r;|]{3,100})/gi,
  ]) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1].replace(/\s{2,}/g, " ").trim().replace(/[.,:;-]+$/, "");
      if (
        value.length <= 100
        && !/^(data|assinatura|empresa|cargo|fun[cç][aã]o|n[aã]o identificado)/i.test(value)
      ) values.add(value);
    }
  }
  return [...values];
}

function extractAnalysisReviewers(text: string) {
  const values = new Set<string>();
  for (const match of text.matchAll(
    /revisor\s+da\s+elabora[cç][aã]o\s+(?:do\s+rnc|da\s+an[aá]lise\s+da\s+tratativa)\s*[:\-]?\s*([^\n\r;|]{3,100})/gi,
  )) {
    const value = match[1].replace(/\s{2,}/g, " ").trim().replace(/[.,:;-]+$/, "");
    if (
      value.length <= 100
      && !/^(data|assinatura|empresa|cargo|fun[cç][aã]o|n[aã]o identificado)/i.test(value)
    ) values.add(value);
  }
  return [...values];
}

function analysisStatus(documentText: string): { status: string; confidence: Confidence } {
  if (!documentText.trim()) {
    return {
      status: "Retorno recebido — status a confirmar",
      confidence: { score: 1, reason: "Documento de análise sem texto extraível; necessita conferência." },
    };
  }
  const text = documentText;
  const source = normalize(text);
  if (/nao aprovada|reprovada|nao atendida|tratativa nao aceita|necessita correcao|revisar|reenviar|pendencia permanece/.test(source)) {
    return { status: "Reprovada", confidence: { score: 5, reason: "Resultado identificado no documento anexo da análise." } };
  }
  if (/tratativa aprovada|considerada atendida|sem pendencias|aprovada|atendida|sanada|encerrada/.test(source)) {
    return { status: "Aprovada", confidence: { score: 5, reason: "Resultado identificado no documento anexo da análise." } };
  }
  return {
    status: "Retorno recebido — status a confirmar",
    confidence: { score: 2, reason: "Documento analisado, mas sem resultado inequívoco." },
  };
}

function confidenceScore(value: "HIGH" | "MEDIUM" | "LOW") {
  return value === "HIGH" ? 5 : value === "MEDIUM" ? 3 : 1;
}

function pdfInformationForIdentity(attachments: AttachmentInfo[], identity: Identity) {
  const conflicts: string[] = [];
  const matching = attachments.flatMap((attachment) => {
    const information = attachment.pdfProcessing?.information;
    if (!information) return [];
    if (information.rncNumber && information.rncNumber !== identity.number) {
      conflicts.push(`${attachment.name}: RNC ${information.rncNumber}${information.year ? `/${information.year}` : ""}`);
      return [];
    }
    if (information.year && information.year !== identity.year) {
      conflicts.push(`${attachment.name}: RNC ${information.rncNumber || "?"}/${information.year}`);
      return [];
    }
    return [information];
  });
  return { matching, conflicts };
}

function attachmentAuditMetadata(attachments: AttachmentInfo[]) {
  return attachments.map((attachment) => {
    const processing = attachment.pdfProcessing;
    return {
      id: attachment.id,
      name: attachment.name,
      contentType: attachment.contentType,
      size: attachment.size,
      extractionMethod: processing?.information?.extractionMethod
        || (processing?.needsOcr ? "NONE" : attachment.extractedText ? "DOCUMENT_TEXT" : "NONE"),
      extractedText: attachment.extractedText || "",
      pageCount: processing?.pageCount || 0,
      needsOcr: processing?.needsOcr || false,
      processingError: processing?.error || null,
      identifiedRncNumber: processing?.information?.rncNumber || null,
      identifiedYear: processing?.information?.year || null,
      identifiedResponsible: processing?.information?.responsible || null,
      identifiedAnalysisReviewer: processing?.information?.analysisReviewer || null,
      identifiedStatus: processing?.information?.analysisStatus || null,
      matchedStatusText: processing?.information?.matchedStatusText || null,
      confidence: processing?.information?.confidence || null,
      processedAt: new Date().toISOString(),
    };
  });
}

function parsedJson<T>(value: string | null | undefined, fallback: T): T {
  try { return JSON.parse(value || "") as T; } catch { return fallback; }
}

function canAutoUpdate(rnc: typeof rncs.$inferSelect, field: string) {
  return !parsedJson<string[]>(rnc.manualFields, []).includes(field);
}

async function recordConflict(rncId: number, field: string, values: string[]) {
  const unique = [...new Set(values.filter(Boolean))];
  if (unique.length < 2) return;
  await getDb().insert(rncConflicts).values({ rncId, field, candidateValues: JSON.stringify(unique) });
}

function emptyStats(): SyncStats {
  return {
    messagesAnalyzed: 0, newRncs: 0, updatedRncs: 0, ownersIdentified: 0,
    sentDatesCorrected: 0, returnsProcessed: 0, statusesUpdated: 0, eventsImported: 0,
  };
}

function addStats(total: SyncStats, next: SyncStats) {
  for (const key of Object.keys(total) as Array<keyof SyncStats>) total[key] += next[key];
  return total;
}

async function processMessage(
  accessToken: string, message: GraphMessage, folder: GraphFolder & { path: string }, kind: FolderKind,
  target?: Identity, reprocess = false,
) {
  const stats = emptyStats();
  if (message["@removed"] || !message.id) return stats;
  const sender = address(message.sender?.emailAddress?.address || message.from?.emailAddress?.address);
  const recipientsList = [...(message.toRecipients || []), ...(message.ccRecipients || [])]
    .map((item) => address(item.emailAddress?.address)).filter(Boolean);
  const officialIncoming = kind === "inbox" && sender === OFFICIAL_EMAIL;
  const officialSent = kind === "sent" && recipientsList.includes(OFFICIAL_EMAIL);
  if (!officialIncoming && !officialSent) return stats;
  stats.messagesAnalyzed = 1;

  const attachments = await attachmentsForMessage(accessToken, message);
  const subject = message.subject || "";
  const body = stripHtml(message.body?.content || message.bodyPreview || "");
  const attachmentNames = attachments.map((item) => item.name);
  const documentText = attachments.map((item) => item.extractedText || "").join("\n");
  const combined = `${subject}\n${body}\n${attachmentNames.join("\n")}\n${documentText}`;
  const workName = ONLY_WORK;
  let identities = extractIdentities(subject, attachmentNames, body);
  let explicitSentTargets: Identity[] = [];
  if (officialSent) {
    const explicit = explicitSentIdentities(subject, body, attachmentNames);
    explicitSentTargets = explicit;
    // When the current reply or its attachments identify one or more RNCs,
    // quoted subjects and historical thread text cannot expand that set.
    if (explicit.length) identities = explicit;
  }
  let conversationLinked = false;
  if (!identities.length && message.conversationId) {
    const linkedEvents = await getDb().select({ rncId: emailEvents.rncId }).from(emailEvents)
      .where(eq(emailEvents.conversationId, message.conversationId));
    for (const linked of linkedEvents) {
      const [linkedRnc] = await getDb().select({ number: rncs.number, year: rncs.year }).from(rncs)
        .where(eq(rncs.id, linked.rncId)).limit(1);
      if (linkedRnc) identities.push(linkedRnc);
    }
    conversationLinked = identities.length > 0;
    identities = [...new Map(identities.map((identity) => [`${identity.number}/${identity.year}`, identity])).values()];
  }
  const db = getDb();
  if (officialSent && explicitSentTargets.length) {
    const validKeys = new Set(explicitSentTargets.map((identity) => `${identity.number}/${identity.year}`));
    const previousLinks = await db.select().from(emailEvents)
      .where(eq(emailEvents.outlookMessageId, message.id));
    for (const previous of previousLinks) {
      const [linked] = await db.select({ number: rncs.number, year: rncs.year }).from(rncs)
        .where(eq(rncs.id, previous.rncId)).limit(1);
      if (linked && !validKeys.has(`${linked.number}/${linked.year}`)) {
        await db.delete(emailEvents).where(eq(emailEvents.id, previous.id));
      }
    }
  }
  if (target) identities = identities.filter((item) => item.number === target.number && item.year === target.year);
  if (!identities.length) return stats;

  const [work] = await db.select().from(works).where(eq(works.name, workName)).limit(1);
  if (!work) return stats;
  const occurredAt = message.sentDateTime || message.receivedDateTime || new Date().toISOString();
  const occurredDate = dateOnly(occurredAt);
  const isAnalysis = officialIncoming
    && /encaminhamento de analise(?:s)? de tratativa(?:s)? do(?:s)? rnc/i.test(normalize(subject));
  const eventType = officialSent ? "envio_resposta" : isAnalysis ? "retorno_supervisao" : "recebimento";

  for (const identity of identities) {
    if ((officialSent || isAnalysis) && !identityIsStrong(identity, subject, attachmentNames) && !conversationLinked) continue;
    let [rnc] = await db.select().from(rncs).where(and(
      eq(rncs.workId, work.id), eq(rncs.number, identity.number), eq(rncs.year, identity.year),
    )).limit(1);
    if (!rnc && eventType !== "recebimento") continue;

    const description = descriptionFromAttachment(identity, attachmentNames);
    const pdfInformation = pdfInformationForIdentity(attachments, identity);
    const pdfOwners = pdfInformation.matching
      .map((information) => information.responsible)
      .filter((value): value is string => Boolean(value));
    const owners = [...new Set(pdfOwners.length ? pdfOwners : extractOwners(documentText))];
    const pdfAnalysisReviewers = pdfInformation.matching
      .map((information) => information.analysisReviewer)
      .filter((value): value is string => Boolean(value));
    const analysisReviewers = [...new Set(
      pdfAnalysisReviewers.length ? pdfAnalysisReviewers : extractAnalysisReviewers(documentText),
    )];
    if (rnc && pdfInformation.conflicts.length) {
      await recordConflict(rnc.id, "documentIdentity", [
        `RNC esperada ${identity.number}/${identity.year}`,
        ...pdfInformation.conflicts,
      ]);
    }
    if (!rnc) {
      const owner = owners.length === 1 ? owners[0] : "Não identificado";
      [rnc] = await db.insert(rncs).values({
        workId: work.id, number: identity.number, year: identity.year,
        description: description || "Descrição não identificada",
        type: classifyType(`${description}\n${combined}`), receivedAt: occurredDate,
        dueAt: addBusinessDays(occurredDate), status: "Recebida", responseOwner: owner,
        analysisOwner: analysisReviewers.length === 1 ? analysisReviewers[0] : "",
        fieldSources: JSON.stringify({
          workId: "Identificado no e-mail recebido", number: "Identificado no e-mail recebido",
          year: "Identificado no e-mail recebido", description: description ? "Identificado no documento" : "Não identificado",
          type: "Identificado no documento", receivedAt: "Identificado no e-mail recebido",
          responseOwner: owners.length === 1 ? "Extraído do documento" : "Não identificado",
          analysisOwner: analysisReviewers.length === 1 ? "Extraído do documento da RNC" : "Não identificado",
        }),
        fieldConfidence: JSON.stringify({
          receivedAt: { score: 5, reason: "Data da mensagem oficial recebida da Supervisão." },
          description: { score: description ? 5 : 1, reason: description ? "Descrição extraída do nome do documento original." : "Descrição não localizada." },
          type: { score: description ? 4 : 1, reason: "Classificação baseada no documento original." },
          responseOwner: { score: owners.length === 1 ? 5 : 1, reason: owners.length === 1 ? "Nome extraído do documento original da RNC." : "Responsável não localizado no documento." },
          analysisOwner: { score: analysisReviewers.length === 1 ? 5 : 1, reason: analysisReviewers.length === 1 ? "Revisor extraído do campo 'Revisor da Elaboração do RNC'." : "Revisor não localizado no documento." },
        }),
        sourceSummary: `Mensagem oficial recebida em ${occurredAt}`,
      }).returning();
      stats.newRncs++;
      if (owners.length === 1) stats.ownersIdentified++;
      await recordConflict(rnc.id, "responseOwner", owners);
      await recordConflict(rnc.id, "analysisOwner", analysisReviewers);
    } else {
      const [alreadyImported] = await db.select({ id: emailEvents.id }).from(emailEvents)
        .where(and(eq(emailEvents.rncId, rnc.id), eq(emailEvents.outlookMessageId, message.id))).limit(1);
      if (alreadyImported && !reprocess) continue;
      const changes: Partial<typeof rncs.$inferInsert> = {};
      const sources = parsedJson<Record<string, string>>(rnc.fieldSources, {});
      const confidence = parsedJson<Record<string, Confidence>>(rnc.fieldConfidence, {});
      if (eventType === "recebimento") {
        if (canAutoUpdate(rnc, "receivedAt") && (!rnc.receivedAt || occurredDate < rnc.receivedAt)) {
          changes.receivedAt = occurredDate; changes.dueAt = addBusinessDays(occurredDate);
          sources.receivedAt = "Identificado no e-mail recebido";
          confidence.receivedAt = { score: 5, reason: "Data da mensagem oficial recebida da Supervisão." };
        }
        if (description && canAutoUpdate(rnc, "description")) {
          changes.description = description; sources.description = "Identificado no documento";
          confidence.description = { score: 5, reason: "Descrição extraída do nome do documento original." };
        }
        if (owners.length === 1 && canAutoUpdate(rnc, "responseOwner")) {
          changes.responseOwner = owners[0]; sources.responseOwner = "Extraído do documento";
          const ownerInformation = pdfInformation.matching.find((item) => item.responsible === owners[0]);
          confidence.responseOwner = {
            score: ownerInformation ? confidenceScore(ownerInformation.confidence.responsible) : 4,
            reason: ownerInformation
              ? "Nome extraído do PDF original da RNC."
              : "Nome extraído do documento original da RNC.",
          };
          stats.ownersIdentified++;
        } else if (owners.length > 1) {
          await recordConflict(rnc.id, "responseOwner", owners);
          if (canAutoUpdate(rnc, "responseOwner")) changes.responseOwner = "Não identificado";
        }
        if (analysisReviewers.length === 1 && canAutoUpdate(rnc, "analysisOwner")) {
          changes.analysisOwner = analysisReviewers[0];
          sources.analysisOwner = "Extraído do documento da RNC";
          const reviewerInformation = pdfInformation.matching.find(
            (item) => item.analysisReviewer === analysisReviewers[0],
          );
          confidence.analysisOwner = {
            score: reviewerInformation
              ? confidenceScore(reviewerInformation.confidence.analysisReviewer)
              : 4,
            reason: "Revisor extraído do campo 'Revisor da Elaboração do RNC'.",
          };
        } else if (analysisReviewers.length > 1) {
          await recordConflict(rnc.id, "analysisOwner", analysisReviewers);
        }
      } else if (eventType === "envio_resposta") {
        if (canAutoUpdate(rnc, "sentAt") && (!rnc.sentAt || occurredDate < rnc.sentAt)) {
          changes.sentAt = occurredDate; sources.sentAt = "Identificado nos Itens Enviados";
          confidence.sentAt = { score: 5, reason: `Primeiro envio oficial para ${OFFICIAL_EMAIL}.` };
          stats.sentDatesCorrected++;
        }
        if (!protectedStatuses.has(rnc.status) && canAutoUpdate(rnc, "status")) {
          changes.status = "Respondida"; sources.status = "Identificado nos Itens Enviados";
        }
      } else {
        stats.returnsProcessed++;
        if (analysisReviewers.length === 1 && canAutoUpdate(rnc, "analysisOwner")) {
          changes.analysisOwner = analysisReviewers[0];
          sources.analysisOwner = "Extraído do documento de análise";
          const reviewerInformation = pdfInformation.matching.find(
            (item) => item.analysisReviewer === analysisReviewers[0],
          );
          confidence.analysisOwner = {
            score: reviewerInformation
              ? confidenceScore(reviewerInformation.confidence.analysisReviewer)
              : 4,
            reason: "Revisor extraído do campo 'Revisor da Elaboração da Análise da Tratativa'.",
          };
        } else if (analysisReviewers.length > 1) {
          await recordConflict(rnc.id, "analysisOwner", analysisReviewers);
        }
        if (canAutoUpdate(rnc, "returnedAt") && (!rnc.returnedAt || occurredDate >= rnc.returnedAt)) {
          changes.returnedAt = occurredDate; sources.returnedAt = "Identificado no e-mail recebido";
          confidence.returnedAt = { score: 5, reason: "Data do e-mail oficial de retorno da Supervisão." };
        }
        if (canAutoUpdate(rnc, "status")) {
          const detectedStatuses = [...new Set(pdfInformation.matching
            .map((information) => information.analysisStatus)
            .filter((status) => status !== "STATUS_A_CONFIRMAR"))];
          if (detectedStatuses.length > 1) await recordConflict(rnc.id, "status", detectedStatuses);
          const selectedInformation = pdfInformation.matching.find(
            (information) => information.analysisStatus === detectedStatuses[0],
          );
          const result = selectedInformation && detectedStatuses.length === 1
            ? {
              status: selectedInformation.analysisStatus === "APROVADA" ? "Aprovada" : "Reprovada",
              confidence: {
                score: confidenceScore(selectedInformation.confidence.analysisStatus),
                reason: `Resultado "${selectedInformation.matchedStatusText}" identificado no PDF de análise.`,
              },
            }
            : detectedStatuses.length > 1
              ? {
                status: "Retorno recebido — status a confirmar",
                confidence: { score: 1, reason: "Documentos de análise apresentaram resultados divergentes." },
              }
              : analysisStatus(documentText).status !== "Retorno recebido — status a confirmar"
                ? analysisStatus(documentText)
                : analysisStatusFromEmailBody(body) || analysisStatus(documentText);
          changes.status = result.status; sources.status = "Extraído do documento de análise";
          confidence.status = result.confidence;
          stats.statusesUpdated++;
        }
      }
      if (Object.keys(changes).length) {
        changes.fieldSources = JSON.stringify(sources);
        changes.fieldConfidence = JSON.stringify(confidence);
        changes.updatedAt = new Date().toISOString();
        await db.update(rncs).set(changes).where(eq(rncs.id, rnc.id));
        stats.updatedRncs++;
      }
    }

    const associationConfidence = identityIsStrong(identity, subject, attachmentNames) ? 5 : conversationLinked ? 4 : 3;
    const eventValues: typeof emailEvents.$inferInsert = {
      rncId: rnc.id, outlookMessageId: message.id, internetMessageId: message.internetMessageId,
      conversationId: message.conversationId, folderName: folder.path, eventType, sender,
      inReplyTo: message.internetMessageHeaders?.find((header) => normalize(header.name || "") === "in-reply-to")?.value,
      references: message.internetMessageHeaders?.find((header) => normalize(header.name || "") === "references")?.value,
      associationConfidence,
      recipients: recipientsList.join(", "), subject, summary: body.slice(0, 2000), occurredAt,
      attachmentMetadata: JSON.stringify(attachmentAuditMetadata(attachments)),
    };
    await db.insert(emailEvents).values(eventValues).onConflictDoUpdate({
      target: [emailEvents.rncId, emailEvents.outlookMessageId],
      set: {
        internetMessageId: eventValues.internetMessageId,
        conversationId: eventValues.conversationId,
        folderName: eventValues.folderName,
        eventType,
        sender,
        recipients: eventValues.recipients,
        subject,
        summary: eventValues.summary,
        occurredAt,
        attachmentMetadata: eventValues.attachmentMetadata,
        inReplyTo: eventValues.inReplyTo,
        references: eventValues.references,
        associationConfidence,
      },
    });
    stats.eventsImported++;
  }
  return stats;
}

async function syncFolder(
  accessToken: string, connectionId: number, folder: GraphFolder & { path: string },
  kind: FolderKind, force: boolean, target?: Identity,
) {
  const db = getDb();
  const [state] = await db.select().from(outlookSyncFolders).where(and(
    eq(outlookSyncFolders.connectionId, connectionId), eq(outlookSyncFolders.folderId, folder.id),
  )).limit(1);
  // The historical archive is already persisted in the database. Keeping the
  // first Graph pass bounded prevents a serverless timeout; the delta link
  // stored at the end of the pass handles every subsequent message.
  const days = Math.max(1, Math.min(120, Number(process.env.OUTLOOK_INITIAL_SYNC_DAYS || 120)));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const select = "id,internetMessageId,conversationId,parentFolderId,subject,bodyPreview,body,receivedDateTime,sentDateTime,sender,from,toRecipients,ccRecipients,hasAttachments,internetMessageHeaders";
  let url = !force && state?.deltaLink
    ? state.deltaLink
    : `/me/mailFolders/${encodeURIComponent(folder.id)}/messages/delta?$select=${select}&$filter=receivedDateTime ge ${since}`;
  const stats = emptyStats();
  let deltaLink: string | undefined;
  do {
    const page: GraphPage<GraphMessage> = await graph(accessToken, url);
    const ordered = page.value.sort((a, b) =>
      String(a.sentDateTime || a.receivedDateTime).localeCompare(String(b.sentDateTime || b.receivedDateTime)));
    for (const message of ordered) addStats(stats, await processMessage(accessToken, message, folder, kind, target));
    url = page["@odata.nextLink"] || "";
    deltaLink = page["@odata.deltaLink"] || deltaLink;
  } while (url);
  await db.insert(outlookSyncFolders).values({
    connectionId, folderId: folder.id, folderName: folder.path, folderKind: kind, deltaLink,
  }).onConflictDoUpdate({
    target: [outlookSyncFolders.connectionId, outlookSyncFolders.folderId],
    set: { folderName: folder.path, folderKind: kind, deltaLink, updatedAt: new Date().toISOString() },
  });
  return stats;
}

async function protectOnlyRealManualCorrections() {
  const db = getDb();
  const [records, manualChanges] = await Promise.all([
    db.select().from(rncs),
    db.select({ rncId: auditLog.rncId, field: auditLog.field }).from(auditLog).where(ne(auditLog.field, "registro")),
  ]);
  const corrected = new Map<number, Set<string>>();
  for (const change of manualChanges) {
    const fields = corrected.get(change.rncId) || new Set<string>();
    fields.add(change.field);
    corrected.set(change.rncId, fields);
  }
  for (const record of records) {
    const sources = parsedJson<Record<string, string>>(record.fieldSources, {});
    const protectedFields = new Set(
      [...(corrected.get(record.id) || new Set<string>())].filter((field) => {
        const source = normalize(sources[field] || "");
        return source === "manual" || source.includes("preenchido manualmente");
      }),
    );
    if (record.notes) protectedFields.add("notes");
    const next = JSON.stringify([...protectedFields]);
    if (next !== record.manualFields) {
      await db.update(rncs).set({ manualFields: next }).where(eq(rncs.id, record.id));
    }
  }
}

async function fullMailboxDossierScan(accessToken: string, target?: Identity, cursor?: string) {
  const folders = await discoverFolders(accessToken);
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const select = "id,internetMessageId,conversationId,parentFolderId,subject,bodyPreview,body,receivedDateTime,sentDateTime,sender,from,toRecipients,ccRecipients,hasAttachments,internetMessageHeaders";
  const search = encodeURIComponent(target
    ? `"${Number(target.number)}/${target.year}"`
    : `"participants:${OFFICIAL_EMAIL}"`);
  const page = await graph<GraphPage<GraphMessage>>(
    accessToken,
    // A single message can contain several large PDFs. Keeping the serverless
    // batch at one message prevents the platform from terminating the request
    // before the continuation cursor can be returned to the browser.
    cursor || `/me/messages?$search=${search}&$select=${select}&$top=1`,
  );
  const messages = page.value;
  messages.sort((a, b) =>
    String(a.sentDateTime || a.receivedDateTime).localeCompare(String(b.sentDateTime || b.receivedDateTime)));
  const stats = emptyStats();
  for (const message of messages) {
    const recipients = [...(message.toRecipients || []), ...(message.ccRecipients || [])]
      .map((item) => address(item.emailAddress?.address));
    const kind: FolderKind = recipients.includes(OFFICIAL_EMAIL) ? "sent" : "inbox";
    const knownFolder = message.parentFolderId ? byId.get(message.parentFolderId) : undefined;
    const folder = knownFolder || {
      id: message.parentFolderId || "search",
      displayName: "Pesquisa geral do Outlook",
      path: "Pesquisa geral do Outlook",
      kind,
    };
    try {
      addStats(stats, await processMessage(accessToken, message, folder, kind, target, true));
    } catch (error) {
      // A malformed attachment or isolated Graph response must not prevent the
      // continuation cursor from advancing through the rest of the mailbox.
      console.error("Mensagem ignorada durante a montagem do dossiê:", message.id, error);
    }
  }
  return { folders, stats, nextCursor: page["@odata.nextLink"] };
}

async function reconcileDossiers(stats: SyncStats, target?: Identity) {
  const db = getDb();
  const records = await db.select().from(rncs);
  for (const record of records) {
    if (target && (record.number !== target.number || record.year !== target.year)) continue;
    const events = await db.select().from(emailEvents).where(eq(emailEvents.rncId, record.id));
    const dates = (eventType: string) => events.filter((event) => event.eventType === eventType)
      .map((event) => event.occurredAt.slice(0, 10)).sort();
    const receivedDates = dates("recebimento");
    const sentDates = dates("envio_resposta");
    const returnDates = dates("retorno_supervisao");
    const changes: Partial<typeof rncs.$inferInsert> = {};
    const sources = parsedJson<Record<string, string>>(record.fieldSources, {});
    const confidence = parsedJson<Record<string, Confidence>>(record.fieldConfidence, {});
    if (canAutoUpdate(record, "receivedAt") && receivedDates[0] && record.receivedAt !== receivedDates[0]) {
      changes.receivedAt = receivedDates[0];
      changes.dueAt = addBusinessDays(receivedDates[0]);
      sources.receivedAt = "Identificado no e-mail oficial recebido";
      confidence.receivedAt = { score: 5, reason: "Primeiro recebimento oficial localizado no dossiê." };
    }
    const officialSentAt = sentDates[0] || null;
    if (canAutoUpdate(record, "sentAt") && record.sentAt !== officialSentAt) {
      changes.sentAt = officialSentAt;
      sources.sentAt = officialSentAt ? "Identificado nos Itens Enviados" : "Não identificado";
      confidence.sentAt = officialSentAt
        ? { score: 5, reason: `Primeiro envio oficial para ${OFFICIAL_EMAIL}.` }
        : { score: 1, reason: "Nenhum envio oficial para a Supervisão foi localizado." };
      stats.sentDatesCorrected++;
    }
    const officialReturnAt = returnDates.at(-1) || null;
    if (canAutoUpdate(record, "returnedAt") && record.returnedAt !== officialReturnAt) {
      changes.returnedAt = officialReturnAt;
      sources.returnedAt = officialReturnAt ? "Identificado no e-mail de análise" : "Não identificado";
      confidence.returnedAt = officialReturnAt
        ? { score: 5, reason: "Último retorno oficial localizado no dossiê." }
        : { score: 1, reason: "Nenhum retorno oficial localizado." };
    }
    if (!returnDates.length && canAutoUpdate(record, "status")) {
      const nextStatus = officialSentAt ? "Respondida" : "Recebida";
      if (record.status !== nextStatus) {
        changes.status = nextStatus;
        sources.status = officialSentAt ? "Identificado nos Itens Enviados" : "Identificado no e-mail recebido";
        confidence.status = { score: 5, reason: officialSentAt ? "Existe envio oficial e não há retorno da análise." : "Existe recebimento oficial e não há envio oficial." };
        stats.statusesUpdated++;
      }
    }
    if (Object.keys(changes).length) {
      changes.fieldSources = JSON.stringify(sources);
      changes.fieldConfidence = JSON.stringify(confidence);
      changes.updatedAt = new Date().toISOString();
      await db.update(rncs).set(changes).where(eq(rncs.id, record.id));
      stats.updatedRncs++;
    }
  }
}

export async function synchronizeOutlook(options: { force?: boolean; targetRncId?: number; cursor?: string } = {}) {
  await ensureDatabase();
  const db = getDb();
  await protectOnlyRealManualCorrections();
  const [connection] = await db.select().from(outlookConnections).limit(1);
  if (!connection) throw new Error("Conecte primeiro a conta do Outlook.");
  if (!options.force && connection.lastSyncAt && Date.now() - new Date(connection.lastSyncAt).getTime() < 60_000) {
    return { imported: 0, folders: 0, message: "Os e-mails já foram atualizados há menos de um minuto." };
  }
  let target: Identity | undefined;
  if (options.targetRncId) {
    const [rnc] = await db.select().from(rncs).where(eq(rncs.id, options.targetRncId)).limit(1);
    if (!rnc) throw new Error("RNC não encontrada.");
    target = { number: rnc.number, year: rnc.year };
  }
  const token = await refreshAccessToken(connection.encryptedRefreshToken);
  if (token.refresh_token) {
    await db.update(outlookConnections).set({ encryptedRefreshToken: encryptToken(token.refresh_token) })
      .where(eq(outlookConnections.id, connection.id));
  }
  const [run] = await db.insert(syncRuns).values({ connectionId: connection.id }).returning();
  try {
    let folders: Array<GraphFolder & { path: string; kind: FolderKind }>;
    const stats = emptyStats();
    if (options.force) {
      const dossier = await fullMailboxDossierScan(token.access_token!, target, options.cursor);
      folders = dossier.folders;
      addStats(stats, dossier.stats);
      if (!dossier.nextCursor) await reconcileDossiers(stats, target);
      const complete = !dossier.nextCursor;
      const message = complete
        ? [
          `${stats.messagesAnalyzed} mensagens oficiais analisadas nesta etapa`,
          `${stats.newRncs} novas RNC encontradas`,
          `${stats.updatedRncs} RNC atualizadas`,
          `${stats.ownersIdentified} responsáveis identificados`,
          `${stats.sentDatesCorrected} datas de envio corrigidas`,
          `${stats.returnsProcessed} retornos processados`,
          `${stats.statusesUpdated} status atualizados`,
          "Sincronização concluída.",
        ].join(" · ")
        : `${stats.messagesAnalyzed} mensagens oficiais analisadas nesta etapa. Continuando automaticamente…`;
      const finishedAt = new Date().toISOString();
      await Promise.all([
        db.update(outlookConnections).set({ lastSyncAt: finishedAt, lastSyncStatus: complete ? "success" : "running", lastSyncMessage: message })
          .where(eq(outlookConnections.id, connection.id)),
        db.update(syncRuns).set({
          finishedAt, status: complete ? "success" : "running",
          foldersChecked: JSON.stringify(folders.map((folder) => folder.path)),
          importedCount: stats.eventsImported, message,
        }).where(eq(syncRuns.id, run.id)),
      ]);
      return {
        ...stats, folders: folders.length, foldersChecked: folders.map((folder) => folder.path),
        complete, nextCursor: dossier.nextCursor, message,
      };
    } else {
      folders = await discoverFolders(token.access_token!);
      for (const folder of folders) {
        addStats(stats, await syncFolder(token.access_token!, connection.id, folder, folder.kind, false, target));
      }
    }
    const message = [
      `${stats.messagesAnalyzed} novas mensagens analisadas`,
      `${stats.newRncs} novas RNC encontradas`,
      `${stats.updatedRncs} RNC atualizadas`,
      `${stats.ownersIdentified} responsáveis identificados`,
      `${stats.sentDatesCorrected} datas de envio corrigidas`,
      `${stats.returnsProcessed} retornos processados`,
      `${stats.statusesUpdated} status atualizados`,
      "Sincronização concluída.",
    ].join(" · ");
    const finishedAt = new Date().toISOString();
    await Promise.all([
      db.update(outlookConnections).set({ lastSyncAt: finishedAt, lastSyncStatus: "success", lastSyncMessage: message })
        .where(eq(outlookConnections.id, connection.id)),
      db.update(syncRuns).set({
        finishedAt, status: "success", foldersChecked: JSON.stringify(folders.map((folder) => folder.path)),
        importedCount: stats.eventsImported, message,
      }).where(eq(syncRuns.id, run.id)),
    ]);
    return { ...stats, folders: folders.length, foldersChecked: folders.map((folder) => folder.path), message };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na sincronização.";
    const finishedAt = new Date().toISOString();
    await Promise.all([
      db.update(outlookConnections).set({ lastSyncAt: finishedAt, lastSyncStatus: "error", lastSyncMessage: message })
        .where(eq(outlookConnections.id, connection.id)),
      db.update(syncRuns).set({ finishedAt, status: "error", message }).where(eq(syncRuns.id, run.id)),
    ]);
    throw error;
  }
}
