import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/+esm';
import { PDFDocument } from 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';
import { getAll, put, get, remove, requestPersistentStorage } from './db.js';
import { addField, addSignatureField, serializeFields } from './overlay-engine.js';
import { initSignaturePad, resizeCanvasForDPR, clearSignature, exportSignaturePNG, isSignatureEmpty } from './signature-engine.js';
import { flattenDocument } from './pdf-flatten.js';
import { initSyncEngine, enqueue, setStatusListener } from './sync-engine.js';
import { shareCompletedPDF } from './share.js';
import { restoreFonts, addFontFromFile, listFonts, fontFamilyCss } from './fonts.js';
import { initFilesTab, refreshFilesList, addFileRecord } from './files.js';
import { initNexusTab, refreshNexusView } from './nexus.js';
import { wireRipples } from './ripple.js';
import { initDesignMode, closeInspector, applyTextOverrides } from './designmode.js';
import { initGenerationsTab, setOpenDocumentHandler } from './generations.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';

const SETTINGS_KEY = 'appearance';
const DEFAULT_SETTINGS = {
  theme: 'light',
  bgIndex: -1,
  bgCustomDataUrl: null,
  accent: '#3E63DD',
  btnSize: 46,
  radius: 15,
  textScaleHeading: 100,
  textScaleSubheading: 100,
  textScaleBody: 100,
  pageMode: 'paginated',
  waveOn: false, waveIntensity: 50, waveColor: '#3E63DD',
  glowOn: false, glowIntensity: 50, glowColor: '#3E63DD',
  strobeOn: false, strobeIntensity: 20, strobeColor: '#3E63DD',
  fontFamily: '', fontKerning: 0, fontBold: false, fontItalic: false
};

let currentTemplate = null;
let currentTemplateBytes = null;
let pageBlocks = []; // [{ canvas, overlay, width, height }]
let currentPageIndex = 0;
let pageMode = 'paginated';

// ---- Rail navigation ----
const screenIds = { editor: 'screen-editor', files: 'screen-files', nexus: 'screen-nexus', canvas: 'screen-canvas', designmode: 'screen-designmode', generations: 'screen-generations' };
function setupRail() {
  document.querySelectorAll('.rail-item').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.rail-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.getElementById('customizePanel').classList.toggle('open', tab === 'customize');
      if (tab !== 'designmode') closeInspector();
      Object.values(screenIds).forEach((id) => document.getElementById(id).classList.add('hidden'));
      if (tab !== 'customize') {
        document.getElementById(screenIds[tab]).classList.remove('hidden');
      }
      if (tab === 'files') refreshFilesList();
      if (tab === 'nexus') refreshNexusView();
      if (tab === 'designmode') initDesignMode();
      // Canvas pulls in Konva + perfect-freehand (~450KB) — load on first visit only,
      // so every other tab isn't paying for a dependency it never uses.
      if (tab === 'canvas') {
        const { initCanvasTab } = await import('./canvas.js');
        initCanvasTab();
      }
    });
  });
}

// ---- Settings persistence ----
function collectSettings() {
  return {
    theme: document.body.dataset.theme || 'light',
    bgIndex: parseInt(document.getElementById('galleryRow').dataset.selectedIndex || '-1', 10),
    bgCustomDataUrl: document.getElementById('galleryRow').dataset.customDataUrl || null,
    accent: document.getElementById('accentColor').value,
    btnSize: document.getElementById('btnSize').value,
    radius: document.getElementById('radius').value,
    textScaleHeading: document.getElementById('textSizeHeading').value,
    textScaleSubheading: document.getElementById('textSizeSubheading').value,
    textScaleBody: document.getElementById('textSizeBody').value,
    pageMode,
    waveOn: document.getElementById('toggleWave').checked, waveIntensity: document.getElementById('waveIntensity').value, waveColor: document.getElementById('waveColor').value,
    glowOn: document.getElementById('toggleGlow').checked, glowIntensity: document.getElementById('glowIntensity').value, glowColor: document.getElementById('glowColor').value,
    strobeOn: document.getElementById('toggleStrobe').checked, strobeIntensity: document.getElementById('strobeIntensity').value, strobeColor: document.getElementById('strobeColor').value,
    fontFamily: document.getElementById('fontSelect').value,
    fontKerning: document.getElementById('fontKerning').value,
    fontBold: document.getElementById('fontBold').checked,
    fontItalic: document.getElementById('fontItalic').checked
  };
}

