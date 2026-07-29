import { normalizePdfText } from "./normalize-pdf-text";

export interface PdfTextExtractionResult {
  text: string;
  tables: string[][][];
  pageCount: number;
  hasUsefulText: boolean;
}

export async function extractPdfText(pdfBuffer: Buffer): Promise<PdfTextExtractionResult> {
  if (!pdfBuffer.length) throw new Error("O arquivo PDF está vazio.");

  // Loading pdf-parse only inside the request avoids evaluating its worker
  // bootstrap while a Vercel route module is being initialized.
  // The worker module also installs the DOMMatrix, Path2D and ImageData
  // implementations required by PDF.js in a Node/Vercel environment.
  await import("pdf-parse/worker");
  const module = await import("pdf-parse");
  const parser = new module.PDFParse({ data: new Uint8Array(pdfBuffer) });
  try {
    const result = await parser.getText();
    const tableResult = await parser.getTable();
    const text = normalizePdfText(result.text || "");
    return {
      text,
      tables: tableResult.pages.flatMap((page) => page.tables),
      pageCount: result.pages?.length || 0,
      hasUsefulText: text.replace(/\s/g, "").length >= 30,
    };
  } finally {
    await parser.destroy();
  }
}
