import assert from "node:assert/strict";
import test from "node:test";
import { extractCommitments } from "../lib/planner-extract";
import { looksLikeFg06Name, parseFg06 } from "../lib/planner-fg06";

const SAMPLE = `FG 06 - PLANO DE AÇÃO DE MELHORIA
Nº da RNC: 317/2026
TIPOLOGIA DA OCORRÊNCIA: Meio Ambiente: ( ) Seg. Trabalho: (X) Engenharia: ( ) Social: ( ) Outros: ( )
Descrição da ocorrência
Falha no isolamento da área.
Descrição da Proposta de melhoria
Realizar treinamento da equipe em até 15 dias.
Data: 01/10/2026
Responsável: Fulano de Tal
Prazo para o PAM: 60 dias
`;

test("reconhece nomes de anexo FG 06", () => {
  assert.equal(looksLikeFg06Name("FG 06 - PAM - RNC 317-2026.pdf"), true);
  assert.equal(looksLikeFg06Name("FG 14 - Análise.pdf"), false);
});

test("lê rótulos do FG 06", () => {
  const parsed = parseFg06(SAMPLE);
  assert.equal(parsed.rncNumber, "317");
  assert.equal(parsed.rncYear, 2026);
  assert.deepEqual(parsed.typologies, ["Seg. Trabalho"]);
  assert.equal(parsed.documentDate, "2026-10-01");
  assert.equal(parsed.deadline, "60 dias");
  assert.match(parsed.proposal, /treinamento/);
  assert.equal(parsed.responsible, "Fulano de Tal");
});

test("prazo do FG 06 gera compromisso final", () => {
  const parsed = parseFg06(SAMPLE);
  const items = extractCommitments({ proposal: parsed.proposal, deadline: parsed.deadline, referenceYear: 2026 });
  assert.ok(items.some((item) => item.kind === "FINAL" && item.quantity === 60));
});
