import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { normalizeDocxForPreview } from "../lib/docx-preview-normalizer";

test("reduz apenas tabelas que ultrapassam a área útil da página", async () => {
  const zip = new JSZip();
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:tbl>
          <w:tblPr><w:tblW w:w="10485" w:type="dxa"/></w:tblPr>
          <w:tblGrid><w:gridCol w:w="5000"/><w:gridCol w:w="5485"/></w:tblGrid>
          <w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr></w:tc>
          <w:tc><w:tcPr><w:tcW w:w="5485" w:type="dxa"/></w:tcPr></w:tc></w:tr>
        </w:tbl>
        <w:sectPr>
          <w:pgSz w:w="11900" w:h="16840"/>
          <w:pgMar w:top="1418" w:right="1134" w:bottom="1560" w:left="1418"/>
        </w:sectPr>
      </w:body>
    </w:document>`);
  const source = await zip.generateAsync({ type: "arraybuffer" });

  const normalized = await normalizeDocxForPreview(source);
  const result = await JSZip.loadAsync(normalized);
  const xml = await result.file("word/document.xml")!.async("string");
  const columns = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)]
    .map((match) => Number(match[1]));

  assert.equal(columns.reduce((total, width) => total + width, 0), 9348);
  assert.match(xml, /<w:tblW w:w="9348" w:type="dxa"\/>/);
  assert.ok(xml.includes("<w:document"));
  assert.ok(!xml.includes("<ns0:document"));
});