let persistTimer = null;
function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => put('Settings', { key: SETTINGS_KEY, value: collectSettings() }), 250);
}

function applySettings(s) {
  document.body.setAttribute('data-theme', s.theme);
  document.querySelectorAll('.theme-swatch[data-theme]').forEach((sw) => sw.classList.toggle('selected', sw.dataset.theme === s.theme));

  const galleryRow = document.getElementById('galleryRow');
  const thumbs = [...galleryRow.querySelectorAll('.gallery-thumb')];
  thumbs.forEach((t, i) => t.classList.toggle('selected', i === s.bgIndex));
  if (s.bgCustomDataUrl) {
    document.getElementById('bgPhoto').style.backgroundImage = `url(${s.bgCustomDataUrl})`;
    galleryRow.dataset.customDataUrl = s.bgCustomDataUrl;
  } else if (s.bgIndex >= 0 && thumbs[s.bgIndex]) {
    const t = thumbs[s.bgIndex];
    document.getElementById('bgPhoto').style.background = t.dataset.clear ? 'none' : t.dataset.bg;
  }

  document.documentElement.style.setProperty('--accent', s.accent);
  document.getElementById('accentColor').value = s.accent;

  document.getElementById('btnSize').value = s.btnSize;
  document.querySelectorAll('.hud-btn').forEach((b) => { b.style.width = b.style.height = s.btnSize + 'px'; });
  document.getElementById('radius').value = s.radius;
  document.querySelectorAll('.hud-btn, .hud-complete').forEach((b) => { b.style.borderRadius = (s.radius - 4) + 'px'; });
  document.getElementById('hud').style.borderRadius = (parseInt(s.radius) + 7) + 'px';

  document.getElementById('textSizeHeading').value = s.textScaleHeading;
  document.getElementById('textSizeSubheading').value = s.textScaleSubheading;
  document.getElementById('textSizeBody').value = s.textScaleBody;
  document.documentElement.style.setProperty('--text-scale-heading', s.textScaleHeading / 100);
  document.documentElement.style.setProperty('--text-scale-subheading', s.textScaleSubheading / 100);
  document.documentElement.style.setProperty('--text-scale-body', s.textScaleBody / 100);

  setPageMode(s.pageMode, { silent: true });

  document.getElementById('toggleWave').checked = s.waveOn;
  document.getElementById('waveIntensity').value = s.waveIntensity;
  document.getElementById('waveColor').value = s.waveColor;
  document.documentElement.style.setProperty('--wave-color', s.waveColor);
  document.documentElement.style.setProperty('--wave-opacity', s.waveOn ? (s.waveIntensity / 100) * 0.45 : 0);
  document.getElementById('toggleGlow').checked = s.glowOn;
  document.getElementById('glowIntensity').value = s.glowIntensity;
  document.getElementById('glowColor').value = s.glowColor;
  document.documentElement.style.setProperty('--glow-color', s.glowColor);
  document.documentElement.style.setProperty('--glow-strength', s.glowOn ? (s.glowIntensity / 100) * 1 : 0);
  document.getElementById('toggleStrobe').checked = s.strobeOn;
  document.getElementById('strobeIntensity').value = s.strobeIntensity;
  document.getElementById('strobeColor').value = s.strobeColor;
  document.documentElement.style.setProperty('--strobe-color', s.strobeColor);
  document.documentElement.style.setProperty('--strobe-opacity', s.strobeOn ? (s.strobeIntensity / 100) * 0.06 : 0);

  document.getElementById('fontKerning').value = s.fontKerning;
  document.documentElement.style.setProperty('--font-kerning', s.fontKerning + 'px');
  document.getElementById('fontBold').checked = s.fontBold;
  document.documentElement.style.setProperty('--font-weight', s.fontBold ? '700' : '600');
  document.getElementById('fontItalic').checked = s.fontItalic;
  document.documentElement.style.setProperty('--font-style', s.fontItalic ? 'italic' : 'normal');
  if (s.fontFamily) {
    document.documentElement.style.setProperty('--font-family', fontFamilyCss(s.fontFamily));
    document.getElementById('fontSelect').value = s.fontFamily;
  }
}

