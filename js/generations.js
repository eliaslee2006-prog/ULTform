import { PDFDocument, StandardFonts, rgb } from 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';
import { WORKER_BASE_URL } from './worker-config.js';

const MAX_CHARS = 20000; // matches the Worker's own cap — warn before sending past it
const PAGE_WIDTH = 595.28; // A4 at 72dpi, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
// Generous enough that consecutive field overlays (each at least 44px tall once
// rendered, per .field's own CSS min-height) never visually overlap even on a
// short/narrow page-block — a tight row spacing looked fine in the flat PDF text
// but stacked the interactive field boxes right on top of each other.
const ROW_HEIGHT = 64;

let draft = null; // { title, sections } from Gemini, plus a flat editable `fields` list
let onOpenDocument = null; // injected by app.js — avoids a circular import with app.js

export function setOpenDocumentHandler(fn) {
  onOpenDocument = fn;
}

// .docx is a zip; word/document.xml holds the text as a run of <w:t> elements between
// paragraph markers. This is the same tag-stripping approach used to recover the
// original corrupted Factsheet source earlier in this project — good enough for text
// content, not attempting to preserve tables/formatting.
async function extractDocxText(file) {
  const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xmlFile = zip.file('word/document.xml');
  if (!xmlFile) throw new Error('Not a valid .docx file (missing word/document.xml)');
  const xml = await xmlFile.async('text');
  return xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractText(file) {
  if (file.name.toLowerCase().endsWith('.docx')) return extractDocxText(file);
  return (await file.text()).trim();
}

async function requestDraft(text) {
  const resp = await fetch(`${WORKER_BASE_URL}/generations/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  const data = await resp.json();
  if (!data.success) throw new Error(data.error || 'Draft failed');
  return data;
}

function flattenFields(sections) {
  const flat = [];
  sections.forEach((section, sIdx) => {
    (section.fields || []).forEach((field, fIdx) => {
      flat.push({ uid: `${sIdx}-${fIdx}`, section: section.heading, label: field.label, type: field.type });
    });
  });
  return flat;
}

// Lays every field out as a simple vertical flow — one row per field, grouped under
// its section heading — wrapping onto additional A4 pages as it runs out of room.
// This is a plain, readable default layout, not a recreation of any original document
// formatting (the source text has none we can reliably recover anyway).
async function buildPdf(title, fields) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const accent = rgb(0x3E / 255, 0x63 / 255, 0xDD / 255);
  const ink = rgb(0.1, 0.1, 0.13);

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  const overlayFields = [];
  let pageIndex = 0;

  function newPage() {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pageIndex += 1;
    y = PAGE_HEIGHT - MARGIN;
  }

  page.drawRectangle({ x: 0, y: y - 34, width: PAGE_WIDTH, height: 40, color: accent });
  page.drawText(title, { x: MARGIN, y: y - 24, size: 15, font, color: rgb(1, 1, 1) });
  y -= 60;

  let lastSection = null;
  fields.forEach((field) => {
    if (y < MARGIN + ROW_HEIGHT * 2) newPage();
    if (field.section && field.section !== lastSection) {
      lastSection = field.section;
      page.drawText(field.section, { x: MARGIN, y, size: 11, font, color: accent });
      y -= 20;
    }
    page.drawText(field.label, { x: MARGIN, y, size: 10, font: bodyFont, color: ink });
    const lineY = y - 4;
    page.drawLine({ start: { x: MARGIN + 160, y: lineY }, end: { x: PAGE_WIDTH - MARGIN, y: lineY }, thickness: 0.75, color: rgb(0.7, 0.7, 0.72) });

    overlayFields.push({
      pageIndex,
      type: field.type,
      xPct: (MARGIN + 166) / PAGE_WIDTH,
      yPct: 1 - (y + 6) / PAGE_HEIGHT
    });
    y -= ROW_HEIGHT;
  });

  const pdfBytes = await doc.save();
  return { pdfBytes, overlayFields };
}

function renderReview() {
  const list = document.getElementById('generationsFieldList');
  list.innerHTML = '';
  draft.fields.forEach((field) => {
    const row = document.createElement('div');
    row.className = 'gen-field-row';

    const label = document.createElement('div');
    label.className = 'gen-field-label';
    label.textContent = field.label;
    label.title = field.section ? `${field.section} · ${field.label}` : field.label;
    row.appendChild(label);

    const select = document.createElement('select');
    select.className = 'gen-field-type';
    ['text', 'checkbox', 'date', 'signature'].forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t[0].toUpperCase() + t.slice(1);
      if (t === field.type) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => { field.type = select.value; });
    row.appendChild(select);

    const delBtn = document.createElement('button');
    delBtn.className = 'gen-field-delete';
    delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';
    delBtn.addEventListener('click', () => {
      draft.fields = draft.fields.filter((f) => f.uid !== field.uid);
      renderReview();
    });
    row.appendChild(delBtn);

    list.appendChild(row);
  });
  document.getElementById('generationsReview').classList.remove('hidden');
  document.getElementById('generationsTitle').value = draft.title;
}

function setStatus(text) {
  document.getElementById('generationsStatus').textContent = text;
}

async function handleFile(file) {
  const importTile = document.getElementById('generationsImportTile');
  document.getElementById('generationsReview').classList.add('hidden');
  setStatus('Reading document…');
  importTile.classList.add('busy');
  try {
    const text = await extractText(file);
    if (!text) throw new Error('No text found in that file');
    if (text.length > MAX_CHARS) {
      setStatus(`Reading document… (using the first ~${Math.round(MAX_CHARS / 5)} words — the rest was trimmed to keep this quick)`);
    } else {
      setStatus('Drafting a form from the text…');
    }
    const result = await requestDraft(text);
    draft = { title: result.title, fields: flattenFields(result.sections) };
    if (!draft.fields.length) throw new Error("Couldn't find anything to turn into fields in that document");
    setStatus(`Drafted "${draft.title}" — ${draft.fields.length} field${draft.fields.length > 1 ? 's' : ''}. Review before opening.`);
    renderReview();
  } catch (err) {
    console.error('Generation failed', err);
    setStatus(`Couldn't generate a form: ${err.message}`);
  } finally {
    importTile.classList.remove('busy');
  }
}

async function openDraft() {
  if (!draft || !draft.fields.length) return;
  const title = document.getElementById('generationsTitle').value.trim() || draft.title;
  const { pdfBytes, overlayFields } = await buildPdf(title, draft.fields);
  const id = `gen-${crypto.randomUUID()}`;
  await onOpenDocument({ id, name: title, pdfBytes }, overlayFields);
  draft = null;
  document.getElementById('generationsReview').classList.add('hidden');
  setStatus('');
}

export function initGenerationsTab() {
  const tile = document.getElementById('generationsImportTile');
  const input = document.getElementById('generationsFileInput');
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) handleFile(file);
  });
  tile.addEventListener('dragover', (e) => { e.preventDefault(); tile.classList.add('drag-over'); });
  tile.addEventListener('dragleave', () => tile.classList.remove('drag-over'));
  tile.addEventListener('drop', (e) => {
    e.preventDefault();
    tile.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });
  document.getElementById('btnGenerationsOpen').addEventListener('click', openDraft);
}
