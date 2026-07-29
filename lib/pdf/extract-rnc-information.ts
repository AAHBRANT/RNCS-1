import { normalizeForSearch, normalizePdfText } from "./normalize-pdf-text";
import type { ExtractedRncInformation, ExtractionConfidence, RncAnalysisStatus } from "./types";

function extractRncNumber(text: string): {
  number: string | null;
  year: number | null;
  confidence: ExtractionConfidence;
} {
  const normalized = normalizeForSearch(text);
  const patterns = [
    /\bRNC\s*(?:N[º°O.]?|NUMERO)?\s*[-–—:#]?\s*(\d{1,5})(?:\s*[/.-]\s*(20\d{2}))?\b/i,
    /\bRELATORIO\s+DE\s+NAO\s+CONFORMIDADE(?:S)?\s*(?:N[º°O.]?)?\s*[-–—:#]?\s*(\d{1,5})(?:\s*[/.-]\s*(20\d{2}))?\b/i,
    /\bANALISE\s+DE\s+TRATATIVA\s+DO\s+RNC\s*[-–—:#]?\s*(\d{1,5})(?:\s*[/.-]\s*(20\d{2}))?\b/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      return {
        number: match[1].padStart(3, "0"),
        year: match[2] ? Number(match[2]) : null,
        confidence: "HIGH",
      };
    }
  }
  return { number: null, year: null, confidence: "LOW" };
}

function cleanResponsibleName(value: string) {
  const cleaned = value
    .replace(/\s+/g, " ")
    .replace(/^(?:NOME|RESPONSÁVEL|RESPONSAVEL|PELA TRATATIVA|PELA RESPOSTA)\s*:?\s*/i, "")
    .replace(/[|;]+.*$/, "")
    .trim()
    .replace(/[.,:;-]+$/, "");
  if (cleaned.length < 3 || cleaned.length > 100) return null;
  if (/^(DATA|PRAZO|RNC|STATUS|DESCRIÇÃO|DESCRICAO|ASSINATURA|NÃO IDENTIFICADO|NAO IDENTIFICADO)$/i.test(cleaned)) return null;
  return cleaned;
}

function extractResponsible(text: string): {
  value: string | null;
  confidence: ExtractionConfidence;
} {
  const lines = normalizePdfText(text).split("\n").map((line) => line.trim()).filter(Boolean);
  const inlinePatterns = [
    /RESPONS[ÁA]VEL\s+PELA\s+RESPOSTA\s*:?\s*(.+)$/i,
    /RESPONS[ÁA]VEL\s+PELA\s+TRATATIVA\s*:?\s*(.+)$/i,
    /RESPONS[ÁA]VEL\s+PELO\s+ATENDIMENTO\s*:?\s*(.+)$/i,
    /RESPONS[ÁA]VEL\s+PELA\s+CORRE[ÇC][ÃA]O\s*:?\s*(.+)$/i,
    /RESPONS[ÁA]VEL\s+(?:CONTRATADA|CONS[ÓO]RCIO)\s*:?\s*(.+)$/i,
    /^RESPONS[ÁA]VEL\s*:?\s*(.+)$/i,
  ];
  for (const line of lines) {
    for (const pattern of inlinePatterns) {
      const match = line.match(pattern);
      const value = match?.[1] ? cleanResponsibleName(match[1]) : null;
      if (value) return { value, confidence: "HIGH" };
    }
  }
  const label = /^RESPONS[ÁA]VEL(?:\s+(?:PELA\s+(?:RESPOSTA|TRATATIVA|CORRE[ÇC][ÃA]O)|PELO\s+ATENDIMENTO))?\s*:?\s*$/i;
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!label.test(lines[index])) continue;
    const value = cleanResponsibleName(lines[index + 1]);
    if (value) return { value, confidence: "MEDIUM" };
  }
  return { value: null, confidence: "LOW" };
}

function extractAnalysisStatus(text: string): {
  status: RncAnalysisStatus;
  matchedText: string | null;
  confidence: ExtractionConfidence;
} {
  const normalized = normalizeForSearch(text);
  const rejectionPatterns = [
    /\bTRATATIVA\s+REPROVADA\b/, /\bRESPOSTA\s+REPROVADA\b/, /\bNAO\s+APROVADA\b/,
    /\bNAO\s+ATENDIDA\b/, /\bTRATATIVA\s+NAO\s+(?:ATENDIDA|ACEITA)\b/,
    /\bPENDENCIA\s+PERMANECE\b/, /\bNECESSITA\s+(?:DE\s+)?CORRECAO\b/,
    /\bDEVERA\s+SER\s+REENVIADA\b/, /\bSOLICITA-SE\s+REENVIO\b/,
  ];
  const approvalPatterns = [
    /\bTRATATIVA\s+APROVADA\b/, /\bRESPOSTA\s+APROVADA\b/,
    /\bCONSIDERADA\s+ATENDIDA\b/, /\bTRATATIVA\s+ATENDIDA\b/,
    /\bRNC\s+ATENDIDA\b/, /\bRNC\s+ENCERRADA\b/,
    /\bPENDENCIA\s+SANADA\b/, /\bSEM\s+PENDENCIAS\b/,
  ];
  for (const pattern of rejectionPatterns) {
    const match = normalized.match(pattern);
    if (match) return { status: "REPROVADA", matchedText: match[0], confidence: "HIGH" };
  }
  for (const pattern of approvalPatterns) {
    const match = normalized.match(pattern);
    if (match) return { status: "APROVADA", matchedText: match[0], confidence: "HIGH" };
  }
  const rejected = /\bREPROVADA\b/.test(normalized);
  const approved = /\bAPROVADA\b/.test(normalized);
  if (rejected !== approved) {
    return {
      status: rejected ? "REPROVADA" : "APROVADA",
      matchedText: rejected ? "REPROVADA" : "APROVADA",
      confidence: "MEDIUM",
    };
  }
  return { status: "STATUS_A_CONFIRMAR", matchedText: null, confidence: "LOW" };
}

export function extractRncInformation(rawText: string): ExtractedRncInformation {
  const rnc = extractRncNumber(rawText);
  const responsible = extractResponsible(rawText);
  const analysis = extractAnalysisStatus(rawText);
  return {
    rncNumber: rnc.number,
    year: rnc.year,
    responsible: responsible.value,
    analysisStatus: analysis.status,
    matchedStatusText: analysis.matchedText,
    extractedText: normalizePdfText(rawText),
    extractionMethod: "PDF_TEXT",
    confidence: {
      rncNumber: rnc.confidence,
      responsible: responsible.confidence,
      analysisStatus: analysis.confidence,
    },
  };
}