async function loadAndApplySettings() {
  const rec = await get('Settings', SETTINGS_KEY);
  const settings = { ...DEFAULT_SETTINGS, ...(rec ? rec.value : {}) };
  applySettings(settings);
}

// ---- Customize panel ----
function setupCustomizePanel() {
  document.querySelectorAll('.theme-swatch[data-theme]').forEach((sw) => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.theme-swatch[data-theme]').forEach((s) => s.classList.remove('selected'));
      sw.classList.add('selected');
      document.body.setAttribute('data-theme', sw.dataset.theme);
      schedulePersist();
    });
  });

  const galleryRow = document.getElementById('galleryRow');
  const thumbs = [...galleryRow.querySelectorAll('.gallery-thumb')];
  thumbs.forEach((t, i) => {
    t.addEventListener('click', () => {
      thumbs.forEach((x) => x.classList.remove('selected'));
      t.classList.add('selected');
      galleryRow.dataset.selectedIndex = i;
      delete galleryRow.dataset.customDataUrl;
      document.getElementById('bgPhoto').style.backgroundImage = '';
      document.getElementById('bgPhoto').style.background = t.dataset.clear ? 'none' : t.dataset.bg;
      schedulePersist();
    });
  });
  document.getElementById('uploadBg').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      document.getElementById('bgPhoto').style.background = 'none';
      document.getElementById('bgPhoto').style.backgroundImage = `url(${reader.result})`;
      galleryRow.dataset.customDataUrl = reader.result;
      thumbs.forEach((x) => x.classList.remove('selected'));
      galleryRow.dataset.selectedIndex = -1;
      schedulePersist();
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('accentColor').addEventListener('input', (e) => {
    document.documentElement.style.setProperty('--accent', e.target.value);
    schedulePersist();
  });

  document.getElementById('btnSize').addEventListener('input', (e) => {
    document.querySelectorAll('.hud-btn').forEach((b) => { b.style.width = b.style.height = e.target.value + 'px'; });
    schedulePersist();
  });
  document.getElementById('radius').addEventListener('input', (e) => {
    document.querySelectorAll('.hud-btn, .hud-complete').forEach((b) => { b.style.borderRadius = (e.target.value - 4) + 'px'; });
    document.getElementById('hud').style.borderRadius = (parseInt(e.target.value) + 7) + 'px';
    schedulePersist();
  });

  function wireTextScale(id, varName) {
    document.getElementById(id).addEventListener('input', (e) => {
      document.documentElement.style.setProperty(varName, e.target.value / 100);
      schedulePersist();
    });
  }
  wireTextScale('textSizeHeading', '--text-scale-heading');
  wireTextScale('textSizeSubheading', '--text-scale-subheading');
  wireTextScale('textSizeBody', '--text-scale-body');

  document.querySelectorAll('.theme-swatch[data-page-mode]').forEach((sw) => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.theme-swatch[data-page-mode]').forEach((s) => s.classList.remove('selected'));
      sw.classList.add('selected');
      setPageMode(sw.dataset.pageMode);
      schedulePersist();
    });
  });

  function wireEffect(toggleId, sliderId, colorId, varName, colorVarName, max) {
    const toggle = document.getElementById(toggleId);
    const slider = document.getElementById(sliderId);
    const color = document.getElementById(colorId);
    const update = () => {
      const v = toggle.checked ? (slider.value / 100) * max : 0;
      document.documentElement.style.setProperty(varName, v);
      document.documentElement.style.setProperty(colorVarName, color.value);
      schedulePersist();
    };
    toggle.addEventListener('change', update);
    slider.addEventListener('input', update);
    color.addEventListener('input', update);
  }
  // Wave's ceiling is capped well below the old 0.8 — a moving pattern doesn't get the
  // same "no rapid flashing" exemption the strobe's own low cap relies on, so it needs
  // to stay subtle regardless of how high the intensity slider is pushed.
  wireEffect('toggleWave', 'waveIntensity', 'waveColor', '--wave-opacity', '--wave-color', 0.45);
  wireEffect('toggleGlow', 'glowIntensity', 'glowColor', '--glow-strength', '--glow-color', 1);
  wireEffect('toggleStrobe', 'strobeIntensity', 'strobeColor', '--strobe-opacity', '--strobe-color', 0.06);

  document.getElementById('fontKerning').addEventListener('input', (e) => {
    document.documentElement.style.setProperty('--font-kerning', e.target.value + 'px');
    schedulePersist();
  });
  document.getElementById('fontBold').addEventListener('change', (e) => {
    document.documentElement.style.setProperty('--font-weight', e.target.checked ? '700' : '600');
    schedulePersist();
  });
  document.getElementById('fontItalic').addEventListener('change', (e) => {
    document.documentElement.style.setProperty('--font-style', e.target.checked ? 'italic' : 'normal');
    schedulePersist();
  });
  document.getElementById('fontSelect').addEventListener('change', (e) => {
    document.documentElement.style.setProperty('--font-family', fontFamilyCss(e.target.value));
    schedulePersist();
  });
  document.getElementById('uploadFont').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const record = await addFontFromFile(file);
    addFontOption(record);
    document.getElementById('fontSelect').value = record.family;
    document.documentElement.style.setProperty('--font-family', fontFamilyCss(record.family));
    schedulePersist();
  });
}

