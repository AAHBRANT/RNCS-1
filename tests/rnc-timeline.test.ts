import assert from "node:assert/strict";
import test from "node:test";
import { buildTimeline, describeVersion, statusKind, timelineToText } from "../lib/rnc-timeline";

const emails = [
  { id: 1, eventType: "recebimento", subject: "RNC recebida 292/2026", occurredAt: "2026-08-05T12:00:00Z" },
  { id: 2, eventType: "retorno_supervisao", subject: "Análise 292/2026", occurredAt: "2026-08-18T12:00:00Z" },
];
const versions = [
  { id: 11, version: 1, createdAt: "2026-08-10T12:00:00Z", createdBy: "Ana", responseType: "TRATATIVA", snapshot: JSON.stringify({ status: "Rascunho", analysis: "Análise V1", actionsTaken: "Medidas V1", internalComment: "nota da tratativa" }) },
  { id: 12, version: 1, createdAt: "2026-08-20T12:00:00Z", createdBy: "Ana", responseType: "PAM", snapshot: JSON.stringify({ status: "Em revisão", internalComment: "nota do PAM", formData: JSON.stringify({ typologies: ["Social", "Engenharia"], occurrenceDescription: "ocorr", improvementProposal: "proposta", date: "2026-08-20", responsible: "Beto", deadline: "30 dias" }) }) },
  { id: 13, version: 2, createdAt: "2026-08-12T12:00:00Z", createdBy: "Ana", responseType: "TRATATIVA", snapshot: JSON.stringify({ status: "Em revisão", analysis: "Análise V2" }) },
];
const documents = [{ id: 21, version: 1, fileName: "PAM_RNC_292_2026.docx", createdAt: "2026-08-21T12:00:00Z", responseType: "PAM" }];
const changes = [
  { id: 31, field: "status", oldValue: "Respondida", newValue: "Reprovada", changedAt: "2026-08-18T13:00:00Z", userName: "Sync" },
  { id: 32, field: "notes", oldValue: "", newValue: "x", changedAt: "2026-08-18T14:00:00Z", userName: "Sync" },
  { id: 33, field: "status", oldValue: "Reprovada", newValue: "Aprovada", changedAt: "2026-08-25T12:00:00Z", userName: "Sync" },
];

test("linha do tempo mistura todos os tipos em ordem cronológica, sem esconder respostas antigas", () => {
  const timeline = buildTimeline({ emails, versions, documents, changes });
  assert.deepEqual(timeline.map((item) => item.kind), [
    "RECEBIDA", "TRATATIVA", "TRATATIVA", "RETORNO", "REPROVACAO", "PAM", "DOCUMENTO", "APROVACAO",
  ]);
  assert.deepEqual(timeline.filter((item) => item.kind === "TRATATIVA" || item.kind === "PAM").map((item) => item.title), [
    "TRATATIVA V1 · Rascunho", "TRATATIVA V2 · Em revisão", "PAM V1 · Em revisão",
  ]);
  assert.equal(timeline.some((item) => item.title.includes("notes")), false);
});

test("alterações de status viram selos de reprovação/aprovação", () => {
  assert.equal(statusKind("Reprovada"), "REPROVACAO");
  assert.equal(statusKind("Reprovada – aguardando nova resposta"), "REPROVACAO");
  assert.equal(statusKind("Aprovada"), "APROVACAO");
  assert.equal(statusKind("PAM enviado – aguardando análise"), "STATUS");
});

test("abrir uma versão antiga mostra exatamente o que foi salvo nela", () => {
  const tratativa = describeVersion(versions[0]);
  assert.equal(tratativa.label, "Tratativa V1");
  assert.equal(tratativa.fields.find((f) => f.label === "Análise da ocorrência")?.value, "Análise V1");
  assert.equal(tratativa.fields.find((f) => f.label === "Comentário interno")?.value, "nota da tratativa");

  const pam = describeVersion(versions[1]);
  assert.equal(pam.label, "PAM V1");
  assert.equal(pam.fields.find((f) => f.label === "Tipologia da ocorrência")?.value, "Engenharia, Social");
  assert.equal(pam.fields.find((f) => f.label === "Data")?.value, "20/08/2026");
  assert.equal(pam.fields.find((f) => f.label === "Comentário interno")?.value, "nota do PAM");
  assert.equal(pam.fields.some((f) => f.label === "Análise da ocorrência"), false);
});

test("snapshot antigo, vazio ou inválido não quebra a leitura e é tratado como Tratativa", () => {
  const legacy = describeVersion({ id: 1, version: 3, createdAt: "2026-01-01T00:00:00Z", snapshot: "{{" });
  assert.equal(legacy.type, "TRATATIVA");
  assert.equal(legacy.label, "Tratativa V3");
  assert.equal(legacy.status, "—");
});

test("histórico em texto para o agente traz data, selo e título", () => {
  const text = timelineToText(buildTimeline({ emails, versions, documents, changes }), (value) => value.slice(0, 10));
  assert.ok(text.includes("2026-08-10 — TRATATIVA — TRATATIVA V1 · Rascunho (Ana)"));
  assert.ok(text.includes("2026-08-18 — REPROVAÇÃO — Status: Respondida → Reprovada"));
});
