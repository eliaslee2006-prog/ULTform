import Konva from 'https://cdn.jsdelivr.net/npm/konva@9.3.16/+esm';
import getStroke from 'https://cdn.jsdelivr.net/npm/perfect-freehand@1.2.2/+esm';
import { PDFDocument } from 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';
import { getAll, put, get, remove } from './db.js';
import { addFileRecord } from './files.js';
import { enqueue } from './sync-engine.js';
import { wireRipples } from './ripple.js';

const STAGE_WIDTH = 2400;
const STAGE_HEIGHT = 1600;
const DRAFT_KEY = 'draft';

const BUILTIN_PRESETS = [
  { id: 'builtin-fine', name: 'Fine Liner', size: 4, opacity: 1, thinning: 0.5, smoothing: 0.5, streamline: 0.5 },
  { id: 'builtin-soft', name: 'Soft Brush', size: 22, opacity: 0.55, thinning: 0.7, smoothing: 0.6, streamline: 0.4 },
  { id: 'builtin-marker', name: 'Marker', size: 14, opacity: 0.85, thinning: 0.1, smoothing: 0.3, streamline: 0.6 },
  { id: 'builtin-pencil', name: 'Pencil', size: 3, opacity: 0.9, thinning: 0.8, smoothing: 0.4, streamline: 0.5 }
];

let initialized = false;
let stage = null;
let layers = []; // [{ id, name, konvaLayer, visible, opacity, blendMode }]
let activeLayerIndex = 0;
let activeTool = 'brush';
const brush = { size: 8, opacity: 1, color: '#1B1D23', thinning: 0.6, smoothing: 0.5, streamline: 0.5, textured: false };

let drawing = false;
let strokePoints = [];
let currentShape = null;
let smudgeColor = null;

let undoStack = [];
let redoStack = [];

let transformer = null;
let selectedNode = null;

let pinchLastCenter = null;
let pinchLastDist = 0;

function activeLayer() {
  return layers[activeLayerIndex];
}

function outlinePoints(points, size) {
  // Brush size means "N screen pixels" regardless of current zoom, so strokes stay
  // equally visible/hit-testable at any scale instead of shrinking to sub-pixel
  // width when the stage is fit-to-container at a fraction of STAGE_WIDTH.
  const effectiveSize = size / (stage.scaleX() || 1);
  const stroke = getStroke(points, {
    size: effectiveSize,
    thinning: brush.thinning,
    smoothing: brush.smoothing,
    streamline: brush.streamline,
    simulatePressure: points.every((p) => p[2] === undefined || p[2] === 0.5)
  });
  return stroke.flatMap((p) => [p[0], p[1]]);
}

function scheduleDraftSave() {
  clearTimeout(scheduleDraftSave._t);
  scheduleDraftSave._t = setTimeout(async () => {
    if (!stage) return;
    await put('CanvasDraft', { key: DRAFT_KEY, json: stage.toJSON(), layerMeta: layers.map((l) => ({ id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, blendMode: l.blendMode })), savedAt: Date.now() });
  }, 800);
}

function pushUndo(action) {
  undoStack.push(action);
  redoStack = [];
}

// Thumbnails only need to stay live while the panel showing them is actually open —
// re-rendering the whole layer list (and re-rasterizing every thumbnail) on every
// single stroke would be wasted work while the panel is closed.
function refreshThumbsIfPanelOpen() {
  if (!document.getElementById('canvasLayersPanel').classList.contains('hidden')) renderLayerList();
}

function applyAction(action, direction) {
  const layer = layers[action.layerIndex]?.konvaLayer;
  if (action.type === 'add') {
    if (direction === 'undo') action.node.remove();
    else layer.add(action.node);
  } else if (action.type === 'remove') {
    if (direction === 'undo') layer.add(action.node);
    else action.node.remove();
  } else if (action.type === 'move') {
    action.node.position(direction === 'undo' ? action.from : action.to);
  }
  layer?.batchDraw();
  stage.batchDraw();
}

function undo() {
  const action = undoStack.pop();
  if (!action) return;
  applyAction(action, 'undo');
  redoStack.push(action);
  scheduleDraftSave();
  refreshThumbsIfPanelOpen();
}

function redo() {
  const action = redoStack.pop();
  if (!action) return;
  applyAction(action, 'redo');
  undoStack.push(action);
  scheduleDraftSave();
  refreshThumbsIfPanelOpen();
}

// ---- Layers ----
function makeLayerMeta(id, name, blendMode = 'source-over') {
  const konvaLayer = new Konva.Layer();
  stage.add(konvaLayer);
  transformer && konvaLayer.add(transformer); // keep transformer above shapes if it exists
  return { id, name, konvaLayer, visible: true, opacity: 1, blendMode };
}

function addLayer(name) {
  const meta = makeLayerMeta(crypto.randomUUID(), name || `Layer ${layers.length + 1}`);
  layers.push(meta);
  activeLayerIndex = layers.length - 1;
  ensureTransformerOnTop();
  renderLayerList();
  scheduleDraftSave();
  showToast(`"${meta.name}" added`);
}

