export type ExtractionConfidence = "HIGH" | "MEDIUM" | "LOW";

export type RncAnalysisStatus =
  | "APROVADA"
  | "REPROVADA"
  | "STATUS_A_CONFIRMAR";

export interface ExtractedRncInformation {
  rncNumber: string | null;
  year: number | null;
  responsible: string | null;
  inspectionResponsible: string | null;
  contract: string | null;
  analysisReviewer: string | null;
  analysisStatus: RncAnalysisStatus;
  matchedStatusText: string | null;
  occurrenceType: string | null;
  occurrenceDescription: string | null;
  inspectionDate: string | null;
  extractedText: string;
  extractionMethod: "PDF_TEXT" | "OCR" | "NONE";
  confidence: {
    rncNumber: ExtractionConfidence;
    responsible: ExtractionConfidence;
    inspectionResponsible: ExtractionConfidence;
    contract: ExtractionConfidence;
    analysisReviewer: ExtractionConfidence;
    analysisStatus: ExtractionConfidence;
    occurrenceType: ExtractionConfidence;
    occurrenceDescription: ExtractionConfidence;
    inspectionDate: ExtractionConfidence;
  };
}

export interface ProcessRncAttachmentResult {
  success: boolean;
  needsOcr: boolean;
  fileName: string;
  pageCount: number;
  information: ExtractedRncInformation | null;
  error: string | null;
}
