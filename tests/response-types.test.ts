import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyPamFormData,
  normalizeResponseType,
  parsePamFormData,
  responseLabel,
  sanitizePamFormData,
} from "../lib/response-types";

test("tipo desconhecido ou ausente cai em TRATATIVA (compatibilidade com registros antigos)", () => {
  assert.equal(normalizeResponseType(undefined), "TRATATIVA");
  assert.equal(normalizeResponseType(null), "TRATATIVA");
  assert.equal(normalizeResponseType("qualquer"), "TRATATIVA");
  assert.equal(normalizeResponseType("pam"), "PAM");
  assert.equal(normalizeResponseType("PAM"), "PAM");
});

test("rótulo de versão identifica o tipo", () => {
  assert.equal(responseLabel("TRATATIVA", 2), "Tratativa V2");
  assert.equal(responseLabel("PAM", 1), "PAM V1");
});

test("dados do PAM são saneados: tipologias inválidas e campos extras são descartados", () => {
  const result = sanitizePamFormData({
    contract: "02.023/2024",
    typologies: ["Engenharia", "Inventada", "Social"],
    occurrenceDescription: "desc",
    improvementProposal: "proposta",
    date: "02/10/2026",
    responsible: "Fulano",
    deadline: "30 dias",
    extra: "ignorado",
  });
  assert.deepEqual(result.typologies, ["Engenharia", "Social"]);
  assert.equal("extra" in result, false);
  assert.equal(result.deadline, "30 dias");
});

test("JSON inválido ou vazio do PAM devolve o formulário vazio", () => {
  assert.deepEqual(parsePamFormData("{{"), emptyPamFormData);
  assert.deepEqual(parsePamFormData(null), emptyPamFormData);
  assert.deepEqual(parsePamFormData("{}"), emptyPamFormData);
});
