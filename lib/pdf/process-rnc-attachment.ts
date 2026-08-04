import { extractPdfText } from "./extract-pdf-text";
import { extractRncInformation } from "./extract-rnc-information";
import type { ExtractedRncInformation, ProcessRncAttachmentResult } from "./types";

const DIAGNOSTIC_FIELDS = [
  "rncNumber", "responsible", "inspectionResponsible", "contract",
  "analysisReviewer", "occurrenceType", "occurrenceDescription", "inspectionDate",
  "issuedAt", "serviceLocation",
] as const;

function logExtractionDiagnostics(fileName: string, information: ExtractedRncInformation) {
  const notIdentified: string[] = [];
  const identified: Array<{ field: string; confidence: string }> = [];
  for (const field of DIAGNOSTIC_FIELDS) {
    const value = information[field];
    const confidence = information.confidence[field];
    if (value === null || value === "") notIdentified.push(field);
    else identified.push({ field, confidence });
  }
  console.log(
    `[extração PDF] arquivo="${fileName}" identificados=${JSON.stringify(identified)} naoIdentificados=${JSON.stringify(notIdentified)}`,
  );
}

export async function processRncAttachment(params: {
  fileName: string;
  contentType?: string | null;
  contentBuffer: Buffer;
}): Promise<ProcessRncAttachmentResult> {
  const isPdf = params.contentType?.toLowerCase() === "application/pdf"
    || params.fileName.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    return {
      success: false, needsOcr: false, fileName: params.fileName, pageCount: 0,
      information: null, error: "O anexo não é um arquivo PDF.",
    };
  }
  try {
    const extraction = await extractPdfText(params.contentBuffer);
    if (!extraction.hasUsefulText) {
      return {
        success: false, needsOcr: true, fileName: params.fileName,
        pageCount: extraction.pageCount, information: null,
        error: "PDF sem texto pesquisável — leitura OCR necessária.",
      };
    }
    const information = extractRncInformation(extraction.text, extraction.tables, extraction.layoutText);
    logExtractionDiagnostics(params.fileName, information);
    return {
      success: true, needsOcr: false, fileName: params.fileName,
      pageCount: extraction.pageCount,
      information, error: null,
    };
  } catch (error) {
    return {
      success: false, needsOcr: false, fileName: params.fileName, pageCount: 0,
      information: null,
      error: error instanceof Error ? error.message : "Erro desconhecido ao processar o PDF.",
    };
  }
}

export async function extractTextWithOcr(): Promise<string> {
  throw new Error("OCR ainda não configurado.");
}
