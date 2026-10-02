import assert from "node:assert/strict";
import test from "node:test";
import { analysisStatus } from "../lib/outlook-sync";
import { extractRncInformation } from "../lib/pdf/extract-rnc-information";

// Todo FG 14 traz os rótulos "APROVADO" e "REPROVADO" (caixas de marcação), independentemente do resultado.
const header = [
  "FORMULÁRIO GERAL – FG",
  "IDENT: ANÁLISE DE TRATATIVA DE RNC SIGLA: FG 14 VERSÃO: 00 PÁG: 1/2",
  "AVALIAÇÃO DE TRATATIVA DE RNC – STATUS",
  "AÇÃO CORRETIVA EFICAZ SIM STATUS DA RNC",
  "ANALISADA",
  "APROVADO",
  "NÃO X REPROVADO X",
  "INFORMAÇÕES COMPLEMENTARES DA VERIFICAÇÃO DA RNC",
].join("\n");

const approved = `${header}\nA tratativa atende ao solicitado.\nDiante dos fatos, considera-se a tratativa aprovada.`;
const rejected = `${header}\nA justificativa não elimina a irregularidade.\nDiante dos fatos, considera-se a tratativa reprovada.`;
const onlyLabels = `${header}\nTexto sem conclusão explícita.`;

test("rótulos APROVADO/REPROVADO do formulário não definem o resultado sozinhos", () => {
  assert.equal(analysisStatus(onlyLabels).status, "Retorno recebido — status a confirmar");
  assert.equal(extractRncInformation(onlyLabels).analysisStatus, "STATUS_A_CONFIRMAR");
});

test("conclusão escrita define o resultado, mesmo com os dois rótulos no formulário", () => {
  assert.equal(analysisStatus(approved).status, "Aprovada");
  assert.equal(analysisStatus(rejected).status, "Reprovada");
  assert.equal(extractRncInformation(approved).analysisStatus, "APROVADA");
  assert.equal(extractRncInformation(rejected).analysisStatus, "REPROVADA");
});

test("frase 'objeto de aprovação' (RNC 227/2026) continua reconhecida", () => {
  const text = `${header}\nA justificativa técnica foi objeto de aprovação pelo fiscal contratual.`;
  assert.equal(extractRncInformation(text).analysisStatus, "APROVADA");
});

test("documento sem texto continua pendente de conferência", () => {
  assert.equal(analysisStatus("   ").status, "Retorno recebido — status a confirmar");
});
