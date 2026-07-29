import { normalizePdfText } from "./normalize-pdf-text";

export interface PdfTextExtractionResult {
  text: string;
  pageCount: number;
  hasUsefulText: boolean;
}

export async function extractPdfText(pdfBuffer: Buffer): Promise<PdfTextExtractionResult> {
  if (!pdfBuffer.length) throw new Error("O arquivo PDF está vazio.");

  // Loading pdf-parse only inside the request avoids evaluating its worker
  // bootstrap while a Vercel route module is being initialized.
  const module = await import("pdf-parse");
  const parser = new module.PDFParse({ data: new Uint8Array(pdfBuffer) });
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
