// Motivo da reprovação: texto do campo "INFORMAÇÕES COMPLEMENTARES DA VERIFICAÇÃO DA RNC" do FG 14
// (Análise de Tratativa) enviado pela Supervisão. O corpo do e-mail não é usado: ele é igual para todas as RNCs.

export type ReasonEvent = { id: number; occurredAt: string; summary: string | null; attachmentMetadata: string | null };
export type ReasonRnc = { number: string; year: number };
export type RejectionDocument = { eventId: number; attachmentId: string; name: string };
export type RejectionReason = { text: string; source: "FG 14" | "Não localizado"; document: RejectionDocument | null };

const FOLD: Record<string, string> = {
  á: "a", à: "a", â: "a", ã: "a", é: "e", ê: "e", í: "i", ó: "o", ô: "o", õ: "o", ú: "u", ç: "c",
};
const fold = (value: string) => value.toLowerCase().replace(/[áàâãéêíóôõúç]/g, (char) => FOLD[char]);

type Attachment = { id?: string; name?: string; extractedText?: string };

function attachmentsOf(event: ReasonEvent): Attachment[] {
  try {
    const list = JSON.parse(event.attachmentMetadata || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const isFg14Name = (attachment: Attachment) => /fg[\s_-]*14/i.test(attachment.name || "");

function mentionsRnc(attachment: Attachment, rnc: ReasonRnc) {
  const target = parseInt(rnc.number, 10);
  const haystack = `${attachment.name || ""}\n${(attachment.extractedText || "").slice(0, 1500)}`;
  return [...haystack.matchAll(/(\d{1,4})\s*[_/]\s*(20\d{2})/g)].some(([, n, y]) => parseInt(n, 10) === target && parseInt(y, 10) === rnc.year);
}

export function extractFg14Reason(rawText: string): string {
  const text = rawText.normalize("NFC").replace(/\r\n/g, "\n");
  const folded = fold(text);
  const heading = /informacoes complementares[^\n]*\n/.exec(folded);
  if (!heading) return "";
  const start = heading.index + heading[0].length;
  const rest = folded.slice(start);
  const ends = [/\n\s*assinaturas\b/, /\n\s*-- \d+ of \d+ --/, /\n\s*formulario geral/, /\n\s*responsavel pela inspecao/]
    .map((pattern) => pattern.exec(rest)?.index)
    .filter((index): index is number => index !== undefined);
  const end = ends.length ? Math.min(...ends) : rest.length;
  const lines = text.slice(start, start + end).split("\n").map((line) => line.trim());

  // Junta as quebras de linha do PDF; parágrafo novo quando a linha anterior fechou a frase.
  const paragraphs: string[] = [];
  let current = "";
  for (const line of lines) {
    if (!line) continue;
    current = current ? `${current} ${line}` : line;
    if (/[.:;]$/.test(line) && line.length < 90) {
      paragraphs.push(current);
      current = "";
    }
  }
  if (current) paragraphs.push(current);
  return paragraphs.join("\n\n").trim();
}

export function rejectionReason(rnc: ReasonRnc, events: ReasonEvent[]): RejectionReason {
  const ordered = [...events].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)); // mais recente primeiro
  let document: RejectionDocument | null = null;
  for (const event of ordered) {
    const fg14 = attachmentsOf(event).filter((attachment) => isFg14Name(attachment) && attachment.id);
    const own = fg14.find((attachment) => mentionsRnc(attachment, rnc)) ?? (fg14.length === 1 ? fg14[0] : undefined);
    if (!own) continue;
    document ??= { eventId: event.id, attachmentId: own.id!, name: own.name || "FG 14.pdf" };
    const text = own.extractedText?.trim() ? extractFg14Reason(own.extractedText) : "";
    if (text) return { text, source: "FG 14", document: { eventId: event.id, attachmentId: own.id!, name: own.name || "FG 14.pdf" } };
  }
  if (document) {
    return { text: "O FG 14 desta RNC é uma imagem (sem texto que o sistema consiga ler). Use o botão de visualizar para abrir o documento.", source: "Não localizado", document };
  }
  return { text: "FG 14 não localizado nos e-mails da Supervisão.", source: "Não localizado", document: null };
}
