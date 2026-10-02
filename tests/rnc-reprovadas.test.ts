import assert from "node:assert/strict";
import test from "node:test";
import { extractFg14Reason, rejectionReason } from "../lib/rnc-reprovadas";

const FG14 = `FORMULÁRIO GERAL – FG
IDENT: ANÁLISE DE TRATATIVA DE RNC SIGLA: FG 14 VERSÃO: 00 PÁG: 1/2
241/2026 27/04/2026 30/07/2026 X 26/08/2026
NÃO X REPROVADO X
INFORMAÇÕES COMPLEMENTARES DA VERIFICAÇÃO DA RNC
As medidas informadas não são suficientes para comprovar o
saneamento da condição.
Não foram apresentadas evidências.
-- 1 of 2 --

FORMULÁRIO GERAL – FG
Responsável pela Inspeção
`;

test("extrai o texto do campo de informações complementares do FG 14", () => {
  const text = extractFg14Reason(FG14);
  assert.match(text, /^As medidas informadas não são suficientes para comprovar o saneamento da condição\./);
  assert.match(text, /Não foram apresentadas evidências\.$/);
  assert.doesNotMatch(text, /FORMULÁRIO|of 2/);
});

test("usa o FG 14 da própria RNC quando o e-mail traz vários", () => {
  const events = [{
    id: 7,
    occurredAt: "2026-08-26T12:00:00Z",
    summary: "corpo",
    attachmentMetadata: JSON.stringify([
      { id: "a1", name: "FG 14 - ANÁLISE DE TRATATIVA DE RNC 143_2026.pdf", extractedText: FG14.replace("241/2026", "143/2026").replace("As medidas", "OUTRA") },
      { id: "a1", name: "FG 14 - ANÁLISE DE TRATATIVA DE RNC 241_2026.pdf", extractedText: FG14 },
    ]),
  }];
  const result = rejectionReason({ number: "241", year: 2026 }, events);
  assert.equal(result.source, "FG 14");
  assert.match(result.text, /^As medidas/);
});

test("nome de arquivo com underscores (FG_14_-_...) também é reconhecido", () => {
  const events = [{ id: 1, occurredAt: "2026-08-24T12:00:00Z", summary: "corpo", attachmentMetadata: JSON.stringify([{ id: "a1", name: "FG_14_-_ANÁLISE_DE_TRATATIVA_DE_RNC_292_2026_-_X.pdf", extractedText: FG14.replace("241/2026", "292/2026") }]) }];
  assert.equal(rejectionReason({ number: "292", year: 2026 }, events).source, "FG 14");
});

test("nunca usa o corpo do e-mail; FG 14 sem texto vira aviso", () => {
  const scanned = rejectionReason({ number: "95", year: 2026 }, [{ id: 1, occurredAt: "2026-05-22T00:00:00Z", summary: "Prezados, Constatou-se...", attachmentMetadata: JSON.stringify([{ id: "a1", name: "FG 14 - ANÁLISE DE TRATATIVA DE RNC 095_2026.pdf", extractedText: "" }]) }]);
  assert.equal(scanned.source, "Não localizado");
  assert.match(scanned.text, /imagem/);
  assert.equal(scanned.document?.attachmentId, "a1");
  assert.equal(rejectionReason({ number: "1", year: 2026 }, []).source, "Não localizado");
});
