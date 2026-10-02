// Cálculo de prazos do Planner. Datas sempre em ISO (AAAA-MM-DD), sem fuso: a aritmética é feita em UTC.

export type DeadlineUnit = "CORRIDOS" | "UTEIS";
export type BaseType = "PAM_SENT_DATE" | "FIXED_DATE" | "PREDECESSOR_COMPLETION" | "EXTERNAL_MILESTONE";
export type PlanState = "OK" | "AGUARDANDO_MARCO" | "DATA_ENVIO_PENDENTE" | "AGUARDANDO_PREDECESSORA" | "SEM_PRAZO";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

function toUtc(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toIso(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number) {
  const date = toUtc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

// Dias úteis = segunda a sexta (sem calendário de feriados, como o prazo das RNCs).
export function addBusinessDays(iso: string, days: number) {
  const date = toUtc(iso);
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return toIso(date);
}

export function addDeadline(iso: string, quantity: number, unit: DeadlineUnit) {
  return unit === "UTEIS" ? addBusinessDays(iso, quantity) : addDays(iso, quantity);
}

export function diffDays(fromIso: string, toIsoDate: string) {
  return Math.round((toUtc(toIsoDate).getTime() - toUtc(fromIso).getTime()) / 86_400_000);
}

export type PlanItem = {
  key: string | number;
  quantity: number | null;
  unit: DeadlineUnit;
  baseType: BaseType;
  fixedDate: string | null;
  predecessorKey: string | number | null;
  milestoneDate: string | null;
  // Ajuste manual autorizado: vira a data atual do Planner; a calculada fica preservada.
  manualDue: string | null;
  completedAt: string | null;
};

export type PlanResult = {
  key: string | number;
  state: PlanState;
  baseDate: string | null;
  // Data pela regra do PAM, sem ajuste manual.
  calculatedDue: string | null;
  // Data vigente no Planner (ajuste manual, se houver; senão a calculada).
  due: string | null;
  // Projetada = depende de uma predecessora ainda não concluída.
  projected: boolean;
};

export function computeSchedule(items: PlanItem[], pamSentDate: string | null): Map<string | number, PlanResult> {
  const byKey = new Map(items.map((item) => [item.key, item]));
  const results = new Map<string | number, PlanResult>();
  const visiting = new Set<string | number>();

  function resolve(key: string | number): PlanResult {
    const cached = results.get(key);
    if (cached) return cached;
    const item = byKey.get(key)!;
    const finish = (partial: Omit<PlanResult, "key" | "due">): PlanResult => {
      const due = item.manualDue ?? partial.calculatedDue;
      const result: PlanResult = { key, ...partial, due, projected: item.manualDue ? false : partial.projected };
      results.set(key, result);
      return result;
    };
    const waiting = (state: PlanState): PlanResult => finish({ state, baseDate: null, calculatedDue: null, projected: false });

    if (item.baseType === "FIXED_DATE") {
      return finish({ state: item.fixedDate ? "OK" : "SEM_PRAZO", baseDate: item.fixedDate, calculatedDue: item.fixedDate, projected: false });
    }
    if (item.quantity === null) return waiting("SEM_PRAZO");

    if (item.baseType === "PAM_SENT_DATE") {
      if (!pamSentDate) return waiting("DATA_ENVIO_PENDENTE");
      return finish({ state: "OK", baseDate: pamSentDate, calculatedDue: addDeadline(pamSentDate, item.quantity, item.unit), projected: false });
    }
    if (item.baseType === "EXTERNAL_MILESTONE") {
      if (!item.milestoneDate) return waiting("AGUARDANDO_MARCO");
      return finish({ state: "OK", baseDate: item.milestoneDate, calculatedDue: addDeadline(item.milestoneDate, item.quantity, item.unit), projected: false });
    }

    // PREDECESSOR_COMPLETION
    const predecessor = item.predecessorKey !== null ? byKey.get(item.predecessorKey) : undefined;
    if (!predecessor || visiting.has(key)) return waiting("AGUARDANDO_PREDECESSORA");
    if (predecessor.completedAt) {
      return finish({ state: "OK", baseDate: predecessor.completedAt, calculatedDue: addDeadline(predecessor.completedAt, item.quantity, item.unit), projected: false });
    }
    visiting.add(key);
    const predecessorResult = resolve(predecessor.key);
    visiting.delete(key);
    if (!predecessorResult.due) return waiting("AGUARDANDO_PREDECESSORA");
    return finish({
      state: "OK",
      baseDate: predecessorResult.due,
      calculatedDue: addDeadline(predecessorResult.due, item.quantity, item.unit),
      projected: true,
    });
  }

  for (const item of items) resolve(item.key);
  return results;
}

export type Urgency = "VERDE" | "AMARELO" | "LARANJA" | "VERMELHO" | "ATRASADO" | "CONCLUIDO";

// Dias restantes mínimos de cada faixa (padrão: verde > 15, amarelo 8-15, laranja 3-7, vermelho 0-2).
export type UrgencyBands = { greenMin: number; yellowMin: number; orangeMin: number };
export const DEFAULT_URGENCY_BANDS: UrgencyBands = { greenMin: 16, yellowMin: 8, orangeMin: 3 };

export function sanitizeBands(value: unknown): UrgencyBands {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const read = (key: keyof UrgencyBands) => {
    const number = Number(source[key]);
    return Number.isInteger(number) && number >= 1 && number <= 365 ? number : DEFAULT_URGENCY_BANDS[key];
  };
  const greenMin = read("greenMin");
  const yellowMin = Math.min(read("yellowMin"), greenMin - 1);
  const orangeMin = Math.min(read("orangeMin"), yellowMin - 1);
  return orangeMin >= 1 ? { greenMin, yellowMin, orangeMin } : { ...DEFAULT_URGENCY_BANDS };
}

export function urgencyOf(due: string | null, today: string, completed: boolean, bands: UrgencyBands = DEFAULT_URGENCY_BANDS): Urgency | null {
  if (completed) return "CONCLUIDO";
  if (!due) return null;
  const remaining = diffDays(today, due);
  if (remaining < 0) return "ATRASADO";
  if (remaining >= bands.greenMin) return "VERDE";
  if (remaining >= bands.yellowMin) return "AMARELO";
  if (remaining >= bands.orangeMin) return "LARANJA";
  return "VERMELHO";
}

export const URGENCY_LABELS: Record<Urgency, string> = {
  VERDE: "No prazo",
  AMARELO: "Atenção",
  LARANJA: "Prazo próximo",
  VERMELHO: "Prazo crítico",
  ATRASADO: "Atrasado",
  CONCLUIDO: "Concluído",
};

export function isNearDeadline(urgency: Urgency | null) {
  return urgency === "AMARELO" || urgency === "LARANJA" || urgency === "VERMELHO";
}

const TIME_ZONE = "America/Sao_Paulo";

// O banco devolve timestamps como "2026-08-05 18:07:34+00"; normaliza para o formato que o Date entende.
export function parseTimestamp(value: string | Date): Date {
  if (value instanceof Date) return value;
  let text = value.trim().replace(" ", "T");
  if (/[+-]\d{2}$/.test(text)) text += ":00";
  return new Date(text);
}

// Data civil (AAAA-MM-DD) no fuso de Brasília: um e-mail enviado às 22h30 locais não "vira" o dia seguinte em UTC.
export function isoInBrazil(value: string | Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(parseTimestamp(value));
}
