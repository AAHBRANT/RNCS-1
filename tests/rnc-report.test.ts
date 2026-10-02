import assert from "node:assert/strict";
import test from "node:test";
import { buildMonthlyReport, categoryOf, type ReportRnc } from "../lib/rnc-report";

const rnc = (id: number, number: string, year: number, status: string, receivedAt: string | null): ReportRnc =>
  ({ id, number, year, status, receivedAt, description: `RNC ${number}` });

test("status são agrupados nas três cores do gráfico", () => {
  assert.equal(categoryOf("Aprovada"), "aprovadas");
  assert.equal(categoryOf("Reprovada"), "reprovadas");
  assert.equal(categoryOf("Reprovada – aguardando nova resposta"), "reprovadas");
  for (const status of ["Recebida", "Respondida", "Em elaboração", "PAM enviado – aguardando análise", "Retorno recebido — status a confirmar"]) {
    assert.equal(categoryOf(status), "outras", status);
  }
});

test("meses são contínuos, inclusive os sem RNC, e as RNCs ficam na cor e no mês certos", () => {
  const report = buildMonthlyReport([
    rnc(1, "010", 2025, "Aprovada", "2025-10-03"),
    rnc(2, "030", 2025, "Reprovada", "2025-10-20"),
    rnc(3, "005", 2025, "Reprovada", "2025-10-21"),
    rnc(4, "050", 2026, "Recebida", "2026-01-15"),
  ]);
  assert.deepEqual(report.months.map((month) => month.key), ["2025-10", "2025-11", "2025-12", "2026-01"]);
  assert.deepEqual(report.months.map((month) => month.total), [3, 0, 0, 1]);
  assert.deepEqual(report.months[0].items.reprovadas.map((item) => item.number), ["005", "030"]);
  assert.equal(report.months[0].items.aprovadas.length, 1);
  assert.equal(report.months[3].items.outras[0].id, 4);
  assert.deepEqual(report.totals, { aprovadas: 1, reprovadas: 2, outras: 1 });
  assert.equal(report.total, 4);
});

test("RNC sem data de recebimento não entra nos meses, mas conta no total", () => {
  const report = buildMonthlyReport([rnc(1, "001", 2026, "Aprovada", null), rnc(2, "002", 2026, "Recebida", "2026-03-01")]);
  assert.equal(report.undated.length, 1);
  assert.equal(report.months.length, 1);
  assert.equal(report.total, 2);
  assert.equal(report.totals.aprovadas, 1);
});

test("sem RNCs o relatório vem vazio sem quebrar", () => {
  const report = buildMonthlyReport([]);
  assert.deepEqual(report.months, []);
  assert.equal(report.total, 0);
});

test("rótulos dos meses em português", () => {
  const [month] = buildMonthlyReport([rnc(1, "001", 2026, "Recebida", "2026-04-02")]).months;
  assert.equal(month.label, "abr/26");
  assert.equal(month.longLabel, "abril de 2026");
});