function addFontOption(record) {
  const select = document.getElementById('fontSelect');
  const opt = document.createElement('option');
  opt.value = record.family;
  opt.textContent = record.name;
  select.appendChild(opt);
}

async function populateFontOptions() {
  const fonts = await listFonts();
  fonts.forEach(addFontOption);
}

// ---- Multi-page templates ----
function setPageMode(mode, { silent = false } = {}) {
  pageMode = mode;
  const wrapper = document.getElementById('pdfStageWrapper');
  wrapper.classList.toggle('mode-paginated', mode === 'paginated');
  wrapper.classList.toggle('mode-continuous', mode === 'continuous');
  document.getElementById('pageNav').classList.toggle('hidden', mode !== 'paginated' || pageBlocks.length <= 1);
  if (!silent) {
    document.querySelectorAll('.theme-swatch[data-page-mode]').forEach((sw) => sw.classList.toggle('selected', sw.dataset.pageMode === mode));
  }
  renderPageVisibility();
}

function renderPageVisibility() {
  pageBlocks.forEach((pb, i) => pb.el.classList.toggle('current', i === currentPageIndex));
  document.getElementById('pageIndicator').textContent = `${currentPageIndex + 1} / ${pageBlocks.length}`;
  document.getElementById('btnPrevPage').disabled = currentPageIndex === 0;
  document.getElementById('btnNextPage').disabled = currentPageIndex === pageBlocks.length - 1;
}

