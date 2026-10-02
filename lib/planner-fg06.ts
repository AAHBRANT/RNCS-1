// Leitura do texto extraído de um FG 06 (Plano de Ação de Melhoria) anexado a um e-mail enviado.
// Os PDFs variam de layout (o bloco de revisão pode vir antes ou depois do corpo), então a leitura
// se apoia nos rótulos do formulário, não na posição.

const FOLD: Record<string, string> = {
  á: "a", à: "a", â: "a", ã: "a", ä: "a", é: "e", è: "e", ê: "e", ë: "e", í: "i", ì: "i", î: "i", ï: "i",
  ó: "o", ò: "o", ô: "o", õ: "o", ö: "o", ú: "u", ù: "u", û: "u", ü: "u", ç: "c", ñ: "n",
};
// Minúsculas sem acentos, com o mesmo comprimento do original (índices alinhados).
const fold = (value: string) => value.toLowerCase().replace(/[áàâãäéèêëíìîïóòôõöúùûüçñ]/g, (char) => FOLD[char]);

export type Fg06Parsed = {
  rncNumber: string | null;
  rncYear: number | null;
  typologies: string[];
  occurrence: string;
  proposal: string;
  deadline: string;
  documentDate: string | null;
  responsible: string;
};

export function looksLikeFg06Name(name: string) {
  return /fg\s*-?\s*06/i.test(name) && /pam|plano\s+de\s+(?:a[cç][aã]o\s+de\s+)?melhoria/i.test(name);
}

const TYPOLOGY_LABELS: Array<[string, string]> = [
  ["Meio Ambiente", "meio ambiente"],
  ["Seg. Trabalho", "seg\\.? trabalho"],
  ["Engenharia", "engenharia"],
  ["Social", "social"],
  ["Outros", "outros"],
];

export function parseFg06(rawText: string): Fg06Parsed {
  const text = rawText.normalize("NFC").replace(/\r\n/g, "\n");
  const folded = fold(text);

  const rnc = /n[o°º]?\s*da\s*rnc\s*:?\s*(\d{1,4})\s*\/\s*(\d{4})/.exec(folded);

  const typologyStart = folded.indexOf("tipologia da ocorrencia");
  const typologyLine = typologyStart >= 0 ? folded.slice(typologyStart, typologyStart + 400) : "";
  const typologies = TYPOLOGY_LABELS
    .filter(([, pattern]) => new RegExp(`${pattern}\\s*:\\s*\\(\\s*x\\s*\\)`).test(typologyLine))
    .map(([label]) => label);

  const headingProposal = /descricao da proposta de melhoria[^\n]*\n/.exec(folded);
  const headingOccurrence = /descricao da ocorrencia[^\n]*\n/.exec(folded);
  const dataLine = /\bdata\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(folded);
  const deadlineLine = /prazo para o pam\s*:?[ \t]*([^\n]*)/.exec(folded);

  const proposalStart = headingProposal ? headingProposal.index + headingProposal[0].length : -1;
  const proposalEnd = [dataLine?.index, deadlineLine?.index].filter((value): value is number => value !== undefined && proposalStart >= 0 && value > proposalStart).sort((a, b) => a - b)[0] ?? text.length;
  const occurrenceStart = headingOccurrence ? headingOccurrence.index + headingOccurrence[0].length : -1;
  const occurrenceEnd = headingProposal && occurrenceStart >= 0 && headingProposal.index > occurrenceStart ? headingProposal.index : text.length;

  const responsibleMatch = dataLine ? /respons[aá]vel\s*:\s*([^\n]*)/i.exec(text.slice(dataLine.index, dataLine.index + 200)) : null;
  const responsible = responsibleMatch ? responsibleMatch[1].trim() : "";

  return {
    rncNumber: rnc ? rnc[1].padStart(3, "0") : null,
    rncYear: rnc ? Number(rnc[2]) : null,
    typologies,
    occurrence: occurrenceStart >= 0 ? text.slice(occurrenceStart, occurrenceEnd).trim() : "",
    proposal: proposalStart >= 0 ? text.slice(proposalStart, proposalEnd).trim() : "",
    deadline: deadlineLine ? text.slice(deadlineLine.index + deadlineLine[0].length - deadlineLine[1].length, deadlineLine.index + deadlineLine[0].length).trim() : "",
    documentDate: dataLine ? `${dataLine[3]}-${dataLine[2]}-${dataLine[1]}` : null,
    responsible,
  };
}
