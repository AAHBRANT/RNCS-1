import {
  PAM_TYPOLOGIES,
  formatDateBr,
  normalizeResponseType,
  parsePamFormData,
  responseLabel,
  type ResponseType,
} from "./response-types";

export type TimelineKind =
  | "RECEBIDA" | "ENVIO" | "RETORNO" | "TRATATIVA" | "PAM"
  | "REPROVACAO" | "APROVACAO" | "DOCUMENTO" | "STATUS" | "PLANEJAMENTO";

export const TIMELINE_BADGE: Record<TimelineKind, string> = {
  RECEBIDA: "RECEBIDA",
  ENVIO: "ENVIO",
  RETORNO: "RETORNO",
  TRATATIVA: "TRATATIVA",
  PAM: "PAM",
  REPROVACAO: "REPROVAÇÃO",
  APROVACAO: "APROVAÇÃO",
  DOCUMENTO: "DOCUMENTO",
  STATUS: "ALTERAÇÃO DE STATUS",
  PLANEJAMENTO: "PLANEJAMENTO",
};

export type TimelineRef =
  | { type: "version"; id: number }
  | { type: "document"; id: number };

export type TimelineItem = {
  key: string;
  kind: TimelineKind;
  at: string;
  title: string;
  detail?: string;
  ref?: TimelineRef;
};

export type TimelineEmail = { id: number; eventType: string; subject: string | null; occurredAt: string };
export type TimelineVersion = {
  id: number; version: number; createdAt: string; createdBy?: string | null;
  responseType?: string | null; snapshot?: string | null;
};
export type TimelineDocument = {
  id: number; version: number; fileName: string; createdAt: string; responseType?: string | null;
};
export type TimelineChange = {
  id: number; field: string; oldValue: string | null; newValue: string | null; changedAt: string; userName?: string | null;
};

function snapshotOf(raw?: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function statusKind(status: string): TimelineKind {
  if (/^Reprovada/.test(status)) return "REPROVACAO";
  if (status === "Aprovada") return "APROVACAO";
  return "STATUS";
}

// Ajustes do Planner ficam na auditoria da RNC (campo planner_*); aqui viram uma linha legível do histórico.
export function plannerChangeText(change: TimelineChange): { title: string; detail?: string } {
  const parts = (change.newValue || "").split(" · ");
  const who = change.userName || "usuário";
  if (change.field === "planner_prazo") {
    const restored = parts[2]?.includes("removido");
    return {
      title: `Prazo do Planner ${restored ? "restaurado" : "ajustado"} de ${change.oldValue || "—"} para ${parts[0]} por ${who}.`,
      detail: [parts[1], parts.find((part) => part.startsWith("motivo:"))].filter(Boolean).join(" — ") || undefined,
    };
  }
  return { title: parts[0], detail: parts.slice(1).join(" · ") || who };
}

export function buildTimeline(input: {
  emails: TimelineEmail[];
  versions: TimelineVersion[];
  documents: TimelineDocument[];
  changes: TimelineChange[];
}): TimelineItem[] {
  const items: TimelineItem[] = [];

  for (const email of input.emails) {
    const detail = email.subject || undefined;
    if (email.eventType === "recebimento") {
      items.push({ key: `email-${email.id}`, kind: "RECEBIDA", at: email.occurredAt, title: "RNC recebida", detail });
    } else if (email.eventType === "envio_resposta") {
      items.push({ key: `email-${email.id}`, kind: "ENVIO", at: email.occurredAt, title: "Resposta enviada à Supervisão", detail });
    } else if (email.eventType === "retorno_supervisao") {
      items.push({ key: `email-${email.id}`, kind: "RETORNO", at: email.occurredAt, title: "Retorno da Supervisão recebido", detail });
    }
  }

  for (const version of input.versions) {
    const type = normalizeResponseType(version.responseType);
    const snapshot = snapshotOf(version.snapshot);
    const status = typeof snapshot.status === "string" ? snapshot.status : "";
    items.push({
      key: `version-${version.id}`,
      kind: type,
      at: version.createdAt,
      title: `${responseLabel(type, version.version).toUpperCase()}${status ? ` · ${status}` : ""}`,
      detail: version.createdBy || undefined,
      ref: { type: "version", id: version.id },
    });
  }

  for (const document of input.documents) {
    const type = normalizeResponseType(document.responseType);
    items.push({
      key: `document-${document.id}`,
      kind: "DOCUMENTO",
      at: document.createdAt,
      title: `Word ${responseLabel(type, document.version)}`,
      detail: document.fileName,
      ref: { type: "document", id: document.id },
    });
  }

  for (const change of input.changes) {
    if (change.field.startsWith("planner_") && change.newValue) {
      items.push({
        key: `change-${change.id}`,
        kind: "PLANEJAMENTO",
        at: change.changedAt,
        ...plannerChangeText(change),
      });
      continue;
    }
    if (change.field !== "status" || !change.newValue) continue;
    items.push({
      key: `change-${change.id}`,
      kind: statusKind(change.newValue),
      at: change.changedAt,
      title: `Status: ${change.oldValue || "—"} → ${change.newValue}`,
      detail: change.userName || undefined,
    });
  }

  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export type VersionView = {
  type: ResponseType;
  label: string;
  status: string;
  savedAt: string;
  fields: Array<{ label: string; value: string }>;
};

// Lê exatamente o que foi salvo naquela versão; nunca consulta o rascunho atual.
export function describeVersion(version: TimelineVersion): VersionView {
  const type = normalizeResponseType(version.responseType);
  const snapshot = snapshotOf(version.snapshot);
  const text = (key: string) => (typeof snapshot[key] === "string" ? (snapshot[key] as string) : "");
  const legends = [1, 2, 3, 4]
    .map((number) => ({ label: `Legenda da foto ${number}`, value: text(`photoLegend${number}`) }))
    .filter((field) => field.value);
  const comment = { label: "Comentário interno", value: text("internalComment") };

  let fields: VersionView["fields"];
  if (type === "PAM") {
    const form = parsePamFormData(text("formData"));
    const ordered = PAM_TYPOLOGIES.filter((option) => form.typologies.includes(option));
    fields = [
      { label: "Tipologia da ocorrência", value: ordered.join(", ") },
      { label: "Descrição da ocorrência", value: form.occurrenceDescription },
      { label: "Descrição da proposta de melhoria", value: form.improvementProposal },
      { label: "Data", value: formatDateBr(form.date) },
      { label: "Responsável", value: form.responsible },
      { label: "Prazo para o PAM", value: form.deadline },
      ...legends,
      comment,
    ];
  } else {
    fields = [
      { label: "Análise da ocorrência", value: text("analysis") },
      { label: "Medidas corretivas", value: text("actionsTaken") },
      { label: "Observações", value: text("observations") },
      ...legends,
      comment,
    ];
  }

  return {
    type,
    label: responseLabel(type, version.version),
    status: text("status") || "—",
    savedAt: version.createdAt,
    fields,
  };
}

export function timelineToText(items: TimelineItem[], formatAt: (value: string) => string) {
  return items
    .map((item) => `${formatAt(item.at)} — ${TIMELINE_BADGE[item.kind]} — ${item.title}${item.detail ? ` (${item.detail})` : ""}`)
    .join("\n");
}
