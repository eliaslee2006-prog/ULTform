import { getAll, get, put, remove } from './db.js';
import { addFontFromFile, listFonts, fontFamilyCss } from './fonts.js';

// The list of text NexDash currently lets you restyle. Each entry's id must match a
// data-txt-id attribute somewhere in index.html — an element can appear more than once
// (e.g. inside a hidden panel) and every match gets the same override, since they all
// share one id. This list is deliberately a starting set, not exhaustive — adding a new
// customizable element elsewhere is just tagging it with a new data-txt-id and adding
// one line here.
const CUSTOMIZABLE = [
  { id: 'txt-panel-title-appearance', tag: 'Panel heading' },
  { id: 'txt-panel-title-layers', tag: 'Panel heading' },
  { id: 'txt-panel-title-brushimport', tag: 'Panel heading' },
  { id: 'txt-hud-complete-editor', tag: 'Button label' },
  { id: 'txt-hud-save-canvas', tag: 'Button label' },
  { id: 'txt-nexus-start', tag: 'Button label' },
  { id: 'txt-nexus-stop', tag: 'Button label' },
  { id: 'txt-modal-signhere', tag: 'Dialog title' },
  { id: 'txt-panel-label-theme', tag: 'Section label' },
  { id: 'txt-panel-label-bg', tag: 'Section label' },
  { id: 'txt-panel-label-accent', tag: 'Section label' },
  { id: 'txt-panel-label-layout', tag: 'Section label' },
  { id: 'txt-panel-label-textsize', tag: 'Section label' },
  { id: 'txt-panel-label-multipage', tag: 'Section label' },
  { id: 'txt-panel-label-fonts', tag: 'Section label' },
  { id: 'txt-panel-label-ambient', tag: 'Section label' },
  { id: 'txt-files-empty', tag: 'Empty-state message' },
  { id: 'txt-sync-status', tag: 'Status text' }
];

let activeTxtId = null;
let initialized = false;

export async function applyTextOverrides() {
  const overrides = await getAll('TextOverrides');
  overrides.forEach((rec) => {
    document.querySelectorAll(`[data-txt-id="${rec.id}"]`).forEach((el) => {
      el.style.fontFamily = rec.fontFamily ? fontFamilyCss(rec.fontFamily) : '';
      el.style.fontSize = rec.fontSize ? `${rec.fontSize}px` : '';
      el.style.color = rec.color || '';
    });
  });
}

async function storageNoteText() {
  const overrides = await getAll('TextOverrides');
  const bytes = overrides.reduce((sum, r) => sum + JSON.stringify(r).length, 0);
  if (!overrides.length) return 'No overrides saved yet.';
  return `${overrides.length} override${overrides.length > 1 ? 's' : ''} saved · ${(bytes / 1024).toFixed(1)} KB used`;
}

function populateFontSelect(select) {
  select.querySelectorAll('option:not(:first-child)').forEach((o) => o.remove());
  listFonts().then((fonts) => {
    fonts.forEach((f) => {
      const opt = document.createElement('option');
      opt.value = f.family;
      opt.textContent = f.name;
      select.appendChild(opt);
    });
  });
}

async function openInspector(txtId) {
  activeTxtId = txtId;
  document.querySelectorAll('.design-proxy-row').forEach((row) => row.classList.toggle('active', row.dataset.rowTxtId === txtId));

  const entry = CUSTOMIZABLE.find((c) => c.id === txtId);
  document.getElementById('inspectorTargetLabel').textContent = entry ? entry.tag : txtId;

  const real = document.querySelector(`[data-txt-id="${txtId}"]`);
  const computed = real ? getComputedStyle(real) : null;
  const existing = await get('TextOverrides', txtId);

  const fontSelect = document.getElementById('inspectorFontSelect');
  populateFontSelect(fontSelect);
  fontSelect.value = existing?.fontFamily || '';

  const startSize = existing?.fontSize || Math.round(parseFloat(computed?.fontSize) || 14);
  document.getElementById('inspectorSizeValue').textContent = `${startSize}px`;
  document.getElementById('inspectorSizeValue').dataset.value = startSize;

  document.getElementById('inspectorColor').value = existing?.color || rgbToHex(computed?.color) || '#1b1b23';

  document.getElementById('textInspectorPanel').classList.add('open');
  await refreshStorageNote();
}

function rgbToHex(rgb) {
  if (!rgb) return null;
  const m = rgb.match(/[\d.]+/g);
  if (!m) return null;
  const [r, g, b] = m.map((n) => Math.round(+n));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

async function refreshStorageNote() {
  document.getElementById('inspectorStorageNote').textContent = await storageNoteText();
}

function renderProxyList() {
  const list = document.getElementById('designProxyList');
  list.innerHTML = '';
  CUSTOMIZABLE.forEach(({ id, tag }) => {
    const real = document.querySelector(`[data-txt-id="${id}"]`);
    if (!real) return;
    const row = document.createElement('div');
    row.className = 'design-proxy-row';
    row.dataset.rowTxtId = id;

    const text = document.createElement('span');
    text.className = 'design-proxy-text';
    text.dataset.txtId = id; // shares overrides with the real element via applyTextOverrides()
    text.textContent = real.textContent.trim();
    row.appendChild(text);

    const tagEl = document.createElement('span');
    tagEl.className = 'design-proxy-tag';
    tagEl.textContent = tag;
    row.appendChild(tagEl);

    row.addEventListener('click', () => openInspector(id));
    list.appendChild(row);
  });
}

async function applyClicked() {
  if (!activeTxtId) return;
  const fontFamily = document.getElementById('inspectorFontSelect').value;
  const fontSize = parseInt(document.getElementById('inspectorSizeValue').dataset.value, 10);
  const color = document.getElementById('inspectorColor').value;
  await put('TextOverrides', { id: activeTxtId, fontFamily, fontSize, color });
  await applyTextOverrides();
  await refreshStorageNote();
}

async function resetClicked() {
  if (!activeTxtId) return;
  await remove('TextOverrides', activeTxtId);
  document.querySelectorAll(`[data-txt-id="${activeTxtId}"]`).forEach((el) => {
    el.style.fontFamily = '';
    el.style.fontSize = '';
    el.style.color = '';
  });
  await refreshStorageNote();
}

function stepSize(delta) {
  const el = document.getElementById('inspectorSizeValue');
  const next = Math.min(72, Math.max(8, parseInt(el.dataset.value, 10) + delta));
  el.dataset.value = next;
  el.textContent = `${next}px`;
}

export function closeInspector() {
  document.getElementById('textInspectorPanel').classList.remove('open');
  activeTxtId = null;
}

export async function initDesignMode() {
  if (!initialized) {
    document.getElementById('inspectorSizeMinus').addEventListener('click', () => stepSize(-1));
    document.getElementById('inspectorSizePlus').addEventListener('click', () => stepSize(1));
    document.getElementById('inspectorApply').addEventListener('click', applyClicked);
    document.getElementById('inspectorReset').addEventListener('click', resetClicked);
    document.getElementById('inspectorUploadFont').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const record = await addFontFromFile(file);
      const select = document.getElementById('inspectorFontSelect');
      const opt = document.createElement('option');
      opt.value = record.family;
      opt.textContent = record.name;
      select.appendChild(opt);
      select.value = record.family;
    });
    initialized = true;
  }
  renderProxyList();
  await applyTextOverrides();
}
