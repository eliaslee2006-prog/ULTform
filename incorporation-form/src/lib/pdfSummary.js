// Generates the customer copy: a modern, cleanly-styled A4 PDF summary of the submitted
// data (not a replica of the original table-layout PDF). Uses pdf-lib client-side, the
// same library ULTform's js/pdf-flatten.js already relies on.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { DEFAULT_FORM_SCHEMA } from '../data/formSchema.js';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 50;
const NAVY = rgb(0x16 / 255, 0x23 / 255, 0x3f / 255);
const TEXT = rgb(0.11, 0.13, 0.2);
const MUTED = rgb(0.42, 0.45, 0.52);

function labelFor(fieldId, options) {
  return (options || []).map((o) => o.label);
}

function formatValue(field, formState) {
  const raw = formState[field.id];
  if (field.type === 'checkbox-group') {
    if (!Array.isArray(raw) || raw.length === 0) return '—';
    const labels = field.options.filter((o) => raw.includes(o.value)).map((o) => o.label);
    return labels.join(', ') || '—';
  }
  if (raw === '' || raw === undefined || raw === null) return '—';
  return String(raw);
}

// Flattens FORM_SCHEMA + formState into printable groups, skipping the signature block
// (drawn separately) and any conditionally-hidden field left blank.
function buildGroups(formState, schema) {
  const groups = [];
  for (const section of schema) {
    if (section.id === 'part11') continue; // signature handled separately
    const pushGroup = (title, fields) => {
      const rows = fields
        .filter((f) => f.type !== 'signature')
        .map((f) => ({ label: f.label, value: formatValue(f, formState) }));
      groups.push({ title, rows });
    };
    if (section.fields) pushGroup(section.title, section.fields);
    if (section.subsections) {
      for (const sub of section.subsections) pushGroup(`${section.title} — ${sub.title}`, sub.fields);
    }
  }
  return groups;
}

function wrapText(text, font, size, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(attempt, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = attempt;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function generateSummaryPdf(formState, { generatedAt = new Date(), schema = DEFAULT_FORM_SCHEMA } = {}) {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - MARGIN;

  const newPage = () => {
    page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
    y = A4_HEIGHT - MARGIN;
  };
  const ensureSpace = (needed) => {
    if (y - needed < MARGIN + 30) newPage();
  };

  // Title block
  page.drawRectangle({ x: 0, y: A4_HEIGHT - 90, width: A4_WIDTH, height: 90, color: NAVY });
  page.drawText('Incorporation Factsheet', { x: MARGIN, y: A4_HEIGHT - 45, size: 20, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText('Submission Summary', { x: MARGIN, y: A4_HEIGHT - 66, size: 11, font: fontRegular, color: rgb(0.85, 0.88, 0.95) });
  page.drawText(`Generated ${generatedAt.toLocaleString()}`, {
    x: MARGIN,
    y: A4_HEIGHT - 82,
    size: 9,
    font: fontRegular,
    color: rgb(0.75, 0.79, 0.9)
  });
  y = A4_HEIGHT - 120;

  const groups = buildGroups(formState, schema);

  for (const group of groups) {
    ensureSpace(40);
    page.drawRectangle({ x: MARGIN, y: y - 20, width: A4_WIDTH - MARGIN * 2, height: 22, color: NAVY });
    page.drawText(group.title.toUpperCase(), { x: MARGIN + 8, y: y - 15, size: 10, font: fontBold, color: rgb(1, 1, 1) });
    y -= 32;

    for (const row of group.rows) {
      const labelWidth = 170;
      const valueMaxWidth = A4_WIDTH - MARGIN * 2 - labelWidth - 10;
      const lines = wrapText(row.value, fontRegular, 10, valueMaxWidth);
      const rowHeight = Math.max(16, lines.length * 13);
      ensureSpace(rowHeight + 6);

      page.drawText(row.label, { x: MARGIN, y, size: 9.5, font: fontBold, color: MUTED });
      lines.forEach((line, i) => {
        page.drawText(line, { x: MARGIN + labelWidth, y: y - i * 13, size: 10, font: fontRegular, color: TEXT });
      });
      y -= rowHeight + 6;
    }
    y -= 10;
  }

  // Signature block
  ensureSpace(150);
  page.drawRectangle({ x: MARGIN, y: y - 20, width: A4_WIDTH - MARGIN * 2, height: 22, color: NAVY });
  page.drawText('CONFIRMATION & SIGNATURE', { x: MARGIN + 8, y: y - 15, size: 10, font: fontBold, color: rgb(1, 1, 1) });
  y -= 40;

  if (formState.signature) {
    try {
      const pngBytes = await fetch(formState.signature).then((r) => r.arrayBuffer());
      const pngImage = await pdfDoc.embedPng(pngBytes);
      const sigW = 200;
      const sigH = (pngImage.height / pngImage.width) * sigW;
      ensureSpace(sigH + 40);
      page.drawImage(pngImage, { x: MARGIN, y: y - sigH, width: sigW, height: sigH });
      y -= sigH + 10;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + 220, y }, thickness: 1, color: MUTED });
      y -= 16;
    } catch {
      // fall through — still print name/date below
    }
  }

  page.drawText(`Name: ${formState.signature_name || '—'}`, { x: MARGIN, y, size: 10, font: fontRegular, color: TEXT });
  page.drawText(`Date: ${formState.signature_date || '—'}`, { x: MARGIN + 260, y, size: 10, font: fontRegular, color: TEXT });

  // Footer page numbers
  const pages = pdfDoc.getPages();
  pages.forEach((p, i) => {
    p.drawText(`Page ${i + 1} of ${pages.length}`, {
      x: A4_WIDTH - MARGIN - 60,
      y: MARGIN - 20,
      size: 8,
      font: fontRegular,
      color: MUTED
    });
  });

  const bytes = await pdfDoc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}