function goToPage(index) {
  if (index < 0 || index >= pageBlocks.length) return;
  currentPageIndex = index;
  if (pageMode === 'paginated') renderPageVisibility();
  else {
    pageBlocks[index].el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function getCurrentOverlayContainer() {
  return pageBlocks[currentPageIndex] ? pageBlocks[currentPageIndex].overlay : null;
}

let wheelLock = false;
function setupPageGestures() {
  const wrapper = document.getElementById('pdfStageWrapper');

  wrapper.addEventListener('wheel', (e) => {
    if (pageMode !== 'paginated') return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(delta) < 12 || wheelLock) return;
    wheelLock = true;
    goToPage(currentPageIndex + (delta > 0 ? 1 : -1));
    setTimeout(() => { wheelLock = false; }, 450);
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (pageMode !== 'paginated') return;
    if (document.getElementById('editorView').classList.contains('hidden')) return;
    if (document.activeElement && document.activeElement.isContentEditable) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goToPage(currentPageIndex + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goToPage(currentPageIndex - 1);
  });

  let touchStartX = null, touchStartY = null;
  wrapper.addEventListener('pointerdown', (e) => {
    if (pageMode !== 'paginated') return;
    if (e.target.closest('.field')) return;
    touchStartX = e.clientX; touchStartY = e.clientY;
  });
  wrapper.addEventListener('pointerup', (e) => {
    if (touchStartX === null) return;
    const dx = e.clientX - touchStartX, dy = e.clientY - touchStartY;
    touchStartX = null; touchStartY = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      goToPage(currentPageIndex + (dx < 0 ? 1 : -1));
    }
  });

  document.getElementById('btnPrevPage').addEventListener('click', () => goToPage(currentPageIndex - 1));
  document.getElementById('btnNextPage').addEventListener('click', () => goToPage(currentPageIndex + 1));
}

// ---- Templates + editor ----
async function loadTemplates() {
  // The bundled Factsheet sample was retired from manifest.json — clean up any copy
  // a returning visitor already has cached in IndexedDB from before, so it doesn't
  // keep showing up in the grid alongside real imports.
  await remove('Templates', 'FactsheetIncorporation');
  const resp = await fetch('templates/manifest.json');
  const templates = await resp.json();
  await Promise.all(templates.map(async (t) => {
    const fileResp = await fetch(t.pdfUrl);
    const bytes = await fileResp.arrayBuffer();
    await put('Templates', { ...t, pdfBytes: bytes, cachedAt: Date.now() });
  }));
  const grid = document.getElementById('templateGrid');
  grid.innerHTML = '';
  templates.forEach((t) => {
    const card = document.createElement('button');
    card.className = 'template-card';
    card.textContent = t.name;
    card.addEventListener('click', () => openTemplate(t.id));
    grid.appendChild(card);
  });
  wireRipples(grid);
  const importHost = document.getElementById('importTileHost');
  importHost.innerHTML = '';
  addImportTile(importHost);
}

function addImportTile(host) {
  const tile = document.createElement('label');
  tile.className = 'import-tile-doc';
  tile.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4h16v11l-3 5H7l-3-5V4z"/><path d="M4 15h4l2 3h4l2-3h4"/></svg>' +
    '<span class="import-label">Import a file</span>' +
    '<span class="import-hint">Click, drop, or paste — PDF, photo, or any file from your device</span>';
  const input = document.createElement('input');
  input.type = 'file';
  input.setAttribute('data-role', 'import-any-file');
  input.style.display = 'none';
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) handleImportedFile(file);
  });
  tile.appendChild(input);
  tile.addEventListener('dragover', (e) => { e.preventDefault(); tile.classList.add('drag-over'); });
  tile.addEventListener('dragleave', () => tile.classList.remove('drag-over'));
  tile.addEventListener('drop', (e) => {
    e.preventDefault();
    tile.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleImportedFile(file);
  });
  host.appendChild(tile);
}

// Any file type, from any source (click-to-pick, paste, or drag-drop) lands here.
// PDFs and images become stampable in the Editor; anything else (Word docs, etc.)
// isn't something the Editor's overlay tools can work with, so it's stored directly
// in My Files instead — same destination as that tab's own Import button.
async function handleImportedFile(file) {
  if (!file) return;
  try {
    if (file.type === 'application/pdf') {
      const bytes = await file.arrayBuffer();
      await openTemplateBytes({ id: `import-${crypto.randomUUID()}`, name: file.name.replace(/\.pdf$/i, ''), pdfBytes: bytes });
    } else if (file.type.startsWith('image/')) {
      const pdfBytes = await imageFileToPdfBytes(file);
      await openTemplateBytes({ id: `import-${crypto.randomUUID()}`, name: file.name.replace(/\.[^.]+$/, ''), pdfBytes });
    } else {
      await addFileRecord({ id: crypto.randomUUID(), fileName: file.name, pdfBlob: file, source: 'imported' });
      showToast(`Imported "${file.name}" to My Files`);
    }
  } catch (err) {
    console.error('Import failed', err);
    alert(`Couldn't import "${file.name}": ${err.message}`);
  }
}

