import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import path from "node:path";

type TemplatePhoto = { buffer: Buffer; contentType: "image/png" | "image/jpeg" };

const TEMPLATE_PATH = path.join(process.cwd(), "templates", "modelo-tratativa-rnc.docx");
const PAM_TEMPLATE_PATH = path.join(process.cwd(), "templates", "modelo-pam-fg06.docx");
const CHECKED_BOX_COLOR = "196B24";
const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function decodeXml(value: string) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function encodeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function textXml(value: string) {
  return encodeXml(value).replace(/\r?\n/g, `</w:t><w:br/><w:t xml:space="preserve">`);
}

function replaceMarkerInParagraph(paragraph: string, marker: string, value: string) {
  const matches = [...paragraph.matchAll(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g)];
  if (!matches.length) return paragraph;
  const texts = matches.map((match) => decodeXml(match[2]));
  const combined = texts.join("");
  const start = combined.indexOf(marker);
  if (start < 0) return paragraph;
  const end = start + marker.length;
  let offset = 0;
  let startNode = 0;
  let endNode = 0;
  for (let index = 0; index < texts.length; index++) {
    const next = offset + texts[index].length;
    if (start >= offset && start <= next) startNode = index;
    if (end >= offset && end <= next) { endNode = index; break; }
    offset = next;
  }
  const beforeOffset = texts.slice(0, startNode).join("").length;
  const endOffset = texts.slice(0, endNode).join("").length;
  const updated = [...texts];
  updated[startNode] = texts[startNode].slice(0, start - beforeOffset)
    + value
    + (startNode === endNode ? texts[startNode].slice(end - beforeOffset) : "");
  for (let index = startNode + 1; index < endNode; index++) updated[index] = "";
  if (endNode !== startNode) updated[endNode] = texts[endNode].slice(end - endOffset);

  let nodeIndex = 0;
  return paragraph.replace(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g, (_full, attributes: string) => {
    const content = textXml(updated[nodeIndex++]);
    return `<w:t${attributes || ' xml:space="preserve"'}>${content}</w:t>`;
  });
}

function replaceText(xml: string, replacements: Record<string, string>) {
  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
    let updated = paragraph;
    for (const [marker, value] of Object.entries(replacements)) {
      const occurrences = decodeXml(updated.replace(/<[^>]+>/g, "")).split(marker).length - 1;
      for (let count = 0; count < occurrences; count++) {
        const next = replaceMarkerInParagraph(updated, marker, value);
        if (next === updated) break;
        updated = next;
      }
    }
    return updated;
  });
}

function imageDimensions(buffer: Buffer, contentType: string) {
  if (contentType === "image/png" && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (contentType === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      offset += Math.max(length + 2, 2);
    }
  }
  return { width: 4, height: 3 };
}

function drawingXml(relationId: string, id: number, name: string, cx: number, cy: number) {
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
    <wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${encodeXml(name)}"/>
    <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:nvPicPr><pic:cNvPr id="${id}" name="${encodeXml(name)}"/><pic:cNvPicPr/></pic:nvPicPr>
          <pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relationId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
          <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:inline></w:drawing></w:r>`;
}

export async function fillRncTemplate(
  replacements: Record<string, string>,
  photos: Array<TemplatePhoto | null>,
) {
  const template = await readFile(TEMPLATE_PATH);
  const zip = await JSZip.loadAsync(template);
  const documentFile = zip.file("word/document.xml");
  const relationsFile = zip.file("word/_rels/document.xml.rels");
  const contentTypesFile = zip.file("[Content_Types].xml");
  if (!documentFile || !relationsFile || !contentTypesFile) throw new Error("Modelo Word inválido.");

  let documentXml = replaceText(await documentFile.async("string"), replacements);
  let relationsXml = await relationsFile.async("string");
  let contentTypesXml = await contentTypesFile.async("string");
  const relationNumbers = [...relationsXml.matchAll(/Id="rId(\d+)"/g)].map((item) => Number(item[1]));
  let nextRelation = Math.max(0, ...relationNumbers) + 1;
  let drawingId = 1000;

  for (let index = 0; index < photos.length; index++) {
    const photo = photos[index];
    if (!photo) continue;
    const marker = `[FOTO_${index + 1}]`;
    const extension = photo.contentType === "image/png" ? "png" : "jpg";
    const mediaName = `rnc-photo-${index + 1}-${Date.now()}.${extension}`;
    const relationId = `rId${nextRelation++}`;
    const dimensions = imageDimensions(photo.buffer, photo.contentType);
    const maxWidth = 2_450_000;
    const maxHeight = 1_850_000;
    const scale = Math.min(maxWidth / dimensions.width, maxHeight / dimensions.height);
    const cx = Math.round(dimensions.width * scale);
    const cy = Math.round(dimensions.height * scale);

    zip.file(`word/media/${mediaName}`, photo.buffer);
    relationsXml = relationsXml.replace(
      "</Relationships>",
      `<Relationship Id="${relationId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaName}"/></Relationships>`,
    );
    if (!contentTypesXml.includes(`Extension="${extension}"`)) {
      contentTypesXml = contentTypesXml.replace(
        "</Types>",
        `<Default Extension="${extension}" ContentType="${photo.contentType}"/></Types>`,
      );
    }
    documentXml = documentXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
      const visible = decodeXml(paragraph.replace(/<[^>]+>/g, ""));
      if (!visible.includes(marker)) return paragraph;
      const opening = paragraph.match(/^<w:p\b[^>]*>/)?.[0] || `<w:p xmlns:w="${WORD_NS}">`;
      const properties = paragraph.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] || "";
      return `${opening}${properties}${drawingXml(relationId, drawingId++, mediaName, cx, cy)}</w:p>`;
    });
  }

  // Empty photo slots are intentionally cleared instead of leaking template markers.
  documentXml = replaceText(documentXml, Object.fromEntries(
    [1, 2, 3, 4].map((number) => [`[FOTO_${number}]`, ""]),
  ));
  zip.file("word/document.xml", documentXml);
  zip.file("word/_rels/document.xml.rels", relationsXml);
  zip.file("[Content_Types].xml", contentTypesXml);
  return Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

// As caixas de tipologia do FG 06 são formas desenhadas (uma por rótulo). Marcar = preencher a forma,
// o que preserva posição, tamanho e borda originais do modelo.
export function markTypologyBoxes(xml: string, checkedLabels: string[]) {
  if (!checkedLabels.length) return xml;
  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
    if (!paragraph.includes("<wp:anchor")) return paragraph;
    // Só <w:t>: o texto cru do parágrafo inclui números de posição (posOffset) da própria forma.
    const visible = decodeXml([...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => match[1]).join("")).trim();
    const label = checkedLabels.find((item) => visible === `${item}:`);
    if (!label) return paragraph;
    return paragraph
      .replace("<a:noFill/>", `<a:solidFill><a:srgbClr val="${CHECKED_BOX_COLOR}"/></a:solidFill>`)
      .replace('filled="f"', `filled="t" fillcolor="#${CHECKED_BOX_COLOR.toLowerCase()}"`);
  });
}

export async function fillPamTemplate(replacements: Record<string, string>, checkedTypologies: string[]) {
  const zip = await JSZip.loadAsync(await readFile(PAM_TEMPLATE_PATH));
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("Modelo Word do PAM inválido.");
  let documentXml = replaceText(await documentFile.async("string"), replacements);
  documentXml = markTypologyBoxes(documentXml, checkedTypologies);
  zip.file("word/document.xml", documentXml);
  return Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}
