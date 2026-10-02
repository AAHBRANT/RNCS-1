import type { PlannerRnc } from "./planner-api";
import { addDays, isNearDeadline, urgencyOf, type Urgency, type UrgencyBands } from "./planner-calc";
import type { PlannerCommitment, PlannerPam } from "./planner-service";

export type DateKind = "AJUSTADA" | "EXPRESSA" | "PROJETADA" | "CALCULADA" | "CALCULADA_CONCLUSAO" | "SEM_DATA";

export type PlannerItem = PlannerCommitment & {
  rnc: PlannerRnc | undefined;
  pam: PlannerPam | undefined;
  due: string | null;
  completed: boolean;
  superseded: boolean;
  urgency: Urgency | null;
  dateKind: DateKind;
};

export const DATE_KIND_LABELS: Record<DateKind, string> = {
  AJUSTADA: "Ajustada manualmente",
  EXPRESSA: "Data expressa no PAM",
  PROJETADA: "Projetada",
  CALCULADA: "Calculada",
  CALCULADA_CONCLUSAO: "Calculada a partir da conclusão real",
  SEM_DATA: "Sem data definida",
};

export const PENDING_REASONS: Record<string, string> = {
  DATA_ENVIO_PENDENTE: "Data de envio do PAM pendente",
  AGUARDANDO_MARCO: "Aguardando o marco informado no PAM",
  AGUARDANDO_PREDECESSORA: "Aguardando a atividade predecessora",
  SEM_PRAZO: "Prazo não identificado — revisar",
};

export function dateKindOf(row: Pick<PlannerCommitment, "manualAdjust" | "baseType" | "isProjected" | "currentDue" | "adjustedDue">, predecessorCompleted: boolean): DateKind {
  if (!row.currentDue) return "SEM_DATA";
  if (row.manualAdjust && row.adjustedDue) return "AJUSTADA";
  if (row.baseType === "FIXED_DATE") return "EXPRESSA";
  if (row.isProjected) return "PROJETADA";
  if (row.baseType === "PREDECESSOR_COMPLETION" && predecessorCompleted) return "CALCULADA_CONCLUSAO";
  return "CALCULADA";
}

export function buildItems(input: {
  commitments: PlannerCommitment[];
  pams: PlannerPam[];
  rncs: PlannerRnc[];
  bands: UrgencyBands;
  today: string;
}): PlannerItem[] {
  const rncById = new Map(input.rncs.map((rnc) => [rnc.id, rnc]));
  const pamById = new Map(input.pams.map((pam) => [pam.id, pam]));
  const commitmentById = new Map(input.commitments.map((row) => [row.id, row]));
  return input.commitments.map((row) => {
    const superseded = row.status === "SUBSTITUIDO";
    const completed = row.status === "CONCLUIDO";
    const predecessor = row.predecessorId ? commitmentById.get(row.predecessorId) : undefined;
    return {
      ...row,
      rnc: rncById.get(row.rncId),
      pam: pamById.get(row.plannerPamId),
      due: row.currentDue,
      completed,
      superseded,
      urgency: superseded ? null : urgencyOf(row.currentDue, input.today, completed, input.bands),
      dateKind: dateKindOf(row, predecessor?.status === "CONCLUIDO"),
    };
  });
}

export type StatusFilter = "all" | "pending" | "near" | "late" | "done";
export type KindFilter = "all" | "FINAL" | "ETAPA";

export function matchesStatus(item: PlannerItem, filter: StatusFilter) {
  switch (filter) {
    case "pending": return !item.completed;
    case "near": return isNearDeadline(item.urgency);
    case "late": return item.urgency === "ATRASADO";
    case "done": return item.completed;
    default: return true;
  }
}

export function matchesKind(item: PlannerItem, filter: KindFilter) {
  return filter === "all" || item.kind === filter;
}

export function rncLabel(rnc: Pick<PlannerRnc, "number" | "year"> | undefined) {
  return rnc ? `RNC ${rnc.number}/${rnc.year}` : "RNC";
}

export function formatBr(iso: string | null | undefined) {
  return iso ? iso.split("-").reverse().join("/") : "—";
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function monthTitle(iso: string) {
  const [year, month] = iso.split("-").map(Number);
  return `${MONTHS[month - 1]} de ${year}`;
}

function weekdayOf(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function startOfWeek(iso: string) {
  return addDays(iso, -weekdayOf(iso));
}

export function weekDays(iso: string) {
  const start = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

// 6 semanas (domingo a sábado) cobrindo o mês do dia informado.
export function monthGridDays(iso: string) {
  const first = `${iso.slice(0, 7)}-01`;
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

export function shiftMonth(iso: string, delta: number) {
  const [year, month] = iso.split("-").map(Number);
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

export function weekTitle(iso: string) {
  const days = weekDays(iso);
  const short = (value: string) => value.split("-").reverse().slice(0, 2).join("/");
  return `Semana de ${short(days[0])} a ${short(days[6])} de ${days[6].slice(0, 4)}`;
}

export function groupByDay(items: PlannerItem[]) {
  const map = new Map<string, PlannerItem[]>();
  for (const item of items) {
    if (!item.due) continue;
    map.set(item.due, [...(map.get(item.due) ?? []), item]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.rnc?.year ?? 0) - (b.rnc?.year ?? 0) || (parseInt(a.rnc?.number ?? "0", 10) - parseInt(b.rnc?.number ?? "0", 10)) || a.orderIndex - b.orderIndex);
  }
  return map;
}

export type PlannerApiData = {
  rncs: PlannerRnc[];
  commitments: PlannerCommitment[];
  pams: PlannerPam[];
  bands: UrgencyBands;
  canAdjust: boolean;
  today: string;
  user: { name: string; email: string; role: string } | null;
};
