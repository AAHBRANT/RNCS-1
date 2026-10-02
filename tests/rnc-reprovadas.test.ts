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
    occurredAt: "2026-08-26T12:00:00Z",
    summary: "corpo",
    attachmentMetadata: JSON.stringify([
      { name: "FG 14 - ANÁLISE DE TRATATIVA DE RNC 143_2026.pdf", extractedText: FG14.replace("241/2026", "143/2026").replace("As medidas", "OUTRA") },
      { name: "FG 14 - ANÁLISE DE TRATATIVA DE RNC 241_2026.pdf", extractedText: FG14 },
    ]),
  }];
  const result = rejectionReason({ number: "241", year: 2026 }, events);
  assert.equal(result.source, "FG 14");
  assert.match(result.text, /^As medidas/);
});

test("sem FG 14, cai para o corpo do e-mail e depois para 'não localizado'", () => {
  const email = rejectionReason({ number: "1", year: 2026 }, [{ occurredAt: "2026-01-01T00:00:00Z", summary: "Prezados, Constatou-se que a tratativa não foi satisfatória.", attachmentMetadata: null }]);
  assert.equal(email.source, "E-mail");
  assert.match(email.text, /^Constatou-se/);
  assert.equal(rejectionReason({ number: "1", year: 2026 }, []).source, "Não localizado");
});
