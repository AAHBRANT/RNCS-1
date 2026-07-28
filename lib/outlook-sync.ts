import { and, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../db";
import { emailEvents, outlookConnections, outlookSyncFolders, rncs, works } from "../db/schema";
import { encryptToken, refreshAccessToken } from "./outlook-auth";

type GraphFolder = { id: string; displayName: string; childFolderCount?: number };
type GraphAddress = { emailAddress?: { address?: string } };
type GraphMessage = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  sentDateTime?: string;
  sender?: GraphAddress;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  hasAttachments?: boolean;
  "@removed"?: unknown;
};
type GraphPage<T> = { value: T[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };

const workAliases = [
  { name: "Parque do Roger - Fase II", aliases: ["parque do roger", "parque roger", "roger fase ii", "roger fase 2"] },
  { name: "Ponte Rio Cuiá", aliases: ["ponte rio cuiá", "ponte rio cuia", "rio cuiá", "rio cuia"] },
  { name: "Compl. Beira Rio", aliases: ["compl. beira rio", "compl beira rio", "complementação beira rio", "complementacao beira rio", "beira rio"] },
];

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function identifyWork(text: string) {
  const source = normalize(text);
  return workAliases.find((work) => work.aliases.some((alias) => source.includes(normalize(alias))))?.name;
}

function extractRnc(text: string) {
  const patterns = [
    /\bRNC\s*(?:N[º°o.]?\s*)?[-–—:#]?\s*(\d{1,6})\s*[\/-]\s*(20\d{2}|\d{2})\b/i,
    /\bRNC\s*(?:N[º°o.]?\s*)?[-–—:#]?\s*(\d{1,6})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const currentYear = new Date().getFullYear();
      let year = match[2] ? Number(match[2]) : currentYear;
      if (year < 100) year += 2000;
      return { number: match[1].padStart(3, "0"), year };
    }
  }
}

function classifyType(text: string) {
  const source = normalize(text);
  if (/seguranca|acidente|epi|risco/.test(source)) return "Segurança do Trabalho";
  if (/ambient|residuo|poluic|licenca/.test(source)) return "Ambiental";
  if (/projeto|desenho|detalh/.test(source)) return "Projeto";
  if (/execucao|servico|concret|obra/.test(source)) return "Execução";
  if (/document|registro|procedimento/.test(source)) return "Documental";
  if (/qualidade|inspecao|ensaio/.test(source)) return "Qualidade";
  return "A classificar";
}

function dateOnly(value?: string) {
  return (value || new Date().toISOString()).slice(0, 10);
}

function addBusinessDays(value: string, days = 5) {
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

async function childFolders(accessToken: string, parentId: string, path = ""): Promise<Array<GraphFolder & { path: string }>> {
  const url = `/me/mailFolders/${encodeURIComponent(parentId)}/childFolders?$select=id,displayName,childFolderCount&$top=100`;
  const direct = await allPages<GraphFolder>(accessToken, url);
  const result: Array<GraphFolder & { path: string }> = [];
  for (const folder of direct) {
    const folderPath = path ? `${path}/${folder.displayName}` : folder.displayName;
    result.push({ ...folder, path: folderPath });
    if (folder.childFolderCount) result.push(...await childFolders(accessToken, folder.id, folderPath));
  }
  return result;
}

async function processMessage(message: GraphMessage, kind: "inbox" | "sent") {
  if (message["@removed"] || !message.id) return false;
  const subject = message.subject || "";
  const preview = message.bodyPreview || "";
  const combined = `${subject}\n${preview}`;
  const identity = extractRnc(combined);
  const workName = identifyWork(combined);
  if (!identity || !workName) return false;

  const db = getDb();
  const [alreadyImported] = await db.select({ id: emailEvents.id }).from(emailEvents)
    .where(eq(emailEvents.outlookMessageId, message.id)).limit(1);
  if (alreadyImported) return false;

  const [work] = await db.select().from(works).where(eq(works.name, workName)).limit(1);
  if (!work) return false;
  const occurredAt = message.sentDateTime || message.receivedDateTime || new Date().toISOString();
  const occurredDate = dateOnly(occurredAt);
  const [existing] = await db.select().from(rncs).where(and(
    eq(rncs.workId, work.id), eq(rncs.number, identity.number), eq(rncs.year, identity.year),
  )).limit(1);

  let rnc = existing;
  let eventType = "recebimento";
  if (!rnc) {
    const [created] = await db.insert(rncs).values({
      workId: work.id,
      number: identity.number,
      year: identity.year,
      description: subject || "Descrição não identificada",
      type: classifyType(combined),
      receivedAt: occurredDate,
      dueAt: addBusinessDays(occurredDate),
      status: kind === "sent" ? "Respondida" : "Recebida",
      sentAt: kind === "sent" ? occurredDate : null,
    }).returning();
    rnc = created;
    eventType = kind === "sent" ? "envio_resposta" : "recebimento";
  } else if (kind === "sent") {
    eventType = "envio_resposta";
    const sentAt = !rnc.sentAt || occurredDate < rnc.sentAt ? occurredDate : rnc.sentAt;
    await db.update(rncs).set({ sentAt, status: "Respondida", updatedAt: new Date().toISOString() }).where(eq(rncs.id, rnc.id));
  } else if (rnc.sentAt && occurredDate >= rnc.sentAt) {
    eventType = "retorno_supervisao";
    const text = normalize(combined);
    const status = /reprov|nao aprov|reabert|correc/.test(text) ? "Reprovada" : /aprov|aceit|conform/.test(text) ? "Aprovada" : rnc.status;
    await db.update(rncs).set({ returnedAt: occurredDate, status, updatedAt: new Date().toISOString() }).where(eq(rncs.id, rnc.id));
  }

  const recipients = [...(message.toRecipients || []), ...(message.ccRecipients || [])]
    .map((item) => item.emailAddress?.address).filter(Boolean).join(", ");
  await db.insert(emailEvents).values({
    rncId: rnc.id,
    outlookMessageId: message.id,
    eventType,
    sender: message.sender?.emailAddress?.address || message.from?.emailAddress?.address,
    recipients,
    subject,
    summary: preview.slice(0, 1000),
    occurredAt,
    attachmentMetadata: message.hasAttachments ? JSON.stringify({ hasAttachments: true }) : null,
  }).onConflictDoNothing();
  return true;
}

async function syncFolder(accessToken: string, connectionId: number, folder: GraphFolder & { path: string }, kind: "inbox" | "sent") {
  const db = getDb();
  const [state] = await db.select().from(outlookSyncFolders).where(and(
    eq(outlookSyncFolders.connectionId, connectionId),
    eq(outlookSyncFolders.folderId, folder.id),
  )).limit(1);
  const days = Math.max(1, Math.min(3650, Number(process.env.OUTLOOK_INITIAL_SYNC_DAYS || 365)));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const select = "id,subject,bodyPreview,receivedDateTime,sentDateTime,sender,from,toRecipients,ccRecipients,hasAttachments";
  let url = state?.deltaLink || `/me/mailFolders/${encodeURIComponent(folder.id)}/messages/delta?$select=${select}&$filter=receivedDateTime ge ${since}`;
  let imported = 0;
  let deltaLink: string | undefined;
  do {
    const page: GraphPage<GraphMessage> = await graph(accessToken, url);
    const ordered = page.value.sort((a, b) =>
      String(a.sentDateTime || a.receivedDateTime).localeCompare(String(b.sentDateTime || b.receivedDateTime)));
    for (const message of ordered) if (await processMessage(message, kind)) imported++;
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

export async function synchronizeOutlook() {
  await ensureDatabase();
  const db = getDb();
  const [connection] = await db.select().from(outlookConnections).limit(1);
  if (!connection) throw new Error("Conecte primeiro a conta do Outlook.");
  if (connection.lastSyncAt && Date.now() - new Date(connection.lastSyncAt).getTime() < 60_000) {
    return { imported: 0, folders: 0, message: "Os e-mails já foram atualizados há menos de um minuto." };
  }
  const token = await refreshAccessToken(connection.encryptedRefreshToken);
  if (token.refresh_token) {
    await db.update(outlookConnections).set({ encryptedRefreshToken: encryptToken(token.refresh_token) })
      .where(eq(outlookConnections.id, connection.id));
  }
  try {
    const [inbox, sent] = await Promise.all([
      graph<GraphFolder>(token.access_token!, "/me/mailFolders/inbox?$select=id,displayName,childFolderCount"),
      graph<GraphFolder>(token.access_token!, "/me/mailFolders/sentitems?$select=id,displayName,childFolderCount"),
    ]);
    const nested = await childFolders(token.access_token!, inbox.id, inbox.displayName);
    const folders = [
      { ...inbox, path: inbox.displayName, kind: "inbox" as const },
      ...nested.map((folder) => ({ ...folder, kind: "inbox" as const })),
      { ...sent, path: sent.displayName, kind: "sent" as const },
    ];
    let imported = 0;
    for (const folder of folders) imported += await syncFolder(token.access_token!, connection.id, folder, folder.kind);
    const message = `${imported} e-mail(s) novo(s) importado(s) em ${folders.length} pasta(s).`;
    await db.update(outlookConnections).set({
      lastSyncAt: new Date().toISOString(), lastSyncStatus: "success", lastSyncMessage: message,
    }).where(eq(outlookConnections.id, connection.id));
    return { imported, folders: folders.length, message };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na sincronização.";
    await db.update(outlookConnections).set({
      lastSyncAt: new Date().toISOString(), lastSyncStatus: "error", lastSyncMessage: message,
    }).where(eq(outlookConnections.id, connection.id));
    throw error;
  }
}
