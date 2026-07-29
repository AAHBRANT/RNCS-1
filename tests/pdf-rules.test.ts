import assert from "node:assert/strict";
import test from "node:test";
import { extractRncInformation } from "../lib/pdf/extract-rnc-information";
import { processRncAttachment } from "../lib/pdf/process-rnc-attachment";
import { analysisStatusFromEmailBody } from "../lib/rnc-analysis";
import { explicitSentIdentities } from "../lib/outlook-sync";

test("identifica número e ano da RNC", () => {
  assert.deepEqual(
    extractRncInformation("RNC Nº 159/2026").rncNumber,
    "159",
  );
  assert.equal(extractRncInformation("RNC Nº 159/2026").year, 2026);
  assert.equal(extractRncInformation("RELATÓRIO DE NÃO CONFORMIDADE Nº 159").rncNumber, "159");
});

test("reprovação tem precedência sobre aprovação", () => {
  assert.equal(extractRncInformation("TRATATIVA APROVADA").analysisStatus, "APROVADA");
  assert.equal(extractRncInformation("TRATATIVA NÃO APROVADA").analysisStatus, "REPROVADA");
  assert.equal(extractRncInformation("TRATATIVA REPROVADA").analysisStatus, "REPROVADA");
  assert.equal(
    extractRncInformation("A versão anterior foi aprovada, mas a TRATATIVA NÃO APROVADA").analysisStatus,
    "REPROVADA",
  );
});

test("identifica responsável na mesma linha ou na linha seguinte", () => {
  assert.equal(
    extractRncInformation("Responsável pela tratativa: Isabella Marques").responsible,
    "Isabella Marques",
  );
  assert.equal(
    extractRncInformation("Responsável pela tratativa\nIsabella Marques").responsible,
    "Isabella Marques",
  );
});

test("mantém resultado inconclusivo quando faltam dados", () => {
  const result = extractRncInformation("Documento sem resultado conclusivo");
  assert.equal(result.responsible, null);
  assert.equal(result.analysisStatus, "STATUS_A_CONFIRMAR");
});

test("recusa anexo que não seja PDF", async () => {
  const result = await processRncAttachment({
    fileName: "evidencia.txt",
    contentType: "text/plain",
    contentBuffer: Buffer.from("RNC 159"),
  });
  assert.equal(result.success, false);
  assert.equal(result.needsOcr, false);
});

test("reporta PDF vazio", async () => {
  const result = await processRncAttachment({
    fileName: "rnc.pdf",
    contentType: "application/pdf",
    contentBuffer: Buffer.alloc(0),
  });
  assert.equal(result.success, false);
  assert.match(result.error || "", /vazio/i);
});

test("usa o corpo oficial como fonte secundária inequívoca", () => {
  assert.equal(
    analysisStatusFromEmailBody(
      "As providências tomadas estão em conformidade. As medidas atenderam ao solicitado e encaminhamos a aprovação da tratativa.",
    )?.status,
    "Aprovada",
  );
  assert.equal(
    analysisStatusFromEmailBody("A tratativa não foi aprovada e deverá ser reenviada.")?.status,
    "Reprovada",
  );
  assert.equal(
    analysisStatusFromEmailBody(
      "Encaminhamos a Análise de Tratativa de RNC referente à reprovação da tratativa encaminhada.",
    )?.status,
    "Reprovada",
  );
  assert.equal(analysisStatusFromEmailBody("Encaminhamos a análise em anexo."), null);
});

test("não atribui resposta às RNCs apenas citadas no histórico", () => {
  const result = explicitSentIdentities(
    "RES: Encaminhamento das RNC 143/2026, 144/2026, 145/2026 e 146/2026",
    "Prezados, encaminhamos somente a RNC 146.\nDe: Supervisão\nForam emitidas as RNC 143/2026, 144/2026, 145/2026 e 146/2026.",
    ["Resposta RNC 146_2026.pdf"],
  );
  assert.deepEqual(result, [{ number: "146", year: 2026 }]);
});

test("classifica aprovacoes de varias tratativas pelo corpo do e-mail", () => {
  assert.equal(
    analysisStatusFromEmailBody(
      "Apos verificacao, confirmou-se que as providencias tomadas pela empresa estao em conformidade com as solicitacoes dos RNCs 090/2025 e 091/2025. Desse modo, visto que as medidas atenderam ao solicitado, encaminhamos anexo as Analises de Tratativas de RNC referentes as aprovacoes das tratativas encaminhadas.",
    )?.status,
    "Aprovada",
  );
});

test("identifica todas as RNCs declaradas no corpo atual mesmo com anexos fora do padrao", () => {
  const result = explicitSentIdentities(
    "RES: Encaminhamento de RNC 167/2026, 168/2026, 169/2026 e 170/2026",
    "Encaminhamos em anexo os Relatorios de Nao Conformidade (RNCs) Nº 167/2026, 168/2026, 169/2026 e 170/2026. De: Supervisao. Assunto: RNC 167/2026 a 173/2026.",
    [
      "FG 13 - TRATATIVA DE RNC 167_2026.pdf",
      "FG 13 - TRATATIVA DE RNC 168.pdf",
      "FG 13 - TRATATIVA DE RNC 169 EPI;2026.pdf",
      "FG 13 - TRATATIVA DE RNC 170_2026.pdf",
    ],
  );
  assert.deepEqual(result, [
    { number: "167", year: 2026 },
    { number: "170", year: 2026 },
    { number: "168", year: 2026 },
    { number: "169", year: 2026 },
  ]);
});
