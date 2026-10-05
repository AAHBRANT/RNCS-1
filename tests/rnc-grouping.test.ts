import assert from "node:assert/strict";
import test from "node:test";
import { suggestSubject } from "../lib/rnc-grouping";

test("agrupa por assunto a partir da descrição, ignorando acentos", () => {
  assert.equal(suggestSubject("DESATUALIZAÇÃO DO CRONOGRAMA"), "Cronograma desatualizado");
  assert.equal(suggestSubject("USO INADEQUADO DE ATERRO EM ARQUIBANCADAS"), "Aterro e resíduos");
  assert.equal(suggestSubject("FALHA NA INSTALAÇÃO DA ESTURUTURA METÁLICA DO RESTAURANTE"), "Estrutura metálica e oxidação");
  assert.equal(suggestSubject("FALHA NO ADENSAMENTO DAS ARQUIBANCADAS"), "Concretagem e arquibancadas");
  assert.equal(suggestSubject("ANDAIME TUBULAR"), "Segurança do trabalho e equipamentos");
  assert.equal(suggestSubject("PRESENÇA DE INFILTRAÇÃO EM REVESTIMENTO DE GESSO"), "Revestimentos, alvenaria e acabamentos");
});

test("descrição genérica fica sem grupo sugerido", () => {
  assert.equal(suggestSubject("ENGENHARIA"), null);
  assert.equal(suggestSubject(""), null);
});