// A pre-filled opaque layer sent straight to the bottom of the stack — distinct from
// a plain "+ Layer", which is intentionally transparent so it doesn't hide anything
// underneath it.
function addBackgroundLayer(color) {
  const bgCount = layers.filter((l) => l.name.startsWith('Background')).length;
  const meta = makeLayerMeta(crypto.randomUUID(), `Background ${bgCount + 1}`);
  meta.konvaLayer.add(new Konva.Rect({ x: 0, y: 0, width: STAGE_WIDTH, height: STAGE_HEIGHT, fill: color, listening: false }));
  meta.konvaLayer.moveToBottom();
  layers.unshift(meta);
  activeLayerIndex = 0;
  ensureTransformerOnTop();
  renderLayerList();
  scheduleDraftSave();
  showToast(`"${meta.name}" added`);
}

function showToast(text) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = text;
  document.getElementById('toastShareBtn').classList.add('hidden');
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 2200);
}

function deleteLayer(index) {
  if (layers.length <= 1) return;
  layers[index].konvaLayer.destroy();
  layers.splice(index, 1);
  activeLayerIndex = Math.min(activeLayerIndex, layers.length - 1);
  renderLayerList();
  stage.batchDraw();
  scheduleDraftSave();
}

function moveLayer(index, dir) {
  const meta = layers[index];
  if (dir < 0) meta.konvaLayer.moveUp();
  else meta.konvaLayer.moveDown();
  const newIndex = index + (dir < 0 ? 1 : -1);
  if (newIndex < 0 || newIndex >= layers.length) return;
  layers.splice(index, 1);
  layers.splice(newIndex, 0, meta);
  if (activeLayerIndex === index) activeLayerIndex = newIndex;
  ensureTransformerOnTop();
  renderLayerList();
  scheduleDraftSave();
}

function ensureTransformerOnTop() {
  if (transformer) transformer.moveToTop();
}

function setLayerBlendMode(index, mode) {
  const meta = layers[index];
  meta.blendMode = mode;
  meta.konvaLayer.getChildren().forEach((c) => c.globalCompositeOperation(mode));
  meta.konvaLayer.batchDraw();
  scheduleDraftSave();
}

// Low-res live preview of a layer's actual content — without this every row looked
// identical apart from its name/icons, so a newly added layer (a genuinely separate
// Konva raster) looked like nothing had happened.
function layerThumbDataUrl(meta) {
  try {
    return meta.konvaLayer.toDataURL({ x: 0, y: 0, width: STAGE_WIDTH, height: STAGE_HEIGHT, pixelRatio: 68 / STAGE_WIDTH });
  } catch {
    return null;
  }
}

function renderLayerList() {
  const list = document.getElementById('canvasLayerList');
  list.innerHTML = '';
  // Render top layer first (matches visual stacking order).
  [...layers].reverse().forEach((meta) => {
    const index = layers.indexOf(meta);
    const row = document.createElement('div');
    row.className = 'canvas-layer-row' + (index === activeLayerIndex ? ' active' : '');

    const thumb = document.createElement('div');
    thumb.className = 'layer-thumb';
    const thumbUrl = layerThumbDataUrl(meta);
    if (thumbUrl) {
      const img = document.createElement('img');
      img.src = thumbUrl;
      img.alt = '';
      thumb.appendChild(img);
    }
    row.appendChild(thumb);

    const main = document.createElement('div');
    main.className = 'layer-main';
    const topLine = document.createElement('div');
    topLine.className = 'layer-top-line';
    const bottomLine = document.createElement('div');
    bottomLine.className = 'layer-bottom-line';
    main.appendChild(topLine);
    main.appendChild(bottomLine);
    row.appendChild(main);

    const name = document.createElement('div');
    name.className = 'layer-name';
    name.textContent = meta.name;
    topLine.appendChild(name);

    const visBtn = document.createElement('button');
    visBtn.innerHTML = meta.visible
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8"/><path d="M9.5 5.2A9.8 9.8 0 0112 5c6 0 10 7 10 7a15.6 15.6 0 01-3.2 3.8M6.4 6.4C4 8 2 12 2 12s1.5 2.7 4 4.6"/></svg>';
    visBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      meta.visible = !meta.visible;
      meta.konvaLayer.visible(meta.visible);
      stage.batchDraw();
      renderLayerList();
      scheduleDraftSave();
    });
    topLine.appendChild(visBtn);

    const opacity = document.createElement('input');
    opacity.type = 'range';
    opacity.className = 'layer-opacity';
    opacity.min = '0'; opacity.max = '100'; opacity.value = String(meta.opacity * 100);
    opacity.addEventListener('input', () => {
      meta.opacity = opacity.value / 100;
      meta.konvaLayer.opacity(meta.opacity);
      stage.batchDraw();
      scheduleDraftSave();
    });
    bottomLine.appendChild(opacity);

    const upBtn = document.createElement('button');
    upBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
    upBtn.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(index, -1); });
    bottomLine.appendChild(upBtn);

    const downBtn = document.createElement('button');
    downBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>';
    downBtn.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(index, 1); });
    bottomLine.appendChild(downBtn);

    if (layers.length > 1) {
      const delBtn = document.createElement('button');
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';
      delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteLayer(index); });
      bottomLine.appendChild(delBtn);
    }

    row.addEventListener('click', () => {
      activeLayerIndex = index;
      document.getElementById('canvasBlendMode').value = meta.blendMode;
      renderLayerList();
    });
    list.appendChild(row);
  });
  wireRipples(list);
}

