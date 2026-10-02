import { isRejectedStatus } from "./response-types";

export type ReportRnc = {
  id: number;
  number: string;
  year: number;
  description: string;
  status: string;
  type?: string;
  receivedAt: string | null;
};

export type ReportCategory = "aprovadas" | "reprovadas" | "outras";

export const REPORT_CATEGORIES: ReportCategory[] = ["aprovadas", "reprovadas", "outras"];

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  aprovadas: "Aprovadas",
  reprovadas: "Reprovadas",
  outras: "Em andamento / outras",
};

export type MonthBucket = {
  key: string;
  label: string;
  longLabel: string;
  total: number;
  items: Record<ReportCategory, ReportRnc[]>;
};

export type MonthlyReport = {
  months: MonthBucket[];
  undated: ReportRnc[];
  totals: Record<ReportCategory, number>;
  total: number;
};

const SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const LONG = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function categoryOf(status: string): ReportCategory {
  if (status === "Aprovada") return "aprovadas";
  if (isRejectedStatus(status)) return "reprovadas";
  return "outras";
}

function monthKey(receivedAt: string | null) {
  const match = /^(\d{4})-(\d{2})/.exec(receivedAt || "");
  return match ? `${match[1]}-${match[2]}` : null;
}

function byNumber(a: ReportRnc, b: ReportRnc) {
  return a.year - b.year || (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0);
}

function emptyBucket(year: number, month: number): MonthBucket {
  return {
    key: `${year}-${String(month).padStart(2, "0")}`,
    label: `${SHORT[month - 1]}/${String(year).slice(2)}`,
    longLabel: `${LONG[month - 1]} de ${year}`,
    total: 0,
    items: { aprovadas: [], reprovadas: [], outras: [] },
  };
}

// Meses contínuos entre o primeiro e o último recebimento (meses sem RNC aparecem com 0).
export function buildMonthlyReport(rncs: ReportRnc[]): MonthlyReport {
  const dated = new Map<string, MonthBucket>();
  const undated: ReportRnc[] = [];
  const totals: Record<ReportCategory, number> = { aprovadas: 0, reprovadas: 0, outras: 0 };

  for (const rnc of rncs) {
    const key = monthKey(rnc.receivedAt);
    const category = categoryOf(rnc.status);
    totals[category] += 1;
    if (!key) { undated.push(rnc); continue; }
    if (!dated.has(key)) {
      const [year, month] = key.split("-").map(Number);
      dated.set(key, emptyBucket(year, month));
    }
    const bucket = dated.get(key)!;
    bucket.items[category].push(rnc);
    bucket.total += 1;
  }

  const keys = [...dated.keys()].sort();
  const months: MonthBucket[] = [];
  if (keys.length) {
    let [year, month] = keys[0].split("-").map(Number);
    const [lastYear, lastMonth] = keys.at(-1)!.split("-").map(Number);
    while (year < lastYear || (year === lastYear && month <= lastMonth)) {
      const key = `${year}-${String(month).padStart(2, "0")}`;
      months.push(dated.get(key) || emptyBucket(year, month));
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
  }
  for (const bucket of months) for (const category of REPORT_CATEGORIES) bucket.items[category].sort(byNumber);
  undated.sort(byNumber);

  return { months, undated, totals, total: rncs.length };
}
