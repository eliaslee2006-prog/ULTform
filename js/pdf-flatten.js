import { PDFDocument, rgb } from 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';

export async function getPageDimensions(templateBytes, pageIndex = 0) {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const page = pdfDoc.getPage(pageIndex);
  const { width, height } = page.getSize();
  return { width, height };
}

export async function flattenDocument(templateBytes, fields) {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const pageCache = new Map();

  for (const field of fields) {
    const pageIndex = field.pageIndex || 0;
    let entry = pageCache.get(pageIndex);
    if (!entry) {
      const page = pdfDoc.getPage(pageIndex);
      const { width, height } = page.getSize();
      entry = { page, width, height };
      pageCache.set(pageIndex, entry);
    }
    const { page, width: pageW, height: pageH } = entry;

    const pdfX = field.xPct * pageW;
    const pdfY = pageH - field.yPct * pageH;

    if (field.type === 'text' && field.value) {
      page.drawText(field.value, { x: pdfX, y: pdfY, size: 11, color: rgb(0.1, 0.1, 0.1) });
    } else if (field.type === 'checkbox' && field.checked) {
      page.drawText('X', { x: pdfX, y: pdfY, size: 12, color: rgb(0.1, 0.1, 0.1) });
    } else if (field.type === 'date' && field.value) {
      page.drawText(field.value, { x: pdfX, y: pdfY, size: 11, color: rgb(0.1, 0.1, 0.1) });
    } else if (field.type === 'signature' && field.pngDataUrl) {
      const pngBytes = await fetch(field.pngDataUrl).then(r => r.arrayBuffer());
      const pngImage = await pdfDoc.embedPng(pngBytes);
      const sigW = field.widthPct * pageW;
      const sigH = field.heightPct * pageH;
      page.drawImage(pngImage, {
        x: pdfX,
        y: pageH - field.yPct * pageH - sigH,
        width: sigW,
        height: sigH
      });
    }
  }

  return pdfDoc.save();
}