// ---- Brush presets ----
async function loadPresets() {
  const stored = await getAll('BrushPresets');
  return [...BUILTIN_PRESETS, ...stored];
}

function applyPreset(preset) {
  brush.size = preset.size;
  brush.opacity = preset.opacity;
  brush.thinning = preset.thinning;
  brush.smoothing = preset.smoothing;
  brush.streamline = preset.streamline;
  // .abr/.brushset imports recover a name (and for .abr, a rough size) but never the
  // original bitmap tip/grain — real texture data isn't in a documented, parseable
  // spot in either format. Rather than paint these identically to a flat built-in
  // brush, give them a genuine (procedural, not recovered) grain fill so an imported
  // brush actually looks and paints differently on the canvas, not just in name.
  brush.textured = !!(preset.sourceFormat && preset.sourceFormat !== 'json');
  document.getElementById('canvasBrushSize').value = preset.size;
}

// A small, deterministic grain pattern per color (same color always renders the same
// grain, so re-selecting a preset doesn't shuffle the texture underneath a stroke).
const grainPatternCache = new Map();
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h >>> 0;
}
function mulberry32(seed) {
  let t = seed;
  return function () {
    t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function getGrainPattern(color) {
  if (grainPatternCache.has(color)) return grainPatternCache.get(color);
  const size = 20;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(hashString(color));
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 40; i++) {
    ctx.globalAlpha = 0.25 + rand() * 0.5;
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, 0.4 + rand() * 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  grainPatternCache.set(color, canvas);
  return canvas;
}

const PALETTE_COLORS = ['#1B1D23', '#FFFFFF', '#E2483D', '#E0932B', '#F2C94C', '#1FA971', '#3E63DD', '#8B5CF6'];

function renderColorPalette() {
  const row = document.getElementById('colorPaletteRow');
  if (!row) return;
  row.innerHTML = '';
  PALETTE_COLORS.forEach((color) => {
    const sw = document.createElement('button');
    sw.className = 'color-palette-swatch' + (color.toLowerCase() === brush.color.toLowerCase() ? ' selected' : '');
    sw.style.background = color;
    sw.title = color;
    sw.addEventListener('click', () => {
      brush.color = color;
      document.getElementById('canvasColor').value = color;
      renderColorPalette();
    });
    row.appendChild(sw);
  });
}

// UI-only: gives an imported preset's swatch a stippled look so it reads as
// "textured" at a glance, distinct from a flat built-in brush dot.
function applyTextureToDot(dot, preset) {
  if (preset.sourceFormat && preset.sourceFormat !== 'json') {
    dot.style.background = 'radial-gradient(circle at 30% 30%, currentColor 0.6px, transparent 1.1px) 0 0/4px 4px, radial-gradient(circle at 65% 70%, currentColor 0.5px, transparent 1px) 0 0/5px 5px';
    dot.style.backgroundColor = 'transparent';
  } else {
    dot.style.background = 'currentColor';
  }
}

async function renderPresets() {
  const presets = await loadPresets();
  const wrap = document.getElementById('canvasBrushPresets');
  wrap.innerHTML = '';
  presets.forEach((preset) => {
    const swatch = document.createElement('button');
    swatch.className = 'brush-preset-swatch';
    swatch.title = preset.name;
    const dot = document.createElement('span');
    dot.className = 'dot';
    applyTextureToDot(dot, preset);
    const dotSize = Math.max(6, Math.min(24, preset.size));
    dot.style.width = dotSize + 'px';
    dot.style.height = dotSize + 'px';
    dot.style.opacity = String(preset.opacity);
    swatch.appendChild(dot);
    swatch.addEventListener('click', () => {
      wrap.querySelectorAll('.brush-preset-swatch').forEach((s) => s.classList.remove('selected'));
      swatch.classList.add('selected');
      applyPreset(preset);
    });
    // Built-ins (id starts with "builtin-") ship with the app and aren't deletable —
    // only presets a person saved or imported themselves.
    if (!preset.id.startsWith('builtin-')) {
      const del = document.createElement('button');
      del.className = 'brush-preset-delete';
      del.textContent = '×';
      del.title = 'Delete preset';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        await remove('BrushPresets', preset.id);
        renderPresets();
        renderBrushAlbum();
      });
      swatch.appendChild(del);
    }
    wrap.appendChild(swatch);
  });
  wireRipples(wrap);
}

async function saveCurrentAsPreset() {
  const name = prompt('Preset name?');
  if (!name) return;
  await put('BrushPresets', {
    id: crypto.randomUUID(),
    name: name.trim(),
    size: brush.size,
    opacity: brush.opacity,
    thinning: brush.thinning,
    smoothing: brush.smoothing,
    streamline: brush.streamline
  });
  renderPresets();
}

