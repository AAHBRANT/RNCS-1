import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_URGENCY_BANDS,
  addBusinessDays,
  addDays,
  computeSchedule,
  sanitizeBands,
  urgencyOf,
  type PlanItem,
} from "../lib/planner-calc";
import { extractCommitments, ruleText } from "../lib/planner-extract";
import { buildItems, dateKindOf, groupByDay, matchesStatus, monthGridDays, shiftMonth, weekDays, weekTitle } from "../lib/planner-view";

const SENT = "2026-12-01";
const extract = (proposal: string, deadline = "") => extractCommitments({ proposal, deadline, referenceYear: 2026 });
const toPlan = (items: ReturnType<typeof extract>, overrides: Record<number, Partial<PlanItem>> = {}): PlanItem[] =>
  items.map((item) => ({
    key: item.order,
    quantity: item.quantity,
    unit: item.unit,
    baseType: item.baseType,
    fixedDate: item.fixedDate,
    predecessorKey: item.predecessorOrder,
    milestoneDate: null,
    manualDue: null,
    completedAt: null,
    ...overrides[item.order],
  }));
const schedule = (items: ReturnType<typeof extract>, overrides: Record<number, Partial<PlanItem>> = {}, sent: string | null = SENT) =>
  computeSchedule(toPlan(items, overrides), sent);

test("prazo relativo sem outro marco usa a data de envio do PAM (seção 21)", () => {
  const [item] = extract("Realizar os reparos no prazo de 10 dias.");
  assert.equal(item.title, "Realizar os reparos");
  assert.equal(item.baseType, "PAM_SENT_DATE");
  assert.equal(schedule([item]).get(1)!.due, "2026-12-11");

  const [mobilizacao] = extract("Mobilização da equipe em até 5 dias.");
  assert.equal(mobilizacao.title, "Mobilização da equipe");
  assert.equal(schedule([mobilizacao]).get(1)!.due, "2026-12-06");
});

test("dois prazos na mesma frase geram dois compromissos independentes", () => {
  const items = extract("Preparação dos materiais em 10 dias e conclusão dos serviços em 20 dias.");
  assert.deepEqual(items.map((item) => item.title), ["Preparação dos materiais", "Conclusão dos serviços"]);
  const result = schedule(items);
  assert.equal(result.get(1)!.due, "2026-12-11");
  assert.equal(result.get(2)!.due, "2026-12-21");
});

test("três ações em uma única frase (seção 25)", () => {
  const items = extract("Será realizada a mobilização da equipe em até 5 dias, preparação das estruturas em 10 dias e conclusão dos reparos em 20 dias.");
  assert.deepEqual(items.map((item) => item.title), ["Mobilização da equipe", "Preparação das estruturas", "Conclusão dos reparos"]);
  assert.deepEqual(items.map((item) => item.quantity), [5, 10, 20]);
  assert.ok(items.every((item) => item.baseType === "PAM_SENT_DATE"));
});

test("data expressa tem prioridade e não depende do envio (seção 22)", () => {
  const [item] = extract("Conclusão dos reparos até 15/12/2026.");
  assert.equal(item.baseType, "FIXED_DATE");
  assert.equal(item.fixedDate, "2026-12-15");
  assert.equal(item.title, "Conclusão dos reparos");
  assert.equal(schedule([item], {}, null).get(1)!.due, "2026-12-15");
});

test("data por extenso e data com ano de dois dígitos", () => {
  assert.equal(extract("Entrega do relatório até 20 de dezembro de 2026.")[0].fixedDate, "2026-12-20");
  assert.equal(extract("Vistoria final em 05/01/27.")[0].fixedDate, "2027-01-05");
});