// Draws the image to a canvas (works for any format the browser can decode — jpeg,
// png, webp, gif, heic on Safari, etc.) so pdf-lib, which only embeds PNG/JPEG
// directly, gets a format it always understands, then wraps it as a single full page
// sized to the image's own pixel dimensions.
async function imageFileToPdfBytes(file) {
  const url = URL.createObjectURL(file);
  let width, height, pngBytes;
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    width = img.naturalWidth;
    height = img.naturalHeight;
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    pngBytes = await blob.arrayBuffer();
  } finally {
    URL.revokeObjectURL(url);
  }
  const doc = await PDFDocument.create();
  const png = await doc.embedPng(pngBytes);
  const page = doc.addPage([width, height]);
  page.drawImage(png, { x: 0, y: 0, width, height });
  return doc.save();
}

function setupImportPaste() {
  document.addEventListener('paste', (e) => {
    if (document.getElementById('templatePicker').classList.contains('hidden')) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) { handleImportedFile(file); break; }
      }
    }
  });
}

async function openTemplate(templateId) {
  const templates = await getAll('Templates');
  const t = templates.find((x) => x.id === templateId);
  if (!t) return;
  await openTemplateBytes(t);
}

// Shared by manifest-driven templates and ad-hoc imports (a PDF picked from the
// blank-import tile, or an image auto-converted to a single-page PDF) — anything with
// {id, name, pdfBytes} can be opened in the Editor the same way.
async function openTemplateBytes(t) {
  currentTemplate = t;
  currentTemplateBytes = t.pdfBytes;
  currentPageIndex = 0;

  document.getElementById('templatePicker').classList.add('hidden');
  document.getElementById('editorView').classList.remove('hidden');

  const track = document.getElementById('pagesTrack');
  track.innerHTML = '';
  pageBlocks = [];

  const loadingTask = pdfjsLib.getDocument({ data: currentTemplateBytes.slice(0) });
  const pdf = await loadingTask.promise;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const block = document.createElement('div');
    block.className = 'page-block';
    block.dataset.pageIndex = i - 1;

    const canvas = document.createElement('canvas');
    const overlay = document.createElement('div');
    overlay.className = 'overlay-container';
    block.appendChild(canvas);
    block.appendChild(overlay);
    track.appendChild(block);

    const baseWidth = page.getViewport({ scale: 1 }).width;
    const scale = Math.min(1200, 1600) / baseWidth * 0.6 || 1.4;
    const viewport = page.getViewport({ scale: Math.max(scale, 1) });
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = viewport.width * ratio;
    canvas.height = viewport.height * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    await page.render({ canvasContext: ctx, viewport }).promise;

    pageBlocks.push({ el: block, canvas, overlay, width: viewport.width, height: viewport.height });
  }

  setPageMode(pageMode, { silent: true });
}

