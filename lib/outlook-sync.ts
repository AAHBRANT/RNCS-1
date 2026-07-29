import { and, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../db";
import {
  emailEvents, outlookConnections, outlookSyncFolders, rncConflicts, rncs, syncRuns, works,
} from "../db/schema";
import { encryptToken, refreshAccessToken } from "./outlook-auth";

type FolderKind = "inbox" | "sent";
type GraphFolder = { id: string; displayName: string; childFolderCount?: number };
type GraphAddress = { emailAddress?: { address?: string } };
type GraphAttachment = {
  id: string; name?: string; contentType?: string; size?: number; isInline?: boolean;
  contentBytes?: string; "@odata.type"?: string;
};
type GraphMessage = {
  id: string; internetMessageId?: string; conversationId?: string; subject?: string;
  bodyPreview?: string; body?: { content?: string; contentType?: string };
  receivedDateTime?: string; sentDateTime?: string; sender?: GraphAddress; from?: GraphAddress;
  toRecipients?: GraphAddress[]; ccRecipients?: GraphAddress[]; hasAttachments?: boolean;
  "@removed"?: unknown;
};
type GraphPage<T> = { value: T[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
type Identity = { number: string; year: number };
type AttachmentInfo = { id: string; name: string; contentType: string; size: number; extractedText?: string };

const OFFICIAL_EMAIL = "contato@jampasustentavel.com";
const ANALYSIS_PREFIX = "encaminhamento de analise de tratativa do rnc";
const protectedStatuses = new Set(["Aprovada", "Reprovada", "Retorno recebido — status a confirmar"]);
const workAliases = [
  { name: "Parque do Roger - Fase II", aliases: ["parque do roger", "parque roger", "roger fase ii", "roger fase 2", "antigo lixao do roger"] },
  { name: "Ponte Rio Cuiá", aliases: ["ponte rio cuiá", "ponte rio cuia", "rio cuiá", "rio cuia"] },
  { name: "Compl. Beira Rio", aliases: ["compl. beira rio", "compl beira rio", "complementação beira rio", "complementacao beira rio", "beira rio"] },
];

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

function identifyWork(text: string) {
  const source = normalize(text);
  return workAliases.find((work) => work.aliases.some((alias) => source.includes(normalize(alias))))?.name;
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
  for (const match of `${subject}\n${body}`.matchAll(/\bRNC\s*(?:N[º°o.]?\s*)?[-–—:#]?\s*(\d{1,6})\s*[\/-]\s*(20\d{2}|\d{2})\b/gi)) {
    add(match[1], match[2]);
  }
  return [...found.values()];
}

function identityIsStrong(identity: Identity, subject: string, attachmentNames: string[]) {
  const key = `${Number(identity.number)}\\s*[\\/_-]\\s*${identity.year}`;
  const matcher = new RegExp(key, "i");
  return matcher.test(subject) || attachmentNames.some((name) => matcher.test(name));
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
    if (/\.pdf$/i.test(attachment.name)) {
      const module = await import("pdf-parse") as unknown as { PDFParse: new (options: { data: Buffer }) => { getText(): Promise<{ text: string }>; destroy(): Promise<void> } };
      const parser = new module.PDFParse({ data: buffer });
      const result = await parser.getText();
      await parser.destroy();
      return result.text.slice(0, 30_000);
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
    if (info.size <= 12_000_000 && /\.(pdf|docx|txt)$/i.test(info.name)) {
      const detail = await graph<GraphAttachment>(accessToken,
        `/me/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachment.id)}`);
      info.extractedText = await extractAttachmentText(detail);
    }
    result.push(info);
  }
  return result;
}

function extractOwners(text: string) {
  const values = new Set<string>();
  for (const pattern of [
    /respons[aá]vel\s+(?:pela\s+resposta|pela\s+tratativa|t[eé]cnico)?\s*[:\-]\s*([^\n\r;|]{3,100})/gi,
    /elaborado\s+por\s*[:\-]\s*([^\n\r;|]{3,100})/gi,
  ]) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1].replace(/\s{2,}/g, " ").trim().replace(/[.,:;-]+$/, "");
      if (value.length <= 100) values.add(value);
    }
  }
  return [...values];
}

function analysisStatus(text: string) {
  const source = normalize(text);
  if (/nao aprovada|reprovada|nao atendida|tratativa nao aceita|necessita correcao|revisar|reenviar|pendencia permanece/.test(source)) return "Reprovada";
  if (/tratativa aprovada|considerada atendida|sem pendencias|aprovada|atendida|sanada|encerrada/.test(source)) return "Aprovada";
  return "Retorno recebido — status a confirmar";
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

async function processMessage(
  accessToken: string, message: GraphMessage, folder: GraphFolder & { path: string }, kind: FolderKind, target?: Identity,
) {
  if (message["@removed"] || !message.id) return 0;
  const sender = address(message.sender?.emailAddress?.address || message.from?.emailAddress?.address);
  const recipientsList = [...(message.toRecipients || []), ...(message.ccRecipients || [])]
    .map((item) => address(item.emailAddress?.address)).filter(Boolean);
  const officialIncoming = kind === "inbox" && sender === OFFICIAL_EMAIL;
  const officialSent = kind === "sent" && recipientsList.includes(OFFICIAL_EMAIL);
  if (!officialIncoming && !officialSent) return 0;

  const attachments = await attachmentsForMessage(accessToken, message);
  const subject = message.subject || "";
  const body = stripHtml(message.body?.content || message.bodyPreview || "");
  const attachmentNames = attachments.map((item) => item.name);
  const documentText = attachments.map((item) => item.extractedText || "").join("\n");
  const combined = `${subject}\n${body}\n${attachmentNames.join("\n")}\n${documentText}`;
  const workName = identifyWork(combined);
  if (!workName) return 0;
  let identities = extractIdentities(subject, attachmentNames, body);
  if (target) identities = identities.filter((item) => item.number === target.number && item.year === target.year);
  if (!identities.length) return 0;

  const db = getDb();
  const [work] = await db.select().from(works).where(eq(works.name, workName)).limit(1);
  if (!work) return 0;
  const occurredAt = message.sentDateTime || message.receivedDateTime || new Date().toISOString();
  const occurredDate = dateOnly(occurredAt);
  const isAnalysis = officialIncoming && normalize(subject).trim().startsWith(ANALYSIS_PREFIX);
  const eventType = officialSent ? "envio_resposta" : isAnalysis ? "retorno_supervisao" : "recebimento";
  let imported = 0;

  for (const identity of identities) {
    if ((officialSent || isAnalysis) && !identityIsStrong(identity, subject, attachmentNames)) continue;
    let [rnc] = await db.select().from(rncs).where(and(
      eq(rncs.workId, work.id), eq(rncs.number, identity.number), eq(rncs.year, identity.year),
    )).limit(1);
    if (!rnc && eventType !== "recebimento") continue;

    const description = descriptionFromAttachment(identity, attachmentNames);
    const owners = extractOwners(documentText);
    if (!rnc) {
      const owner = owners.length === 1 ? owners[0] : "Não identificado";
      [rnc] = await db.insert(rncs).values({
        workId: work.id, number: identity.number, year: identity.year,
        description: description || "Descrição não identificada",
        type: classifyType(`${description}\n${combined}`), receivedAt: occurredDate,
        dueAt: addBusinessDays(occurredDate), status: "Recebida", responseOwner: owner,
        fieldSources: JSON.stringify({
          workId: "Identificado no e-mail recebido", number: "Identificado no e-mail recebido",
          year: "Identificado no e-mail recebido", description: description ? "Identificado no documento" : "Não identificado",
          type: "Identificado no documento", receivedAt: "Identificado no e-mail recebido",
          responseOwner: owners.length === 1 ? "Extraído do documento" : "Não identificado",
        }),
        sourceSummary: `Mensagem oficial recebida em ${occurredAt}`,
      }).returning();
      await recordConflict(rnc.id, "responseOwner", owners);
    } else {
      const [alreadyImported] = await db.select({ id: emailEvents.id }).from(emailEvents)
        .where(and(eq(emailEvents.rncId, rnc.id), eq(emailEvents.outlookMessageId, message.id))).limit(1);
      if (alreadyImported) continue;
      const changes: Partial<typeof rncs.$inferInsert> = {};
      const sources = parsedJson<Record<string, string>>(rnc.fieldSources, {});
      if (eventType === "recebimento") {
        if (canAutoUpdate(rnc, "receivedAt") && occurredDate < rnc.receivedAt) {
          changes.receivedAt = occurredDate; changes.dueAt = addBusinessDays(occurredDate);
          sources.receivedAt = "Identificado no e-mail recebido";
        }
        if (description && canAutoUpdate(rnc, "description")) {
          changes.description = description; sources.description = "Identificado no documento";
        }
        if (owners.length === 1 && canAutoUpdate(rnc, "responseOwner")) {
          changes.responseOwner = owners[0]; sources.responseOwner = "Extraído do documento";
        } else if (owners.length > 1) {
          await recordConflict(rnc.id, "responseOwner", owners);
          if (canAutoUpdate(rnc, "responseOwner")) changes.responseOwner = "Não identificado";
        }
      } else if (eventType === "envio_resposta") {
        if (canAutoUpdate(rnc, "sentAt") && (!rnc.sentAt || occurredDate < rnc.sentAt)) {
          changes.sentAt = occurredDate; sources.sentAt = "Identificado nos Itens Enviados";
        }
        if (!protectedStatuses.has(rnc.status) && canAutoUpdate(rnc, "status")) {
          changes.status = "Respondida"; sources.status = "Identificado nos Itens Enviados";
        }
      } else {
        if (canAutoUpdate(rnc, "returnedAt") && (!rnc.returnedAt || occurredDate >= rnc.returnedAt)) {
          changes.returnedAt = occurredDate; sources.returnedAt = "Identificado no e-mail recebido";
        }
        if (canAutoUpdate(rnc, "status")) {
          changes.status = analysisStatus(`${body}\n${documentText}`); sources.status = "Extraído do documento de análise";
        }
      }
      if (Object.keys(changes).length) {
        changes.fieldSources = JSON.stringify(sources);
        changes.updatedAt = new Date().toISOString();
        await db.update(rncs).set(changes).where(eq(rncs.id, rnc.id));
      }
    }

    await db.insert(emailEvents).values({
      rncId: rnc.id, outlookMessageId: message.id, internetMessageId: message.internetMessageId,
      conversationId: message.conversationId, folderName: folder.path, eventType, sender,
      recipients: recipientsList.join(", "), subject, summary: body.slice(0, 2000), occurredAt,
      attachmentMetadata: JSON.stringify(attachments.map(({ extractedText: _, ...item }) => item)),
    }).onConflictDoNothing();
    imported++;
  }
  return imported;
}

async function syncFolder(
  accessToken: string, connectionId: number, folder: GraphFolder & { path: string },
  kind: FolderKind, force: boolean, target?: Identity,
) {
  const db = getDb();
  const [state] = await db.select().from(outlookSyncFolders).where(and(
    eq(outlookSyncFolders.connectionId, connectionId), eq(outlookSyncFolders.folderId, folder.id),
  )).limit(1);
  const days = Math.max(1, Math.min(3650, Number(process.env.OUTLOOK_INITIAL_SYNC_DAYS || 730)));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const select = "id,internetMessageId,conversationId,subject,bodyPreview,body,receivedDateTime,sentDateTime,sender,from,toRecipients,ccRecipients,hasAttachments";
  let url = !force && state?.deltaLink
    ? state.deltaLink
    : `/me/mailFolders/${encodeURIComponent(folder.id)}/messages/delta?$select=${select}&$filter=receivedDateTime ge ${since}`;
  let imported = 0;
  let deltaLink: string | undefined;
  do {
    const page: GraphPage<GraphMessage> = await graph(accessToken, url);
    const ordered = page.value.sort((a, b) =>
      String(a.sentDateTime || a.receivedDateTime).localeCompare(String(b.sentDateTime || b.receivedDateTime)));
    for (const message of ordered) imported += await processMessage(accessToken, message, folder, kind, target);
    url = page["@odata.nextLink"] || "";
    deltaLink = page["@odata.deltaLink"] || deltaLink;
  } while (url);
  await db.insert(outlookSyncFolders).values({
    connectionId, folderId: folder.id, folderName: folder.path, folderKind: kind, deltaLink,
  }).onConflictDoUpdate({
    target: [outlookSyncFolders.connectionId, outlookSyncFolders.folderId],
    set: { folderName: folder.path, folderKind: kind, deltaLink, updatedAt: new Date().toISOString() },
  });
  return imported;
}

export async function synchronizeOutlook(options: { force?: boolean; targetRncId?: number } = {}) {
  await ensureDatabase();
  const db = getDb();
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
    const folders = await discoverFolders(token.access_token!);
    let imported = 0;
    for (const folder of folders) {
      imported += await syncFolder(token.access_token!, connection.id, folder, folder.kind, Boolean(options.force), target);
    }
    const message = `${imported} evento(s) oficial(is) importado(s) em ${folders.length} pasta(s).`;
    const finishedAt = new Date().toISOString();
    await Promise.all([
      db.update(outlookConnections).set({ lastSyncAt: finishedAt, lastSyncStatus: "success", lastSyncMessage: message })
        .where(eq(outlookConnections.id, connection.id)),
      db.update(syncRuns).set({
        finishedAt, status: "success", foldersChecked: JSON.stringify(folders.map((folder) => folder.path)),
        importedCount: imported, message,
      }).where(eq(syncRuns.id, run.id)),
    ]);
    return { imported, folders: folders.length, foldersChecked: folders.map((folder) => folder.path), message };
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