test("outro marco expresso: aguarda o marco e depois calcula (seção 23)", () => {
  const [item] = extract("Executar o serviço em até 10 dias após a liberação da área.");
  assert.equal(item.baseType, "EXTERNAL_MILESTONE");
  assert.equal(item.milestoneLabel, "liberação da área");
  assert.equal(item.quantity, 10);
  assert.equal(schedule([item]).get(1)!.state, "AGUARDANDO_MARCO");
  const withMilestone = schedule([item], { 1: { milestoneDate: "2026-12-07" } }).get(1)!;
  assert.equal(withMilestone.state, "OK");
  assert.equal(withMilestone.due, "2026-12-17");
});

test("dias úteis e dias corridos respeitam o que está escrito (seção 24)", () => {
  assert.equal(extract("Reparo em 10 dias.")[0].unit, "CORRIDOS");
  assert.equal(extract("Reparo em 10 dias corridos.")[0].unit, "CORRIDOS");
  const [uteis] = extract("Reparo em 10 dias úteis.");
  assert.equal(uteis.unit, "UTEIS");
  assert.equal(addBusinessDays("2026-12-01", 10), "2026-12-15");
  assert.equal(schedule([uteis]).get(1)!.due, "2026-12-15");
  assert.equal(addBusinessDays("2026-12-04", 1), "2026-12-07");
});

test("número por extenso e parênteses", () => {
  assert.equal(extract("Mobilização em dez (10) dias.")[0].quantity, 10);
  assert.equal(extract("Mobilização em cinco dias.")[0].quantity, 5);
});

test("cadeia sequencial por itens numerados (21.10)", () => {
  const items = extract([
    "1 - Preparação da estrutura – 10 dias.",
    "2 - Aplicação do tratamento – 15 dias após conclusão do item 1.",
    "3 - Pintura – 3 dias após conclusão do item 2.",
  ].join("\n"));
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((item) => item.title), ["Preparação da estrutura", "Aplicação do tratamento", "Pintura"]);
  assert.deepEqual(items.map((item) => item.baseType), ["PAM_SENT_DATE", "PREDECESSOR_COMPLETION", "PREDECESSOR_COMPLETION"]);
  assert.deepEqual(items.map((item) => item.predecessorOrder), [null, 1, 2]);
});

test("datas projetadas e recálculo após a conclusão real (21.3 e 21.4)", () => {
  const items = extract([
    "1. Mobilização da equipe – 10 dias.",
    "2. Execução dos reparos – 15 dias após a conclusão da atividade 1.",
    "3. Finalização e limpeza – 3 dias após a conclusão da atividade 2.",
  ].join("\n"));
  const projected = schedule(items);
  assert.deepEqual([1, 2, 3].map((key) => projected.get(key)!.due), ["2026-12-11", "2026-12-26", "2026-12-29"]);
  assert.deepEqual([1, 2, 3].map((key) => projected.get(key)!.projected), [false, true, true]);

  const recalculated = schedule(items, { 1: { completedAt: "2026-12-13" } });
  assert.equal(recalculated.get(2)!.due, "2026-12-28");
  assert.equal(recalculated.get(2)!.projected, false);
  assert.equal(recalculated.get(3)!.due, "2026-12-31");
  assert.equal(recalculated.get(3)!.projected, true);
});

test("ajuste manual vira a data vigente mas preserva a calculada e alimenta os sucessores", () => {
  const items = extract("1. Mobilização – 10 dias.\n2. Reparo – 5 dias após a conclusão da atividade 1.");
  const adjusted = schedule(items, { 1: { manualDue: "2026-12-14" } });
  assert.equal(adjusted.get(1)!.due, "2026-12-14");
  assert.equal(adjusted.get(1)!.calculatedDue, "2026-12-11");
  assert.equal(adjusted.get(2)!.due, "2026-12-19");
});

test("sem data de envio, prazos relativos ficam pendentes e não usam a data de importação", () => {
  const [item] = extract("Reparos em 10 dias.");
  const pending = schedule([item], {}, null).get(1)!;
  assert.equal(pending.state, "DATA_ENVIO_PENDENTE");
  assert.equal(pending.due, null);
});