// ---- Brush pack import ----
// Full support for our own JSON brush-pack format. Real editor formats (.abr/.brushset)
// are proprietary binary/archive formats without a public spec — rather than fake full
// fidelity we can't actually deliver, we recover what's realistically extractable (the
// brush names, and for .abr a rough size) and import each as a generic brush using that
// name, clearly labeled so it's obvious texture/dynamics weren't preserved.
function clampNum(v, min, max, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

function parseJsonBrushPack(json, fileName) {
  const packName = (typeof json.name === 'string' && json.name.trim()) || fileName;
  const list = Array.isArray(json.brushes) ? json.brushes : [];
  return list.map((b, i) => ({
    id: crypto.randomUUID(),
    name: (typeof b.name === 'string' && b.name.trim()) || `Brush ${i + 1}`,
    size: clampNum(b.size, 1, 200, 12),
    opacity: clampNum(b.opacity, 0.05, 1, 0.9),
    thinning: clampNum(b.thinning, -1, 1, 0.5),
    smoothing: clampNum(b.smoothing, 0, 1, 0.5),
    streamline: clampNum(b.streamline, 0, 1, 0.5),
    packName,
    sourceFormat: 'json'
  }));
}

// A blind scan for any run of printable UTF-16BE characters (the original approach
// here) turns out to be nearly useless on a real .abr: actual brush names are a tiny
// fraction of the file, buried in binary sample-image data that "looks like" text
// often enough to bury every real name in garbage. Adobe's own descriptor formats
// (ABR v6+, PSD, etc.) store every string the same specific way — a big-endian
// uint32 character count immediately followed by that many UTF-16BE code units — so
// scanning for that exact shape, instead of just "printable characters", finds real
// names with drastically fewer false positives. Verified against a real 20-brush
// .abr: this recovers all 20 correct names; the naive scan recovered zero.
function findPascalUnicodeStrings(bytes, minLen = 2, maxLen = 40) {
  const out = [];
  for (let i = 0; i + 4 <= bytes.length; i++) {
    const count = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    if (count < minLen || count > maxLen) continue;
    const start = i + 4;
    const end = start + count * 2;
    if (end > bytes.length) continue;
    let str = '';
    let ok = true;
    for (let j = start; j < end; j += 2) {
      const code = (bytes[j] << 8) | bytes[j + 1];
      if (code === 0) {
        if (j !== end - 2) { ok = false; break; } // a trailing null terminator is fine, mid-string isn't
        continue;
      }
      if (code < 32 || code > 0xFFFD || (code >= 0xD800 && code < 0xE000)) { ok = false; break; }
      str += String.fromCharCode(code);
    }
    str = str.trim();
    if (ok && str.length >= minLen && /^[A-Za-z][A-Za-z0-9 _.,'&-]*$/.test(str) && !isUuidLike(str)) {
      out.push(str);
    }
  }
  return [...new Set(out)];
}

function isUuidLike(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function parseAbrBrushPack(bytes, fileName) {
  const names = findPascalUnicodeStrings(bytes);
  const packName = fileName.replace(/\.abr$/i, '');
  const picked = names.length ? names.slice(0, 60) : [packName];
  return picked.map((name) => ({
    id: crypto.randomUUID(),
    name,
    size: 16,
    opacity: 0.85,
    thinning: 0.4,
    smoothing: 0.5,
    streamline: 0.5,
    packName,
    sourceFormat: 'abr-partial'
  }));
}

// .brushset is a renamed zip; Procreate stores each brush as a "<Name>.brush/" folder
// entry. Reading the zip's central directory (at the end of the file) for entry names
// needs no decompression — real brush shape/grain data lives inside those folders in a
// format specific to Procreate's own engine, which this app's brush engine has no
// equivalent for, so only the names are recoverable here.
function listZipEntryNames(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const EOCD_SIG = 0x06054b50;
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65536); i--) {
    if (view.getUint32(i, true) === EOCD_SIG) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) return [];
  const entryCount = view.getUint16(eocdOffset + 10, true);
  let offset = view.getUint32(eocdOffset + 16, true);
  const names = [];
  const CDR_SIG = 0x02014b50;
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CDR_SIG) break;
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const nameBytes = bytes.slice(offset + 46, offset + 46 + nameLen);
    names.push(new TextDecoder('utf-8').decode(nameBytes));
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

function parseBrushsetPack(bytes, fileName) {
  const entries = listZipEntryNames(bytes);
  const names = [...new Set(
    entries
      .map((n) => n.match(/^([^/]+)\.brush\//))
      .filter(Boolean)
      .map((m) => m[1])
  )];
  const packName = fileName.replace(/\.brushset$/i, '');
  const picked = names.length ? names.slice(0, 24) : [packName];
  return picked.map((name) => ({
    id: crypto.randomUUID(),
    name,
    size: 16,
    opacity: 0.85,
    thinning: 0.4,
    smoothing: 0.5,
    streamline: 0.5,
    packName,
    sourceFormat: 'brushset-partial'
  }));
}

async function parseOneBrushFile(lower, name, blob) {
  if (lower.endsWith('.json')) {
    const json = JSON.parse(await blob.text());
    return parseJsonBrushPack(json, name.replace(/\.json$/i, ''));
  }
  if (lower.endsWith('.abr')) {
    return parseAbrBrushPack(new Uint8Array(await blob.arrayBuffer()), name);
  }
  if (lower.endsWith('.brushset')) {
    return parseBrushsetPack(new Uint8Array(await blob.arrayBuffer()), name);
  }
  return null;
}

// Real brush packs (this is how they're actually sold/shared — Etsy, Gumroad, etc.)
// are almost always a plain .zip wrapping one or more .abr/.brushset/.json files
// rather than a bare .abr on its own, so a .zip has to be looked inside rather than
// rejected outright.
async function importZipBrushPack(file) {
  const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files).filter((f) => !f.dir && /\.(abr|brushset|json)$/i.test(f.name));
  if (!entries.length) return [];
  const results = [];
  for (const entry of entries) {
    const baseName = entry.name.split('/').pop();
    const lower = baseName.toLowerCase();
    const blob = await entry.async('blob');
    try {
      const presets = await parseOneBrushFile(lower, baseName, blob);
      if (presets) results.push(...presets);
    } catch (err) {
      console.error(`Failed to read "${entry.name}" inside zip`, err);
    }
  }
  return results;
}

async function importBrushPackFile(file) {
  const lower = file.name.toLowerCase();
  let presets = [];
  try {
    if (lower.endsWith('.zip')) {
      presets = await importZipBrushPack(file);
      if (!presets.length) {
        showToast('No .json/.abr/.brushset files found inside that zip');
        return;
      }
    } else {
      presets = await parseOneBrushFile(lower, file.name, file);
      if (presets === null) {
        showToast('Unsupported file — use .json, .abr, .brushset, or a .zip containing one');
        return;
      }
    }
  } catch (err) {
    console.error('Brush pack import failed', err);
    showToast(`Couldn't read "${file.name}"`);
    return;
  }
  if (!presets.length) {
    showToast('No brushes found in that file');
    return;
  }
  await Promise.all(presets.map((p) => put('BrushPresets', p)));
  const partial = presets[0]?.sourceFormat !== 'json';
  showToast(partial
    ? `Imported ${presets.length} brush${presets.length > 1 ? 'es' : ''} — texture not preserved`
    : `Imported ${presets.length} brush${presets.length > 1 ? 'es' : ''}`);
  await renderPresets();
  await renderBrushAlbum();
}

async function renderBrushAlbum() {
  const all = await getAll('BrushPresets');
  const imported = all.filter((p) => p.packName);
  const grid = document.getElementById('brushAlbumGrid');
  grid.innerHTML = '';
  document.getElementById('brushAlbumEmpty').classList.toggle('hidden', imported.length > 0);
  imported.forEach((preset) => {
    const card = document.createElement('div');
    card.className = 'brush-album-card';
    const swatch = document.createElement('div');
    swatch.className = 'brush-album-swatch';
    const dot = document.createElement('span');
    dot.className = 'dot';
    applyTextureToDot(dot, preset);
    const dotSize = Math.max(6, Math.min(22, preset.size));
    dot.style.width = dotSize + 'px';
    dot.style.height = dotSize + 'px';
    dot.style.opacity = String(preset.opacity);
    swatch.appendChild(dot);
    card.appendChild(swatch);
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = preset.name;
    name.title = preset.name;
    card.appendChild(name);
    const pack = document.createElement('div');
    pack.className = 'pack';
    pack.textContent = preset.sourceFormat === 'json' ? preset.packName : `${preset.packName} · partial`;
    pack.title = pack.textContent;
    card.appendChild(pack);
    card.addEventListener('click', () => applyPreset(preset));

    const del = document.createElement('button');
    del.className = 'brush-album-delete';
    del.textContent = '×';
    del.title = 'Delete brush';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      await remove('BrushPresets', preset.id);
      renderBrushAlbum();
      renderPresets();
    });
    card.appendChild(del);

    grid.appendChild(card);
  });
  wireRipples(grid);
}

