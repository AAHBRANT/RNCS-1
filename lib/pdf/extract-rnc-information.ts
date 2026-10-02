import { normalizeForSearch, normalizePdfText } from "./normalize-pdf-text";
import type { ExtractedRncInformation, ExtractionConfidence, RncAnalysisStatus } from "./types";

type PdfTable = string[][];

function normalizedCell(value: string) {
  return normalizeForSearch(value).replace(/\s*:\s*$/, "").trim();
}

function valueImmediatelyBelow(
  tables: PdfTable[],
  title: string,
  options: { skipSignature?: boolean } = {},
) {
  const expected = normalizedCell(title);
  for (const table of tables) {
    for (let row = 0; row < table.length - 1; row += 1) {
      for (let column = 0; column < table[row].length; column += 1) {
        if (normalizedCell(table[row][column] || "") !== expected) continue;
        const cell = String(table[row + 1]?.[column] || "");
        const contents = normalizePdfText(cell).split("\n").map((line) => line.trim()).filter(Boolean);
        const value = contents.find((line) =>
          !options.skipSignature || !/^ASSINATURA\s*:?\s*$/i.test(line),
        );
        return value || null;
      }
    }
  }
  return null;
}

function valueFromLayoutColumn(
  layoutText: string,
  title: string,
  options: { skipSignature?: boolean } = {},
) {
  const rows = layoutText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.split("\t").map((cell) => cell.trim()));
  if (!rows.some((row) => row.length > 1)) return null;
  const expected = normalizedCell(title);
  for (let row = 0; row < rows.length; row += 1) {
    for (let column = 0; column < rows[row].length; column += 1) {
      let heading = "";
      for (let headingRows = 0; headingRows < 3 && row + headingRows < rows.length; headingRows += 1) {
        const fragment = normalizedCell(rows[row + headingRows]?.[column] || "");
        if (!fragment) continue;
        heading = `${heading} ${fragment}`.trim();
        if (heading === expected) {
          for (let valueRow = row + headingRows + 1; valueRow < Math.min(rows.length, row + headingRows + 4); valueRow += 1) {
            const contents = normalizePdfText(rows[valueRow]?.[column] || "")
              .split("\n").map((line) => line.trim()).filter(Boolean);
            const value = contents.find((line) =>
              !options.skipSignature || !/^ASSINATURA\s*:?\s*$/i.test(line),
            );
            if (value) return value;
          }
          break;
        }
        if (!expected.startsWith(heading)) break;
      }
    }
  }
  return null;
}

function valueImmediatelyBelowAny(
  tables: PdfTable[],
  titles: string[],
  options: { skipSignature?: boolean } = {},
) {
  for (const title of titles) {
    const value = valueImmediatelyBelow(tables, title, options);
    if (value) return value;
  }
  return null;
}

function valueFromLayoutColumnAny(
  layoutText: string,
  titles: string[],
  options: { skipSignature?: boolean } = {},
) {
  for (const title of titles) {
    const value = valueFromLayoutColumn(layoutText, title, options);
    if (value) return value;
  }
  return null;
}

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
  if (/^(DATA|PRAZO|RNC|STATUS|DESCRIÇÃO|DESCRICAO|ASSINATURA|NÃO IDENTIFICADO|NAO IDENTIFICADO|RESPONS[ÁA]VEL.*|CONTRATO.*)$/i.test(cleaned)) return null;
  return cleaned;
}

