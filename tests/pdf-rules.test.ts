import assert from "node:assert/strict";
import test from "node:test";
import { extractRncInformation } from "../lib/pdf/extract-rnc-information";
import { processRncAttachment } from "../lib/pdf/process-rnc-attachment";

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
