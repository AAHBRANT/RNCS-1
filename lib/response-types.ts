export const RESPONSE_TYPES = ["TRATATIVA", "PAM"] as const;
export type ResponseType = (typeof RESPONSE_TYPES)[number];

export const RESPONSE_TYPE_LABELS: Record<ResponseType, string> = {
  TRATATIVA: "Tratativa",
  PAM: "PAM",
};

export const PAM_TYPOLOGIES = ["Meio Ambiente", "Seg. Trabalho", "Engenharia", "Social", "Outros"] as const;
export type PamTypology = (typeof PAM_TYPOLOGIES)[number];

export type PamFormData = {
  contract: string;
  typologies: PamTypology[];
  occurrenceDescription: string;
  improvementProposal: string;
  date: string;
  responsible: string;
  deadline: string;
};

export const emptyPamFormData: PamFormData = {
  contract: "",
  typologies: [],
  occurrenceDescription: "",
  improvementProposal: "",
  date: "",
  responsible: "",
  deadline: "",
};

export function normalizeResponseType(value: unknown): ResponseType {
  return String(value ?? "").toUpperCase() === "PAM" ? "PAM" : "TRATATIVA";
}

export function sanitizePamFormData(value: unknown): PamFormData {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const text = (key: keyof PamFormData) => String(source[key] ?? "").slice(0, 20_000);
  const typologies = Array.isArray(source.typologies)
    ? PAM_TYPOLOGIES.filter((option) => (source.typologies as unknown[]).map(String).includes(option))
    : [];
  return {
    contract: text("contract"),
    typologies,
    occurrenceDescription: text("occurrenceDescription"),
    improvementProposal: text("improvementProposal"),
    date: text("date").slice(0, 40),
    responsible: text("responsible").slice(0, 200),
    deadline: text("deadline").slice(0, 200),
  };
}

export function parsePamFormData(raw: string | null | undefined): PamFormData {
  try {
    return sanitizePamFormData(JSON.parse(raw || "{}"));
  } catch {
    return { ...emptyPamFormData };
  }
}

export function responseLabel(type: ResponseType, version: number) {
  return `${RESPONSE_TYPE_LABELS[type]} V${version}`;
}