function looksLikePersonName(value: string | null): value is string {
  if (!value || /\d/.test(value)) return false;
  const words = value.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.every((word) => /^[A-ZÀ-ÖØ-öø-ÿ.'-]+$/i.test(word));
}

function nextPersonName(lines: string[], start: number, stopLabels: RegExp[] = []) {
  for (let index = start; index < Math.min(lines.length, start + 8); index += 1) {
    const line = lines[index];
    if (stopLabels.some((label) => label.test(line))) break;
    if (/^(?:ASSINATURA|DATA|CARGO|FUNÇÃO|FUNCAO|CREA|MATRÍCULA|MATRICULA)\s*:?\s*$/i.test(line)) continue;
    const value = cleanResponsibleName(line);
    if (looksLikePersonName(value)) return value;
  }
  return null;
}

function extractInspectionPeople(text: string) {
  const lines = normalizePdfText(text).split("\n").map((line) => line.trim()).filter(Boolean);
  const areaSource = String.raw`RESPONS[ÁA]VEL\s+DA\s+[ÁA]REA(?:\s+INSPECIONADA)?`;
  const fiscalSource = String.raw`RESPONS[ÁA]VEL\s+FISCAL(?:\s+PELA\s+INSPE[CÇ][ÃA]O)?`;
  const areaLabel = new RegExp(`^${areaSource}\\s*:?\\s*$`, "i");
  const fiscalLabel = new RegExp(`^${fiscalSource}\\s*:?\\s*$`, "i");
  const areaInline = new RegExp(`${areaSource}\\s*:?\\s*(.+?)(?=${fiscalSource}|$)`, "i");
  const fiscalInline = new RegExp(`${fiscalSource}\\s*:?\\s*(.+)$`, "i");
  let responsible: string | null = null;
  let inspectionResponsible: string | null = null;
  let responsibleConfidence: ExtractionConfidence = "LOW";
  let inspectionConfidence: ExtractionConfidence = "LOW";

  for (const line of lines) {
    const areaMatch = line.match(areaInline);
    const areaCandidate = areaMatch?.[1] ? cleanResponsibleName(areaMatch[1]) : null;
    const areaValue = looksLikePersonName(areaCandidate) ? areaCandidate : null;
    if (areaValue) { responsible = areaValue; responsibleConfidence = "HIGH"; }
    const fiscalMatch = line.match(fiscalInline);
    const fiscalCandidate = fiscalMatch?.[1] ? cleanResponsibleName(fiscalMatch[1]) : null;
    const fiscalValue = looksLikePersonName(fiscalCandidate) ? fiscalCandidate : null;
    if (fiscalValue) { inspectionResponsible = fiscalValue; inspectionConfidence = "HIGH"; }
  }

  const areaIndex = lines.findIndex((line) => areaLabel.test(line));
  const fiscalIndex = lines.findIndex((line) => fiscalLabel.test(line));
  if (areaIndex >= 0 && fiscalIndex === areaIndex + 1) {
    const candidates = lines.slice(fiscalIndex + 1, fiscalIndex + 9)
      .map(cleanResponsibleName)
      .filter(looksLikePersonName);
    if (!responsible && candidates[0]) { responsible = candidates[0]; responsibleConfidence = "MEDIUM"; }
    if (!inspectionResponsible && candidates[1]) {
      inspectionResponsible = candidates[1];
      inspectionConfidence = "MEDIUM";
    }
  } else {
    if (!responsible && areaIndex >= 0) {
      const value = nextPersonName(lines, areaIndex + 1, [fiscalLabel]);
      if (value) { responsible = value; responsibleConfidence = "MEDIUM"; }
    }
    if (!inspectionResponsible && fiscalIndex >= 0) {
      const value = nextPersonName(lines, fiscalIndex + 1, [areaLabel]);
      if (value) { inspectionResponsible = value; inspectionConfidence = "MEDIUM"; }
    }
  }
  return {
    responsible: { value: responsible, confidence: responsibleConfidence },
    inspectionResponsible: { value: inspectionResponsible, confidence: inspectionConfidence },
  };
}

function extractContract(text: string): { value: string | null; confidence: ExtractionConfidence } {
  const lines = normalizePdfText(text).split("\n").map((line) => line.trim()).filter(Boolean);
  const index = lines.findIndex((line) => /^(?:N[º°O.]?\s*(?:DO\s*)?)?CONTRATO\s*:?\s*$/i.test(line));
  if (index >= 0) {
    const value = lines[index + 1]?.trim().replace(/[|;]+.*$/, "").replace(/[.,:;-]+$/, "");
    if (value && value.length <= 100 && /\d/.test(value) && !/^RESPONS[ÁA]VEL/i.test(value)) {
      return { value, confidence: "HIGH" };
    }
  }
  return { value: null, confidence: "LOW" };
}

function extractAnalysisReviewer(text: string): {
  value: string | null;
  confidence: ExtractionConfidence;
} {
  const lines = normalizePdfText(text).split("\n").map((line) => line.trim()).filter(Boolean);
  const reviewerLabel = String.raw`REVISOR\s+DA\s+ELABORA[ÇC][ÃA]O\s+DO\s+RNC`;
  const inline = new RegExp(`${reviewerLabel}\\s*:?\\s*(.+)$`, "i");
  for (const line of lines) {
    const match = line.match(inline);
    const value = match?.[1] ? cleanResponsibleName(match[1]) : null;
    if (value) return { value, confidence: "HIGH" };
  }
  const label = new RegExp(`^${reviewerLabel}\\s*:?\\s*$`, "i");
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!label.test(lines[index])) continue;
    const value = nextPersonName(lines, index + 1);
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
    /\bOBJETO\s+DE\s+APROVACAO\b/,
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

function extractOccurrenceType(tables: PdfTable[], layoutText: string, rawText: string): { value: string | null; confidence: ExtractionConfidence } {
  const text = layoutText || rawText;
  const value = valueImmediatelyBelow(tables, "TIPO DE OCORRÊNCIA")
    || valueFromLayoutColumn(text, "TIPO DE OCORRÊNCIA");
  if (value) return { value: value.trim(), confidence: "HIGH" };
  const match = text.match(/TIPO\s+DE\s+OCORR[ÊE]NCIA\s*:?\s*\n\s*([^\n\t]+)/i);
  if (match?.[1]) return { value: match[1].trim(), confidence: "HIGH" };
  return { value: null, confidence: "LOW" };
}

function extractOccurrenceDescription(tables: PdfTable[], layoutText: string, rawText: string): { value: string | null; confidence: ExtractionConfidence } {
  const text = layoutText || rawText;
  const value = valueImmediatelyBelow(tables, "CARACTERIZAÇÃO DA OCORRÊNCIA")
    || valueFromLayoutColumn(text, "CARACTERIZAÇÃO DA OCORRÊNCIA");
  if (value) return { value: value.trim(), confidence: "HIGH" };
  const match = text.match(/CARACTERIZA[CÇ][ÃA]O\s+DA\s+OCORR[ÊE]NCIA\s*:?\s*\n\s*([^\n\t]+)/i);
  if (match?.[1]) return { value: match[1].trim(), confidence: "HIGH" };
  return { value: null, confidence: "LOW" };
}

function extractInspectionDate(tables: PdfTable[], layoutText: string, rawText: string): { value: string | null; confidence: ExtractionConfidence } {
  const text = layoutText || rawText;
  const dateStr = valueImmediatelyBelow(tables, "DATA DA INSPEÇÃO")
    || valueFromLayoutColumn(text, "DATA DA INSPEÇÃO");
  let foundDate = dateStr;
  if (!foundDate) {
    const match = text.match(/DATA\s+DA\s+INSPE[CÇ][ÃA]O\s*:?\s*\n\s*(\d{2}\/\d{2}\/\d{4})/i);
    foundDate = match?.[1] ?? null;
  }
  if (!foundDate) return { value: null, confidence: "LOW" };
  const dateMatch = foundDate.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!dateMatch) return { value: null, confidence: "LOW" };
  const [, day, month, year] = dateMatch;
  return { value: `${year}-${month}-${day}`, confidence: "HIGH" };
}

function extractIssuedDate(tables: PdfTable[], layoutText: string, rawText: string): { value: string | null; confidence: ExtractionConfidence } {
  const titles = ["DATA DE EMISSÃO DA TRATATIVA", "DATA DE EMISSÃO"];
  const text = layoutText || rawText;
  const dateStr = valueImmediatelyBelowAny(tables, titles) || valueFromLayoutColumnAny(text, titles);
  let foundDate = dateStr;
  if (!foundDate) {
    const match = text.match(/DATA\s+DE\s+EMISS[ÃA]O(?:\s+DA\s+TRATATIVA)?\s*:?\s*\n\s*(\d{2}\/\d{2}\/\d{4})/i);
    foundDate = match?.[1] ?? null;
  }
  if (!foundDate) return { value: null, confidence: "LOW" };
  const dateMatch = foundDate.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!dateMatch) return { value: null, confidence: "LOW" };
  const [, day, month, year] = dateMatch;
  return { value: `${year}-${month}-${day}`, confidence: "HIGH" };
}