function wireBrushImport() {
  const tile = document.querySelector('.brush-import-tile');
  const input = document.getElementById('brushImportInput');
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importBrushPackFile(file);
  });
  tile.addEventListener('dragover', (e) => { e.preventDefault(); tile.classList.add('drag-over'); });
  tile.addEventListener('dragleave', () => tile.classList.remove('drag-over'));
  tile.addEventListener('drop', (e) => {
    e.preventDefault();
    tile.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) importBrushPackFile(file);
  });
  document.getElementById('btnBrushImport').addEventListener('click', () => {
    const panel = document.getElementById('brushImportPanel');
    document.getElementById('canvasLayersPanel').classList.add('hidden');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) renderBrushAlbum();
  });
}

// ---- Drawing ----
function relativePointer() {
  return stage.getRelativePointerPosition();
}

function sampleFillAt(pos) {
  const shape = stage.getIntersection(stage.getPointerPosition());
  if (shape && typeof shape.fill === 'function') {
    const f = shape.fill();
    if (typeof f === 'string') return f;
  }
  return null;
}

function isMultiTouch(e) {
  return e.evt.touches && e.evt.touches.length > 1;
}

// Bare contact used to commit real ink immediately on pointerdown — even reaching
// for a panel control that happened to graze the canvas left a mark. Contact now only
// "arms" a pending stroke (shown as a hollow ring at the pointer); nothing is added to
// the layer until the pointer has actually moved past ARM_THRESHOLD px on screen.
const ARM_THRESHOLD = 4;
let pendingStart = null; // { pos, pressure, clientX, clientY }
let armedRingEl = null;

function armedRingScreenSize() {
  return Math.max(10, brush.size * (stage.scaleX() || 1));
}

