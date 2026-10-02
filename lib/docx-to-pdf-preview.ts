// O mammoth ignora formas desenhadas, como as caixas de tipologia do FG 06. Só para a
// visualização, as caixas preenchidas ganham um "[X]" no rótulo; o arquivo Word não é alterado.
export async function addCheckedBoxMarksForPreview(docxBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(docxBuffer);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) return docxBuffer;
  const xml = await documentFile.async("string");
  let changed = false;
  const marked = xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
    // A borda da forma também é verde; só o preenchimento vem logo após a geometria.
    const checked = paragraph.includes("<wp:anchor") && /<\/a:prstGeom><a:solidFill><a:srgbClr val="196B24"\/>/.test(paragraph);
    if (!checked) return paragraph;
    changed = true;
    return paragraph.replace(/<\/w:p>$/, '<w:r><w:t xml:space="preserve"> [X]</w:t></w:r></w:p>');
  });
  if (!changed) return docxBuffer;
  zip.file("word/document.xml", marked);
  return zip.generateAsync({ type: "arraybuffer" });
}

export async function convertDocxToPdfBlob(docxBuffer: ArrayBuffer): Promise<Blob> {
  const mammoth = await import("mammoth");
  const previewBuffer = await addCheckedBoxMarksForPreview(docxBuffer);
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: previewBuffer });

  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-9999px;top:0;width:794px;background:#fff;padding:40px;box-sizing:border-box;";
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    const { default: html2canvas } = await import("html2canvas");
    const canvas = await html2canvas(container, { scale: 2, useCORS: true });
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const imgData = canvas.toDataURL("image/jpeg", 0.92);

    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    return pdf.output("blob");
  } finally {
    document.body.removeChild(container);
  }
}