test("ciclo de dependência não trava", () => {
  const plan: PlanItem[] = [
    { key: 1, quantity: 1, unit: "CORRIDOS", baseType: "PREDECESSOR_COMPLETION", fixedDate: null, predecessorKey: 2, milestoneDate: null, manualDue: null, completedAt: null },
    { key: 2, quantity: 1, unit: "CORRIDOS", baseType: "PREDECESSOR_COMPLETION", fixedDate: null, predecessorKey: 1, milestoneDate: null, manualDue: null, completedAt: null },
  ];
  const result = computeSchedule(plan, SENT);
  assert.equal(result.get(1)!.state, "AGUARDANDO_PREDECESSORA");
});

test("campo 'Prazo para o PAM' vira prazo final e não duplica prazo igual do texto", () => {
  const onlyField = extract("", "30 dias");
  assert.equal(onlyField.length, 1);
  assert.equal(onlyField[0].kind, "FINAL");
  assert.equal(onlyField[0].title, "Prazo final do PAM");

  const merged = extract("Conclusão dos reparos em 30 dias.", "30 dias");
  assert.equal(merged.length, 1);
  assert.equal(merged[0].kind, "FINAL");
  assert.equal(merged[0].title, "Conclusão dos reparos");
});

test("prazo em meses é sinalizado para revisão em vez de calculado errado", () => {
  const [item] = extract("Conclusão da obra em 2 meses.");
  assert.equal(item.quantity, null);
  assert.equal(item.needsReview, true);
});

test("texto sem prazos não gera compromissos", () => {
  assert.deepEqual(extract("Substituir as peças com corrosão avançada e aplicar tratamento."), []);
  assert.deepEqual(extract(""), []);
});

test("urgência por faixas (seção 32) usa a data atual do Planner", () => {
  const today = "2026-12-01";
  const level = (due: string | null, done = false) => urgencyOf(due, today, done);
  assert.equal(level("2026-12-17"), "VERDE");
  assert.equal(level("2026-12-16"), "AMARELO");
  assert.equal(level("2026-12-09"), "AMARELO");
  assert.equal(level("2026-12-08"), "LARANJA");
  assert.equal(level("2026-12-04"), "LARANJA");
  assert.equal(level("2026-12-03"), "VERMELHO");
  assert.equal(level("2026-12-01"), "VERMELHO");
  assert.equal(level("2026-11-30"), "ATRASADO");
  assert.equal(level("2026-11-30", true), "CONCLUIDO");
  assert.equal(level(null), null);
});

test("faixas configuráveis são validadas e mantêm a ordem", () => {
  assert.deepEqual(sanitizeBands({}), DEFAULT_URGENCY_BANDS);
  assert.deepEqual(sanitizeBands({ greenMin: 30, yellowMin: 10, orangeMin: 4 }), { greenMin: 30, yellowMin: 10, orangeMin: 4 });
  assert.deepEqual(sanitizeBands({ greenMin: 5, yellowMin: 10, orangeMin: 8 }), { greenMin: 5, yellowMin: 4, orangeMin: 3 });
  assert.deepEqual(sanitizeBands({ greenMin: "x" }), DEFAULT_URGENCY_BANDS);
});

test("aritmética de datas e texto da regra", () => {
  assert.equal(addDays("2026-12-28", 4), "2027-01-01");
  const items = extract("1. Mobilização – 10 dias.\n2. Reparo – 15 dias após a conclusão da atividade 1.");
  const titleOf = (order: number) => items.find((item) => item.order === order)?.title ?? null;
  assert.equal(ruleText(items[0], titleOf), "10 dias após o envio do PAM");
  assert.equal(ruleText(items[1], titleOf), '15 dias após a conclusão de "Mobilização"');
});

