export type DeadlineAwareRnc = { dueAt: string | null; sentAt: string | null; status: string };

export function parseLocal(value: string) { return new Date(`${value}T12:00:00`); }

export function fmt(value?: string | null) {
  if (!value) return "—";
  const date = value.length === 10 ? parseLocal(value) : new Date(value);
  return new Intl.DateTimeFormat("pt-BR").format(date);
}

export function businessDayDelta(fromValue: string, toValue: string) {
  const from = parseLocal(fromValue); const to = parseLocal(toValue);
  const direction = to >= from ? 1 : -1; let count = 0; const cursor = new Date(from);
  while ((direction === 1 && cursor < to) || (direction === -1 && cursor > to)) {
    cursor.setDate(cursor.getDate() + direction);
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) count += direction;
  }
  return count;
}

export function todayInBrazil() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function hasAnsweredStatus(rnc: DeadlineAwareRnc) {
  return [
    "Respondida",
    "Aprovada",
    "Reprovada",
    "Retorno recebido — status a confirmar",
  ].includes(rnc.status);
}

export function hasBeenAnswered(rnc: DeadlineAwareRnc) {
  return Boolean(rnc.sentAt) || hasAnsweredStatus(rnc);
}

export function deadlineResult(rnc: DeadlineAwareRnc) {
  if (!rnc.dueAt) {
    return { delta: null, label: "Prazo não identificado" };
  }
  const comparison = rnc.sentAt || todayInBrazil();
  const delta = businessDayDelta(rnc.dueAt, comparison);
  if (rnc.sentAt) {
    if (delta === 0) return { delta, label: "Respondida no prazo" };
    if (delta > 0) return { delta, label: `Respondida com ${delta} ${delta === 1 ? "dia útil" : "dias úteis"} de atraso` };
    const early = Math.abs(delta);
    return { delta, label: `Respondida ${early} ${early === 1 ? "dia útil" : "dias úteis"} antes do prazo` };
  }
  if (hasAnsweredStatus(rnc)) {
    return { delta: 0, label: "Respondida — data do envio não identificada" };
  }
  if (delta > 0) return { delta, label: `${delta} ${delta === 1 ? "dia útil" : "dias úteis"} em atraso` };
  if (delta === 0) return { delta, label: "Vence hoje" };
  const remaining = Math.abs(delta);
  return { delta, label: `${remaining} ${remaining === 1 ? "dia útil" : "dias úteis"} restantes` };
}
