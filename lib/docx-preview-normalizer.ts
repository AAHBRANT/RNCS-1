import JSZip from "jszip";

function numericAttribute(xml: string, name: string) {
  const match = xml.match(new RegExp(`\\bw:${name}="(\\d+)"`));
  return match ? Number(match[1]) : 0;
}

function scaleTable(table: string, availableWidth: number) {
  const indentTag = table.match(/<w:tblInd\b[^>]*\/>/)?.[0] || "";
  const indent = numericAttribute(indentTag, "w");
  const maximumWidth = Math.max(1, availableWidth - indent);
  const columnWidths = [...table.matchAll(/<w:gridCol\b[^>]*\bw:w="(\d+)"[^>]*\/>/g)]
    .map((match) => Number(match[1]));
  const totalWidth = columnWidths.reduce((total, width) => total + width, 0);
  if (!totalWidth || totalWidth <= maximumWidth + 1) return table;

  const ratio = maximumWidth / totalWidth;
  const scaledWidths = columnWidths.map((width) => Math.round(width * ratio));
  scaledWidths[scaledWidths.length - 1] += maximumWidth
    - scaledWidths.reduce((total, width) => total + width, 0);
  let columnIndex = 0;

  let normalized = table.replace(
    /(<w:gridCol\b[^>]*\bw:w=")(\d+)("[^>]*\/>)/g,
    (_match, before: string, _width: string, after: string) =>
      `${before}${scaledWidths[columnIndex++]}${after}`,
  );
  normalized = normalized.replace(
    /(<w:tblW\b[^>]*\bw:w=")(\d+)("[^>]*\bw:type="dxa"[^>]*\/>)/,
    `$1${maximumWidth}$3`,
  );
  normalized = normalized.replace(
    /(<w:tcW\b[^>]*\bw:w=")(\d+)("[^>]*\bw:type="dxa"[^>]*\/>)/g,
    (_match, before: string, width: string, after: string) =>
      `${before}${Math.round(Number(width) * ratio)}${after}`,
  );
  return normalized;
}

export async function normalizeDocxForPreview(buffer: ArrayBuffer) {
  const zip = await JSZip.loadAsync(buffer);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) return buffer;

  const xml = await documentFile.async("string");
  const section = xml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)?.[0] || "";
  const pageSize = section.match(/<w:pgSz\b[^>]*\/>/)?.[0] || "";
  const margins = section.match(/<w:pgMar\b[^>]*\/>/)?.[0] || "";
  const pageWidth = numericAttribute(pageSize, "w");
  const availableWidth = pageWidth
    - numericAttribute(margins, "left")
    - numericAttribute(margins, "right");
  if (availableWidth <= 0) return buffer;

  const normalized = xml.replace(
    /<w:tbl>[\s\S]*?<\/w:tbl>/g,
    (table) => scaleTable(table, availableWidth),
  );
  if (normalized === xml) return buffer;

  zip.file("word/document.xml", normalized);
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}
