import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { fillPamTemplate } from "../lib/docx-template";
import { buildPamReplacements, formatDateBr, sanitizePamFormData } from "../lib/response-types";

const form = sanitizePamFormData({
  typologies: ["Engenharia", "Social"],
  occurrenceDescription: "Oxidação & corrosão <severa> no pórtico",
  improvementProposal: "1) Trocar peças.\n2) Aplicar tratamento anticorrosivo.",
  date: "2026-10-02",
  responsible: "Fulano da Silva",
  deadline: "30 dias",
});

async function generate() {
  const buffer = await fillPamTemplate(
    buildPamReplacements({ number: "292", year: 2026, contract: "02.023/2024" }, form),
    form.typologies,
  );
  const zip = await JSZip.loadAsync(buffer);
  return { zip, xml: await zip.file("word/document.xml")!.async("string") };
}

const visible = (xml: string) => xml.replace(/<[^>]+>/g, "").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
const wordText = (paragraph: string) => [...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => match[1]).join("").trim();
const fileEntries = (zip: JSZip) => Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort();

test("FG 06: campos variáveis são preenchidos e nenhum marcador fica para trás", async () => {
  const { xml } = await generate();
  const text = visible(xml);
  for (const value of ["292/2026", "02.023/2024", "Oxidação & corrosão <severa> no pórtico", "Trocar peças.", "Aplicar tratamento anticorrosivo.", "02/10/2026", "Fulano da Silva", "30 dias"]) {
    assert.ok(text.includes(value), `valor ausente: ${value}`);
  }
  for (const marker of ["[RNC Nº]", "[CONTRATO]", "[Descrição da Ocorrência]", "[00/00/0000]", "[RESPONSÁVEL DA ÁREA INSPECIONADA]", "[Prazo para o PAM]", "[Descrição da Proposta de melhoria"]) {
    assert.ok(!text.includes(marker), `marcador restante: ${marker}`);
  }
});

test("FG 06: só as tipologias escolhidas têm a caixa preenchida", async () => {
  const { xml } = await generate();
  const filled = (label: string) => {
    const paragraph = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g)!.find((item) => item.includes("<wp:anchor") && wordText(item) === `${label}:`)!;
    assert.ok(paragraph, `parágrafo não encontrado: ${label}`);
    return /<\/a:prstGeom><a:solidFill><a:srgbClr val="196B24"\/>/.test(paragraph) && paragraph.includes('filled="t"');
  };
  assert.equal(filled("Engenharia"), true);
  assert.equal(filled("Social"), true);
  assert.equal(filled("Meio Ambiente"), false);
  assert.equal(filled("Seg. Trabalho"), false);
  assert.equal(filled("Outros"), false);
});

test("FG 06: estrutura, textos fixos, logos e assinaturas do modelo são preservados", async () => {
  const { zip, xml } = await generate();
  const original = await JSZip.loadAsync(await (await import("node:fs/promises")).readFile("templates/modelo-pam-fg06.docx"));
  const text = visible(xml);
  for (const fixed of ["Nº da RNC:", "TIPOLOGIA DA OCORRÊNCIA", "REVISÃO", "HISTÓRICO", "ELABORAÇÃO", "APROVAÇÃO", "ASSINATURAS", "Sabrina Paiva Ferreira", "Juliane Souza Ataíde"]) {
    assert.ok(text.includes(fixed), `texto fixo ausente: ${fixed}`);
  }
  assert.deepEqual(fileEntries(zip), fileEntries(original));
  assert.equal((xml.match(/<w:tbl>/g) || []).length, ((await original.file("word/document.xml")!.async("string")).match(/<w:tbl>/g) || []).length);
});

test("data do PAM é convertida de ISO para dd/mm/aaaa", () => {
  assert.equal(formatDateBr("2026-10-02"), "02/10/2026");
  assert.equal(formatDateBr("15 de outubro"), "15 de outubro");
});

test("valor que repete o próprio marcador não trava a geração", async () => {
  const buffer = await fillPamTemplate(
    buildPamReplacements({ number: "1", year: 2026, contract: "X" }, sanitizePamFormData({ occurrenceDescription: "veja [Descrição da Ocorrência] acima" })),
    [],
  );
  assert.ok(buffer.length > 0);
});
