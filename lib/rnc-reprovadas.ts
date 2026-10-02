// Motivo da reprovação: texto do campo "INFORMAÇÕES COMPLEMENTARES DA VERIFICAÇÃO DA RNC" do FG 14
// (Análise de Tratativa) enviado pela Supervisão. Se não houver FG 14 legível, cai para o corpo do e-mail.

export type ReasonEvent = { occurredAt: string; summary: string | null; attachmentMetadata: string | null };
export type ReasonRnc = { number: string; year: number };
export type RejectionReason = { text: string; source: "FG 14" | "E-mail" | "Não localizado" };

const FOLD: Record<string, string> = {
  á: "a", à: "a", â: "a", ã: "a", é: "e", ê: "e", í: "i", ó: "o", ô: "o", õ: "o", ú: "u", ç: "c",
};
const fold = (value: string) => value.toLowerCase().replace(/[áàâãéêíóôõúç]/g, (char) => FOLD[char]);

type Attachment = { name?: string; extractedText?: string };

function attachmentsOf(event: ReasonEvent): Attachment[] {
  try {
    const list = JSON.parse(event.attachmentMetadata || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const isFg14 = (attachment: Attachment) => /fg\s*-?\s*14/i.test(attachment.name || "") && Boolean(attachment.extractedText?.trim());

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
  for (const event of ordered) {
    const fg14 = attachmentsOf(event).filter(isFg14);
    const own = fg14.find((attachment) => mentionsRnc(attachment, rnc)) ?? (fg14.length === 1 ? fg14[0] : undefined);
    if (!own) continue;
    const text = extractFg14Reason(own.extractedText!);
    if (text) return { text, source: "FG 14" };
  }
  const withSummary = ordered.find((event) => event.summary?.trim());
  if (withSummary) {
    const summary = withSummary.summary!.replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
    // Corpo padrão do e-mail: a parte útil começa em "Constatou-se"/"Após verificação".
    const useful = /(?:Após verificação|Constatou-se).*/i.exec(summary)?.[0] ?? summary;
    return { text: useful, source: "E-mail" };
  }
  return { text: "Motivo não localizado nos documentos da Supervisão.", source: "Não localizado" };
}
