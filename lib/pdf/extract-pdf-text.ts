import { PDFParse } from "pdf-parse";
import { normalizePdfText } from "./normalize-pdf-text";

export interface PdfTextExtractionResult {
  text: string;
  pageCount: number;
  hasUsefulText: boolean;
}

export async function extractPdfText(pdfBuffer: Buffer): Promise<PdfTextExtractionResult> {
  if (!pdfBuffer.length) throw new Error("O arquivo PDF está vazio.");

  const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) });
  try {
    const result = await parser.getText();
    const text = normalizePdfText(result.text || "");
    return {
      text,
      pageCount: result.pages?.length || 0,
      hasUsefulText: text.replace(/\s/g, "").length >= 30,
    };
  } finally {
    await parser.destroy();
  }
}