function showArmedRing(clientX, clientY) {
  if (!armedRingEl) {
    armedRingEl = document.createElement('div');
    armedRingEl.className = 'brush-armed-ring';
    document.body.appendChild(armedRingEl);
  }
  const size = armedRingScreenSize();
  armedRingEl.style.width = size + 'px';
  armedRingEl.style.height = size + 'px';
  armedRingEl.style.left = clientX + 'px';
  armedRingEl.style.top = clientY + 'px';
  armedRingEl.style.display = 'block';
}

function hideArmedRing() {
  if (armedRingEl) armedRingEl.style.display = 'none';
}

function startStroke(e) {
  if (isMultiTouch(e)) return;
  const pos = relativePointer();
  if (!pos) return;
  // Deliberately NOT calling stage.container().setPointerCapture() here: Konva 9.x
  // already captures the pointer internally on pointerdown (Konva.capturePointerEventsEnabled,
  // shape.setPointerCapture()) to solve exactly the "fast stroke loses tracking" problem this
  // used to work around. Our own capture call on the outer container raced with Konva's
  // internal one for the same pointerId — whichever ran second silently stole capture away
  // from the other, and losing Konva's own capture meant it stopped delivering pointermove/
  // pointerup for the rest of the stroke, leaving `drawing` stuck true until the next
  // successful down/up cycle. Trusting Konva's own capture fixes both that and this pass's
  // move-threshold logic, which depends on continued pointermove delivery to arm correctly.
  const pressure = e.evt.pressure && e.evt.pressure > 0 ? e.evt.pressure : 0.5;
  pendingStart = { pos, pressure, clientX: e.evt.clientX, clientY: e.evt.clientY };
  showArmedRing(e.evt.clientX, e.evt.clientY);
}

function beginRealStroke(pos, pressure) {
  drawing = true;
  strokePoints = [[pos.x, pos.y, pressure]];

  const layer = activeLayer();
  let fill = brush.color;
  let compositeOp = layer.blendMode;
  if (activeTool === 'eraser') { fill = '#000000'; compositeOp = 'destination-out'; }
  if (activeTool === 'smudge') {
    smudgeColor = sampleFillAt(pos) || brush.color;
    fill = smudgeColor;
  }

  const shapeConfig = {
    points: outlinePoints(strokePoints, brush.size),
    closed: true,
    opacity: activeTool === 'smudge' ? brush.opacity * 0.7 : brush.opacity,
    globalCompositeOperation: compositeOp,
    listening: activeTool !== 'eraser'
  };
  if (brush.textured && activeTool === 'brush') {
    shapeConfig.fillPatternImage = getGrainPattern(brush.color);
    shapeConfig.fillPriority = 'pattern';
    shapeConfig.fillPatternRepeat = 'repeat';
  } else {
    shapeConfig.fill = fill;
  }
  currentShape = new Konva.Line(shapeConfig);
  layer.konvaLayer.add(currentShape);
  layer.konvaLayer.batchDraw();
}

function continueStroke(e) {
  if (isMultiTouch(e)) return;
  const pos = relativePointer();
  if (!pos) return;
  const pressure = e.evt.pressure && e.evt.pressure > 0 ? e.evt.pressure : 0.5;

  if (!drawing) {
    if (!pendingStart) return;
    showArmedRing(e.evt.clientX, e.evt.clientY);
    const dx = e.evt.clientX - pendingStart.clientX;
    const dy = e.evt.clientY - pendingStart.clientY;
    if (Math.hypot(dx, dy) < ARM_THRESHOLD) return;
    hideArmedRing();
    beginRealStroke(pendingStart.pos, pendingStart.pressure);
  }

  strokePoints.push([pos.x, pos.y, pressure]);

  if (activeTool === 'smudge') {
    const sampled = sampleFillAt(pos);
    if (sampled) smudgeColor = lerpColor(smudgeColor, sampled, 0.18);
    currentShape.fill(smudgeColor);
  }

  currentShape.points(outlinePoints(strokePoints, brush.size));
  activeLayer().konvaLayer.batchDraw();
}

function endStroke() {
  hideArmedRing();
  pendingStart = null;
  if (!drawing) return;
  drawing = false;
  if (strokePoints.length < 2) {
    currentShape.remove();
  } else {
    pushUndo({ type: 'add', layerIndex: activeLayerIndex, node: currentShape });
    scheduleDraftSave();
    refreshThumbsIfPanelOpen();
  }
  currentShape = null;
  strokePoints = [];
}

function lerpColor(a, b, t) {
  const pa = hexToRgb(a), pb = hexToRgb(b);
  if (!pa || !pb) return b;
  const r = Math.round(pa.r + (pb.r - pa.r) * t);
  const g = Math.round(pa.g + (pb.g - pa.g) * t);
  const bl = Math.round(pa.b + (pb.b - pa.b) * t);
  return `rgb(${r},${g},${bl})`;
}
function hexToRgb(color) {
  if (!color) return null;
  if (color.startsWith('rgb')) {
    const m = color.match(/[\d.]+/g);
    return m ? { r: +m[0], g: +m[1], b: +m[2] } : null;
  }
  const hex = color.replace('#', '');
  if (hex.length !== 6) return null;
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
}

