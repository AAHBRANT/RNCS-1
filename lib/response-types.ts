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

export const STATUS_REJECTED_AWAITING = "Reprovada – aguardando nova resposta";
export const STATUS_TRATATIVA_DRAFTING = "Tratativa em elaboração";
export const STATUS_TRATATIVA_RESENT = "Tratativa reenviada – aguardando análise";
export const STATUS_PAM_DRAFTING = "PAM em elaboração";
export const STATUS_PAM_SENT = "PAM enviado – aguardando análise";

export const RESPONSE_FLOW_STATUSES = [
  STATUS_REJECTED_AWAITING,
  STATUS_TRATATIVA_DRAFTING,
  STATUS_TRATATIVA_RESENT,
  STATUS_PAM_DRAFTING,
  STATUS_PAM_SENT,
] as const;

export function isRejectedStatus(status: string) {
  return status === "Reprovada" || status === STATUS_REJECTED_AWAITING;
}

export function isDraftingStatus(status: string) {
  return status === "Recebida" || status === "Em elaboração"
    || status === STATUS_TRATATIVA_DRAFTING || status === STATUS_PAM_DRAFTING;
}

export function isAnsweredAwaitingStatus(status: string) {
  return status === "Respondida" || status === STATUS_TRATATIVA_RESENT || status === STATUS_PAM_SENT;
}

const TYPOLOGY_BY_RNC_TYPE: Record<string, PamTypology> = {
  "Ambiental": "Meio Ambiente",
  "Segurança do Trabalho": "Seg. Trabalho",
  "Engenharia": "Engenharia",
  "Social": "Social",
};

export function typologiesFromRncType(rncType: string): PamTypology[] {
  const mapped = TYPOLOGY_BY_RNC_TYPE[rncType];
  return mapped ? [mapped] : [];
}