const baseRow = {
  id: 1, rncId: 10, plannerPamId: 5, pamVersion: 1, orderIndex: 1, kind: "ETAPA", source: "PROPOSTA", title: "Mobilização",
  originalText: "Mobilização em 10 dias", quantity: 10, unit: "CORRIDOS", baseType: "PAM_SENT_DATE", fixedDate: null,
  milestoneLabel: null, milestoneDate: null, predecessorId: null, extracted: "{}", needsReview: false, reviewReason: null,
  baseDate: "2026-12-01", calculatedDue: "2026-12-11", originalDue: "2026-12-11", currentDue: "2026-12-11", isProjected: false,
  state: "OK", manualAdjust: false, adjustedDue: null, adjustedBy: null, adjustedAt: null, adjustReason: null,
  status: "PENDENTE", completedAt: null, completedBy: null, completedRegisteredAt: null,
  createdAt: "2026-12-01T00:00:00Z", updatedAt: "2026-12-01T00:00:00Z",
};

test("visão do Planner: urgência, tipo da data e filtros de situação", () => {
  const rows = [
    { ...baseRow, id: 1, currentDue: "2026-12-11" },
    { ...baseRow, id: 2, baseType: "PREDECESSOR_COMPLETION", predecessorId: 1, isProjected: true, currentDue: "2026-12-26" },
    { ...baseRow, id: 3, currentDue: "2026-11-20" },
    { ...baseRow, id: 4, status: "CONCLUIDO", completedAt: "2026-11-25", currentDue: "2026-11-20" },
    { ...baseRow, id: 5, currentDue: null, state: "DATA_ENVIO_PENDENTE" },
    { ...baseRow, id: 6, status: "SUBSTITUIDO", currentDue: "2026-12-12" },
  ] as never[];
  const items = buildItems({ commitments: rows, pams: [], rncs: [], bands: DEFAULT_URGENCY_BANDS, today: "2026-12-01" });
  const byId = (id: number) => items.find((item) => item.id === id)!;
  assert.equal(byId(1).urgency, "AMARELO");
  assert.equal(byId(2).dateKind, "PROJETADA");
  assert.equal(byId(3).urgency, "ATRASADO");
  assert.equal(byId(4).urgency, "CONCLUIDO");
  assert.equal(byId(5).dateKind, "SEM_DATA");
  assert.equal(byId(6).urgency, null);
  assert.deepEqual(items.filter((item) => matchesStatus(item, "late")).map((item) => item.id), [3]);
  assert.deepEqual(items.filter((item) => matchesStatus(item, "near")).map((item) => item.id), [1]);
  assert.deepEqual(items.filter((item) => matchesStatus(item, "done")).map((item) => item.id), [4]);
  assert.equal(dateKindOf({ ...baseRow, manualAdjust: true, adjustedDue: "2026-12-13" }, false), "AJUSTADA");
  assert.equal(dateKindOf({ ...baseRow, baseType: "FIXED_DATE" }, false), "EXPRESSA");
  assert.equal(dateKindOf({ ...baseRow, baseType: "PREDECESSOR_COMPLETION" }, true), "CALCULADA_CONCLUSAO");
});

test("calendário: grade do mês, semana e navegação", () => {
  const grid = monthGridDays("2026-12-15");
  assert.equal(grid.length, 42);
  assert.equal(grid[0], "2026-11-29"); // domingo anterior ao dia 1 (terça)
  assert.ok(grid.includes("2026-12-31"));
  assert.deepEqual(weekDays("2026-12-09"), ["2026-12-06", "2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12"]);
  assert.equal(weekTitle("2026-12-09"), "Semana de 06/12 a 12/12 de 2026");
  assert.equal(shiftMonth("2026-12-15", 1), "2027-01-01");
  assert.equal(shiftMonth("2026-01-15", -1), "2025-12-01");
  const groups = groupByDay(buildItems({
    commitments: [{ ...baseRow, id: 1 }, { ...baseRow, id: 2, orderIndex: 2 }, { ...baseRow, id: 3, currentDue: null }] as never[],
    pams: [], rncs: [], bands: DEFAULT_URGENCY_BANDS, today: "2026-12-01",
  }));
  assert.equal(groups.get("2026-12-11")!.length, 2);
  assert.equal(groups.size, 1);
});