// ---- Select tool ----
function selectShape(node) {
  deselectShape();
  if (!node) return;
  selectedNode = node;
  node.draggable(true);
  transformer.nodes([node]);
  transformer.moveToTop();
  stage.batchDraw();

  let dragStart = null;
  node.on('dragstart.select', () => { dragStart = { x: node.x(), y: node.y() }; });
  node.on('dragend.select', () => {
    if (dragStart) {
      const to = { x: node.x(), y: node.y() };
      if (to.x !== dragStart.x || to.y !== dragStart.y) {
        pushUndo({ type: 'move', node, from: dragStart, to, layerIndex: layers.findIndex((l) => l.konvaLayer === node.getLayer()) });
        scheduleDraftSave();
      }
    }
  });
}

function deselectShape() {
  if (selectedNode) {
    selectedNode.draggable(false);
    selectedNode.off('.select');
  }
  selectedNode = null;
  transformer.nodes([]);
  stage.batchDraw();
}

function deleteSelected() {
  if (!selectedNode) return;
  const layerIndex = layers.findIndex((l) => l.konvaLayer === selectedNode.getLayer());
  pushUndo({ type: 'remove', layerIndex, node: selectedNode });
  selectedNode.remove();
  deselectShape();
  stage.batchDraw();
  scheduleDraftSave();
  refreshThumbsIfPanelOpen();
}

// ---- Zoom / pan ----
function wireZoomPan(containerEl) {
  containerEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const mousePointTo = { x: (pointer.x - stage.x()) / oldScale, y: (pointer.y - stage.y()) / oldScale };
    const scaleBy = 1.05;
    const direction = e.deltaY > 0 ? -1 : 1;
    const newScale = Math.min(Math.max(direction > 0 ? oldScale * scaleBy : oldScale / scaleBy, 0.2), 4);
    stage.scale({ x: newScale, y: newScale });
    stage.position({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
    stage.batchDraw();
  }, { passive: false });

  stage.on('touchmove', (e) => {
    const touches = e.evt.touches;
    if (touches && touches.length === 2) {
      e.evt.preventDefault();
      if (drawing) endStroke();
      const p1 = { x: touches[0].clientX, y: touches[0].clientY };
      const p2 = { x: touches[1].clientX, y: touches[1].clientY };
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      if (!pinchLastDist) { pinchLastDist = dist; pinchLastCenter = center; return; }
      const oldScale = stage.scaleX();
      const pointTo = { x: (center.x - stage.x()) / oldScale, y: (center.y - stage.y()) / oldScale };
      const newScale = Math.min(Math.max(oldScale * (dist / pinchLastDist), 0.2), 4);
      const dx = center.x - pinchLastCenter.x, dy = center.y - pinchLastCenter.y;
      stage.scale({ x: newScale, y: newScale });
      stage.position({ x: center.x - pointTo.x * newScale + dx, y: center.y - pointTo.y * newScale + dy });
      pinchLastDist = dist;
      pinchLastCenter = center;
      stage.batchDraw();
    }
  });
  stage.on('touchend', () => { pinchLastDist = 0; pinchLastCenter = null; });
}

// ---- Tools ----
function setActiveTool(tool) {
  activeTool = tool;
  document.querySelectorAll('#canvasHud .hud-btn[data-canvas-tool]').forEach((b) => b.classList.toggle('active', b.dataset.canvasTool === tool));
  stage.draggable(tool === 'pan');
  if (tool !== 'select') deselectShape();
}

function wireStageEvents() {
  stage.on('pointerdown', (e) => {
    if (activeTool === 'select') {
      if (e.target === stage) { deselectShape(); return; }
      if (e.target.getLayer() === layers[activeLayerIndex]?.konvaLayer || layers.some((l) => l.konvaLayer === e.target.getLayer())) {
        selectShape(e.target);
      }
      return;
    }
    if (activeTool === 'pan') return;
    startStroke(e);
  });
  stage.on('pointermove', (e) => {
    if (activeTool === 'select' || activeTool === 'pan') return;
    continueStroke(e);
  });
  // pointerup only — pointerleave used to also end the stroke, which fired the
  // instant a fast stroke's coordinates outran the stage's bounds mid-frame,
  // cutting the stroke off well before the pointer was actually released.
  stage.on('pointerup', () => {
    if (activeTool === 'select' || activeTool === 'pan') return;
    endStroke();
  });
}

function rebuildLayersFromStage(meta) {
  layers = stage.getLayers().map((konvaLayer, i) => {
    const saved = meta?.[i] || {};
    return {
      id: saved.id || crypto.randomUUID(),
      name: saved.name || `Layer ${i + 1}`,
      konvaLayer,
      visible: saved.visible !== false,
      opacity: saved.opacity ?? 1,
      blendMode: saved.blendMode || 'source-over'
    };
  });
  layers.forEach((l) => { l.konvaLayer.visible(l.visible); l.konvaLayer.opacity(l.opacity); });
  activeLayerIndex = layers.length - 1;
}

async function restoreDraftOrCreate(containerEl) {
  const draft = await get('CanvasDraft', DRAFT_KEY);
  if (draft && draft.json) {
    try {
      stage = Konva.Node.create(draft.json, containerEl.id);
      rebuildLayersFromStage(draft.layerMeta);
      return;
    } catch (err) {
      console.error('Failed to restore canvas draft, starting fresh', err);
    }
  }
  stage = new Konva.Stage({ container: containerEl.id, width: STAGE_WIDTH, height: STAGE_HEIGHT });
  const bgLayer = new Konva.Layer();
  stage.add(bgLayer);
  bgLayer.add(new Konva.Rect({ x: 0, y: 0, width: STAGE_WIDTH, height: STAGE_HEIGHT, fill: '#ffffff', listening: false }));
  layers = [{ id: crypto.randomUUID(), name: 'Layer 1', konvaLayer: bgLayer, visible: true, opacity: 1, blendMode: 'source-over' }];
  activeLayerIndex = 0;
}