function extractServiceLocation(tables: PdfTable[], layoutText: string, rawText: string): { value: string | null; confidence: ExtractionConfidence } {
  const titles = ["LOCAL/FRENTE DE SERVIÇO", "LOCAL OU FRENTE DE SERVIÇO", "FRENTE DE SERVIÇO", "LOCAL"];
  const text = layoutText || rawText;
  const value = valueImmediatelyBelowAny(tables, titles) || valueFromLayoutColumnAny(text, titles);
  if (value) return { value: value.trim(), confidence: "HIGH" };
  const match = text.match(/(?:LOCAL\s*\/?\s*FRENTE\s+DE\s+SERVI[ÇC]O|FRENTE\s+DE\s+SERVI[ÇC]O|LOCAL)\s*:?\s*\n\s*([^\n\t]+)/i);
  if (match?.[1]) return { value: match[1].trim(), confidence: "HIGH" };
  return { value: null, confidence: "LOW" };
}

export function extractRncInformation(
  rawText: string,
  tables: PdfTable[] = [],
  layoutText = "",
): ExtractedRncInformation {
  const rnc = extractRncNumber(rawText);
  const people = extractInspectionPeople(rawText);
  const contract = extractContract(rawText);
  const analysisReviewer = extractAnalysisReviewer(rawText);
  const analysis = extractAnalysisStatus(rawText);
  const hasStructuredTables = tables.length > 0 || layoutText.split(/\r?\n/).some((line) => line.includes("\t"));
  const structuredResponsible = valueImmediatelyBelowAny(tables, ["RESPONSÁVEL DA ÁREA INSPECIONADA", "RESPONSÁVEL DA ÁREA"])
    || valueFromLayoutColumnAny(layoutText, ["RESPONSÁVEL DA ÁREA INSPECIONADA", "RESPONSÁVEL DA ÁREA"]);
  const structuredFiscal = valueImmediatelyBelowAny(tables, ["RESPONSÁVEL FISCAL PELA INSPEÇÃO", "RESPONSÁVEL FISCAL"])
    || valueFromLayoutColumnAny(layoutText, ["RESPONSÁVEL FISCAL PELA INSPEÇÃO", "RESPONSÁVEL FISCAL"]);
  const structuredContract = valueImmediatelyBelowAny(tables, ["CONTRATO", "Nº DO CONTRATO", "NÚMERO DO CONTRATO"])
    || valueFromLayoutColumnAny(layoutText, ["CONTRATO", "Nº DO CONTRATO", "NÚMERO DO CONTRATO"]);
  const structuredReviewer = valueImmediatelyBelow(
    tables, "REVISOR DA ELABORAÇÃO DO RNC", { skipSignature: true },
  ) || valueFromLayoutColumn(
    layoutText, "REVISOR DA ELABORAÇÃO DO RNC", { skipSignature: true },
  );
  const responsible = structuredResponsible
    ? cleanResponsibleName(structuredResponsible)
    : hasStructuredTables ? null : people.responsible.value;
  const inspectionResponsible = structuredFiscal
    ? cleanResponsibleName(structuredFiscal)
    : hasStructuredTables ? null : people.inspectionResponsible.value;
  const contractValue = structuredContract?.trim() || (hasStructuredTables ? null : contract.value);
  const reviewerValue = structuredReviewer
    ? cleanResponsibleName(structuredReviewer)
    : hasStructuredTables ? null : analysisReviewer.value;
  const occurrenceType = extractOccurrenceType(tables, layoutText, rawText);
  const occurrenceDescription = extractOccurrenceDescription(tables, layoutText, rawText);
  const inspectionDate = extractInspectionDate(tables, layoutText, rawText);
  const issuedDate = extractIssuedDate(tables, layoutText, rawText);
  const serviceLocation = extractServiceLocation(tables, layoutText, rawText);
  return {
    rncNumber: rnc.number,
    year: rnc.year,
    responsible,
    inspectionResponsible,
    contract: contractValue,
    analysisReviewer: reviewerValue,
    analysisStatus: analysis.status,
    matchedStatusText: analysis.matchedText,
    occurrenceType: occurrenceType.value,
    occurrenceDescription: occurrenceDescription.value,
    inspectionDate: inspectionDate.value,
    issuedAt: issuedDate.value,
    serviceLocation: serviceLocation.value,
    extractedText: normalizePdfText(rawText),
    extractionMethod: "PDF_TEXT",
    confidence: {
      rncNumber: rnc.confidence,
      responsible: structuredResponsible ? "HIGH" : hasStructuredTables ? "LOW" : people.responsible.confidence,
      inspectionResponsible: structuredFiscal ? "HIGH" : hasStructuredTables ? "LOW" : people.inspectionResponsible.confidence,
      contract: structuredContract ? "HIGH" : hasStructuredTables ? "LOW" : contract.confidence,
      analysisReviewer: structuredReviewer ? "HIGH" : hasStructuredTables ? "LOW" : analysisReviewer.confidence,
      analysisStatus: analysis.confidence,
      occurrenceType: occurrenceType.confidence,
      occurrenceDescription: occurrenceDescription.confidence,
      inspectionDate: inspectionDate.confidence,
      issuedAt: issuedDate.confidence,
      serviceLocation: serviceLocation.confidence,
    },
  };
}
