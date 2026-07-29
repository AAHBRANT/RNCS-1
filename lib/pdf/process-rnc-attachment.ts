import { extractPdfText } from "./extract-pdf-text";
import { extractRncInformation } from "./extract-rnc-information";
import type { ProcessRncAttachmentResult } from "./types";

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
    return {
      success: true, needsOcr: false, fileName: params.fileName,
      pageCount: extraction.pageCount,
      information: extractRncInformation(extraction.text, extraction.tables), error: null,
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