function fitStageToContainer(containerEl) {
  const scale = Math.min(containerEl.clientWidth / STAGE_WIDTH, containerEl.clientHeight / STAGE_HEIGHT) * 0.9;
  stage.width(containerEl.clientWidth);
  stage.height(containerEl.clientHeight);
  stage.scale({ x: scale, y: scale });
  stage.position({ x: (containerEl.clientWidth - STAGE_WIDTH * scale) / 2, y: (containerEl.clientHeight - STAGE_HEIGHT * scale) / 2 });
  stage.batchDraw();
}

// ---- Save / export ----
async function embedPngAsPdf(dataUrl, pixelWidth, pixelHeight) {
  const doc = await PDFDocument.create();
  const pngBytes = await (await fetch(dataUrl)).arrayBuffer();
  const png = await doc.embedPng(pngBytes);
  const scale = 595.28 / pixelWidth; // fit to A4 width in points
  const page = doc.addPage([pixelWidth * scale, pixelHeight * scale]);
  page.drawImage(png, { x: 0, y: 0, width: pixelWidth * scale, height: pixelHeight * scale });
  return doc.save();
}

async function saveCanvas() {
  deselectShape();
  const wasVisible = transformer?.visible();
  transformer?.hide();
  stage.batchDraw();

  const dataUrl = stage.toDataURL({ x: 0, y: 0, width: STAGE_WIDTH, height: STAGE_HEIGHT, pixelRatio: 1 });
  transformer?.visible(wasVisible ?? true);

  const pdfBytes = await embedPngAsPdf(dataUrl, STAGE_WIDTH, STAGE_HEIGHT);
  const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });

  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15) + 'Z';
  const fileName = `Canvas_${timestamp}.pdf`;

  await addFileRecord({ id, fileName, pdfBlob, templateId: 'Canvas', source: 'canvas' });
  await enqueue({ idempotencyKey: id, templateId: 'Canvas', fileName, pdfBlob });
  await remove('CanvasDraft', DRAFT_KEY);

  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = 'Saved to My files — syncing to SharePoint';
  document.getElementById('toastShareBtn').classList.add('hidden');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3200);
}

// ---- Bootstrap ----
function wireHud() {
  document.querySelectorAll('#canvasHud .hud-btn[data-canvas-tool]').forEach((btn) => {
    btn.addEventListener('click', () => setActiveTool(btn.dataset.canvasTool));
  });
  document.getElementById('canvasColor').addEventListener('input', (e) => {
    brush.color = e.target.value;
    renderColorPalette();
  });
  document.getElementById('canvasBrushSize').addEventListener('input', (e) => { brush.size = parseInt(e.target.value, 10); });
  document.getElementById('btnCanvasUndo').addEventListener('click', undo);
  document.getElementById('btnCanvasRedo').addEventListener('click', redo);
  document.getElementById('btnCanvasSave').addEventListener('click', saveCanvas);
  document.getElementById('btnCanvasLayers').addEventListener('click', () => {
    const panel = document.getElementById('canvasLayersPanel');
    document.getElementById('brushImportPanel').classList.add('hidden');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) { renderLayerList(); renderColorPalette(); }
  });
  document.getElementById('btnAddLayer').addEventListener('click', () => addLayer());
  document.getElementById('btnAddBackgroundLayer').addEventListener('click', () => {
    addBackgroundLayer(document.getElementById('bgLayerColor').value);
  });
  document.getElementById('btnSwapColors').addEventListener('click', () => {
    const primary = document.getElementById('canvasColor');
    const secondary = document.getElementById('canvasColorSecondary');
    const swapped = secondary.value;
    secondary.value = primary.value;
    primary.value = swapped;
    brush.color = primary.value;
    renderColorPalette();
  });
  document.getElementById('btnSaveBrushPreset').addEventListener('click', saveCurrentAsPreset);
  document.getElementById('canvasBlendMode').addEventListener('change', (e) => setLayerBlendMode(activeLayerIndex, e.target.value));

  document.addEventListener('keydown', (e) => {
    if (document.getElementById('screen-canvas').classList.contains('hidden')) return;
    if (document.activeElement && document.activeElement.isContentEditable) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNode) { e.preventDefault(); deleteSelected(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  });
}

export async function initCanvasTab() {
  const containerEl = document.getElementById('konvaContainer');
  if (!initialized) {
    await restoreDraftOrCreate(containerEl);
    transformer = new Konva.Transformer({ rotateEnabled: true, enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'] });
    layers[layers.length - 1].konvaLayer.add(transformer);
    fitStageToContainer(containerEl);
    wireStageEvents();
    wireZoomPan(containerEl);
    wireHud();
    wireBrushImport();
    await renderPresets();
    renderLayerList();
    renderColorPalette();
    window.addEventListener('resize', () => fitStageToContainer(containerEl));
    initialized = true;
  } else {
    fitStageToContainer(containerEl);
  }
}
