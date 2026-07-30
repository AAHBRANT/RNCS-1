import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { fillRncTemplate } from "../lib/docx-template";

test("o modelo Word preserva a estrutura e substitui todos os campos", async () => {
  const values = {
    "[NÚMERO_RNC]": "269/2026",
    "[DATA_EMISSÃO]": "29/07/2026",
    "[DATA_HOJE]": "30/07/2026",
    "[LOCAL/ FRENTE]": "Parque Socioambiental do Roger – Fase II",
    "[CONTRATO]": "CT 02.023/2024 – UEP/SEGGOV",
    "[RESPONSÁVEL PELA ÁREA]": "ISABELLA MARQUES",
    "[DESCRIÇÃO_OCORRÊNCIA]": "Análise preenchida",
    "[MEDIDAS_CORRETIVAS]": "Medidas preenchidas",
    "[OBSERVAÇÕES]": "Observação preenchida",
    "[LEGENDA1]": "Frente da ação",
    "[LEGENDA2]": "",
    "[LEGENDA3]": "",
    "[LEGENDA4]": "",
  };

  const generated = await fillRncTemplate(values, [null, null, null, null]);
  const zip = await JSZip.loadAsync(generated);
  const xml = await zip.file("word/document.xml")!.async("string");

  assert.ok(xml.includes("<w:document"));
  assert.ok(xml.includes("<w:p"));
  assert.ok(!xml.includes("<ns0:document"));
  for (const value of Object.values(values).filter(Boolean)) {
    assert.ok(xml.includes(value.replaceAll("&", "&amp;")), `valor ausente: ${value}`);
  }
  assert.ok(!xml.includes("[FOTO_"));
});