// Used by the Generations tab once it's drafted a document: switches to the Editor
// tab (Generations has its own screen; the result opens where every other document
// does) and pre-places the field overlays Gemini suggested, the same way a person
// would place them by hand with the HUD's field-type buttons.
export async function openGeneratedDocument(t, fields = []) {
  document.querySelectorAll('.rail-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === 'editor'));
  document.getElementById('customizePanel').classList.remove('open');
  closeInspector();
  Object.values(screenIds).forEach((id) => document.getElementById(id).classList.add('hidden'));
  document.getElementById(screenIds.editor).classList.remove('hidden');
  await openTemplateBytes(t);
  fields.forEach((f) => {
    const pb = pageBlocks[f.pageIndex];
    if (pb) addField(pb.overlay, f.type, f.xPct, f.yPct, f.pageIndex);
  });
}

function setupHud() {
  document.querySelectorAll('.hud-btn[data-field-type]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const overlay = getCurrentOverlayContainer();
      if (overlay) addField(overlay, btn.dataset.fieldType, 0.4, 0.4, currentPageIndex);
    });
  });
  document.getElementById('btnAddSignature').addEventListener('click', openSignatureModal);
  document.getElementById('btnBackToTemplates').addEventListener('click', () => {
    document.getElementById('editorView').classList.add('hidden');
    document.getElementById('templatePicker').classList.remove('hidden');
    currentTemplate = null;
  });
  document.getElementById('btnFlattenSubmit').addEventListener('click', submitDocument);
}

function openSignatureModal() {
  const modal = document.getElementById('signatureModal');
  modal.classList.remove('hidden');
  initSignaturePad(document.getElementById('signatureCanvas'));
}
function setupSignatureModal() {
  document.getElementById('btnClearSignature').addEventListener('click', clearSignature);
  document.getElementById('btnDoneSignature').addEventListener('click', () => {
    if (isSignatureEmpty()) { alert('Please sign before continuing'); return; }
    const pngDataUrl = exportSignaturePNG();
    const overlay = getCurrentOverlayContainer();
    if (overlay) addSignatureField(overlay, pngDataUrl, 0.3, 0.7, 0.3, 0.08, currentPageIndex);
    document.getElementById('signatureModal').classList.add('hidden');
  });
}

async function submitDocument() {
  if (!currentTemplate) return;
  const track = document.getElementById('pagesTrack');
  const fields = serializeFields(track);
  const flattenedBytes = await flattenDocument(currentTemplateBytes.slice(0), fields);
  const pdfBlob = new Blob([flattenedBytes], { type: 'application/pdf' });

  const idempotencyKey = crypto.randomUUID();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15) + 'Z';
  const fileName = `${currentTemplate.name.replace(/\s+/g, '')}_${timestamp}.pdf`;

  await addFileRecord({ id: idempotencyKey, fileName, pdfBlob, templateId: currentTemplate.id });
  await enqueue({ idempotencyKey, templateId: currentTemplate.id, fileName, pdfBlob });

  document.getElementById('editorView').classList.add('hidden');
  document.getElementById('templatePicker').classList.remove('hidden');
  currentTemplate = null;

  showToast('Uploaded to SharePoint — saved to My files', { fileName, pdfBlob });
}

function showToast(text, shareCtx = null) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = text;
  const shareBtn = document.getElementById('toastShareBtn');
  if (shareCtx) {
    shareBtn.classList.remove('hidden');
    shareBtn.onclick = () => shareCompletedPDF(shareCtx.pdfBlob, shareCtx.fileName);
  } else {
    shareBtn.classList.add('hidden');
  }
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 4200);
}

function setupSyncStatusUI() {
  const statusEl = document.getElementById('syncStatus');
  const textEl = document.getElementById('syncStatusText');
  const labels = { idle: 'Up to date', queued: 'Waiting to sync', syncing: 'Syncing…', failed: 'Sync failed' };
  setStatusListener((state) => {
    statusEl.dataset.state = state;
    textEl.textContent = labels[state] || state;
  });
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('service-worker.js'); }
    catch (err) { console.error('Service worker registration failed', err); }
  }
}

async function bootstrap() {
  await requestPersistentStorage();
  await registerServiceWorker();
  await restoreFonts();
  await populateFontOptions();
  setupRail();
  setupCustomizePanel();
  setupHud();
  setupSignatureModal();
  setupSyncStatusUI();
  setupPageGestures();
  setupImportPaste();
  wireRipples();
  initSyncEngine();
  initFilesTab();
  initNexusTab();
  setOpenDocumentHandler(openGeneratedDocument);
  initGenerationsTab();
  await loadAndApplySettings();
  await applyTextOverrides();
  await loadTemplates();
}

bootstrap();
