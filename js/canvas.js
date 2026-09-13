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

// A real decoded brush-tip bitmap (from .abr/.brushset), active for the current preset.
// { image: HTMLImageElement, width, height } once loaded, or null — null means "no real
// tip available for this preset", which keeps every existing tool (vector outline +
// procedural grain) working exactly as before. Tinted copies (recolored per brush.color)
// are cached per source image since the same tip gets reused across colors/strokes.
let activeBitmapTip = null;
const tintedStampCache = new WeakMap(); // Image -> Map(color -> canvas)

function getTintedStamp(image, color) {
  let byColor = tintedStampCache.get(image);
  if (!byColor) { byColor = new Map(); tintedStampCache.set(image, byColor); }
  let canvas = byColor.get(color);
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  byColor.set(color, canvas);
  return canvas;
}

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
// Every layer is clipped to the document's actual bounds — without this, dragging a
// stroke past the edge of the visible page (into the wrapper's own margin, still
// inside the stage's full-size hit-test area) rendered it floating outside the
// canvas/background entirely, since nothing constrained content to STAGE_WIDTH x
// STAGE_HEIGHT except the export step, which silently cropped it out only at the end.
function makeLayerMeta(id, name, blendMode = 'source-over') {
  const konvaLayer = new Konva.Layer();
  konvaLayer.clip({ x: 0, y: 0, width: STAGE_WIDTH, height: STAGE_HEIGHT }); // constructor option is a plain attr, not the clip setter — must be called explicitly
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
  // .abr/.brushset imports recover a name (and for .abr, a rough size); some also
  // yield a real decoded tip bitmap (preset.tipImage) — when they do, painting uses
  // that actual shape via activeBitmapTip instead of guessing. Presets without one
  // (procreate brushes with no Shape.png, or .abr tips this decoder couldn't read)
  // fall back to a procedural grain fill so they still look distinct from a flat
  // built-in brush, just not with recovered texture.
  brush.textured = !!(preset.sourceFormat && preset.sourceFormat !== 'json' && !preset.tipImage);
  activeBitmapTip = null;
  if (preset.tipImage) {
    const img = new Image();
    img.onload = () => { activeBitmapTip = { image: img, width: preset.tipWidth, height: preset.tipHeight }; };
    img.onerror = () => { activeBitmapTip = null; };
    img.src = preset.tipImage;
  }
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

// Preview the real decoded tip bitmap on the swatch when one was recovered; otherwise
// fall back to a stippled look so an imported-but-un-decoded preset still reads as
// "textured" at a glance, distinct from a flat built-in brush dot.
function applyTextureToDot(dot, preset) {
  if (preset.tipImage) {
    dot.style.background = `center / contain no-repeat url(${preset.tipImage})`;
    dot.style.backgroundColor = 'transparent';
  } else if (preset.sourceFormat && preset.sourceFormat !== 'json') {
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

// The ABR "samp" section holds each brush's real sampled tip bitmap: a UUID, a bounds
// rect (top/left/bottom/right), a bit depth, a compression flag, then the pixels —
// either raw or PackBits-RLE'd one scanline at a time (each row prefixed by its own
// compressed byte length). This layout isn't Adobe-documented but is well established
// from reverse-engineering (matches known open-source ABR readers) and was verified
// directly against a real 20-brush pack: it decodes clean, correctly-shaped brush-tip
// images (not noise), one per brush, in the same order as the brush names.
const ABR_SUBVERSION_HEADER_SKIP = { 1: 47, 2: 301 };

function abrRleDecode(view, posRef, height, bytesPerRow) {
  const scanlineLengths = [];
  for (let i = 0; i < height; i++) { scanlineLengths.push(view.getUint16(posRef.pos, false)); posRef.pos += 2; }
  const buffer = new Uint8Array(height * bytesPerRow);
  let bpos = 0;
  for (const length of scanlineLengths) {
    const end = posRef.pos + length;
    while (posRef.pos < end && bpos < buffer.length) {
      const n = view.getInt8(posRef.pos); posRef.pos += 1;
      if (n >= 0) {
        const count = n + 1;
        const take = Math.min(count, buffer.length - bpos);
        for (let k = 0; k < take; k++) buffer[bpos + k] = view.getUint8(posRef.pos + k);
        posRef.pos += count;
        bpos += take;
      } else if (n !== -128) {
        const val = view.getUint8(posRef.pos); posRef.pos += 1;
        const count = -n + 1;
        const take = Math.min(count, buffer.length - bpos);
        buffer.fill(val, bpos, bpos + take);
        bpos += take;
      }
    }
  }
  return buffer;
}

// Returns [{ width, height, alpha: Uint8Array }] — one entry per decodable tip, in file
// order (matching brush-name order). Depths other than 8/16 bit (rare — mostly hard-
// edged 1-bit shape brushes) are skipped rather than guessed at.
function decodeAbrTips(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const posRef = { pos: 0 };
  const subversion = view.getUint16(2, false);
  const tips = [];
  posRef.pos = 4;
  while (posRef.pos < bytes.length - 8) {
    const tagStart = posRef.pos;
    let tag = '';
    for (let i = 0; i < 4; i++) tag += String.fromCharCode(view.getUint8(tagStart + i));
    if (tag !== '8BIM') break;
    posRef.pos += 4;
    let key = '';
    for (let i = 0; i < 4; i++) key += String.fromCharCode(view.getUint8(posRef.pos + i));
    posRef.pos += 4;
    const length = view.getUint32(posRef.pos, false); posRef.pos += 4;
    const sectionStart = posRef.pos;
    const sectionEnd = sectionStart + length;
    if (key === 'samp') {
      while (posRef.pos < sectionEnd) {
        const entryLen = view.getUint32(posRef.pos, false); posRef.pos += 4;
        const entryDataStart = posRef.pos;
        const nextEntryPos = entryDataStart + entryLen + ((4 - (entryLen % 4)) % 4);
        const uuidLen = view.getUint8(posRef.pos); posRef.pos += 1;
        posRef.pos += uuidLen; // brush UUID text, not needed once names are paired positionally
        const skip = ABR_SUBVERSION_HEADER_SKIP[subversion] ?? 301;
        posRef.pos = entryDataStart + skip;
        const top = view.getInt32(posRef.pos, false); posRef.pos += 4;
        const left = view.getInt32(posRef.pos, false); posRef.pos += 4;
        const bottom = view.getInt32(posRef.pos, false); posRef.pos += 4;
        const right = view.getInt32(posRef.pos, false); posRef.pos += 4;
        const depth = view.getUint16(posRef.pos, false); posRef.pos += 2;
        const compress = view.getUint8(posRef.pos); posRef.pos += 1;
        const width = right - left, height = bottom - top;
        if (width > 0 && height > 0 && width < 4000 && height < 4000 && (depth === 8 || depth === 16)) {
          const bytesPerPixel = depth / 8;
          const bytesPerRow = width * bytesPerPixel;
          let raw;
          if (compress) {
            raw = abrRleDecode(view, posRef, height, bytesPerRow);
          } else {
            const nBytes = height * bytesPerRow;
            raw = new Uint8Array(bytes.buffer, bytes.byteOffset + posRef.pos, nBytes).slice();
            posRef.pos += nBytes;
          }
          const alpha = depth === 8 ? raw : new Uint8Array(width * height).map((_, i) => raw[i * 2]);
          tips.push({ width, height, alpha });
        }
        posRef.pos = nextEntryPos;
      }
    }
    posRef.pos = sectionEnd + (sectionEnd % 2);
  }
  return tips;
}

// Builds a compact alpha-mask PNG (white RGB, alpha = tip intensity) from a decoded tip,
// downscaled so storage/stamping stay cheap — real sample tips run up to ~2500px, far
// more resolution than a repeatedly-stamped brush needs on screen.
const TIP_MAX_DIM = 256;
function buildTipImageDataUrl(width, height, alpha) {
  const full = document.createElement('canvas');
  full.width = width;
  full.height = height;
  const fullCtx = full.getContext('2d');
  const imgData = fullCtx.createImageData(width, height);
  for (let i = 0; i < alpha.length; i++) {
    imgData.data[i * 4] = 255;
    imgData.data[i * 4 + 1] = 255;
    imgData.data[i * 4 + 2] = 255;
    imgData.data[i * 4 + 3] = alpha[i];
  }
  fullCtx.putImageData(imgData, 0, 0);

  const scale = Math.min(1, TIP_MAX_DIM / Math.max(width, height));
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  out.getContext('2d').drawImage(full, 0, 0, outW, outH);
  return { dataUrl: out.toDataURL('image/png'), width: outW, height: outH };
}

function parseAbrBrushPack(bytes, fileName) {
  const names = findPascalUnicodeStrings(bytes);
  const packName = fileName.replace(/\.abr$/i, '');
  const picked = names.length ? names.slice(0, 60) : [packName];
  let tips = [];
  try { tips = decodeAbrTips(bytes); } catch (err) { console.error('ABR tip bitmap decode failed', err); }
  return picked.map((name, i) => {
    const preset = {
      id: crypto.randomUUID(),
      name,
      size: 16,
      opacity: 0.85,
      thinning: 0.4,
      smoothing: 0.5,
      streamline: 0.5,
      packName,
      sourceFormat: 'abr-partial'
    };
    const tip = tips[i];
    if (tip) {
      try {
        const built = buildTipImageDataUrl(tip.width, tip.height, tip.alpha);
        preset.tipImage = built.dataUrl;
        preset.tipWidth = built.width;
        preset.tipHeight = built.height;
      } catch (err) { console.error('Failed to build tip image for', name, err); }
    }
    return preset;
  });
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadImageFromBytes(bytes, mimeType) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (err) => { URL.revokeObjectURL(url); reject(err); };
    img.src = url;
  });
}

function downscaleImageToDataUrl(img) {
  const scale = Math.min(1, TIP_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
}

// .brushset is a renamed zip; Procreate stores each brush as a "<Name>.brush/" folder,
// and — unlike .abr — the brush's real tip is a plain PNG inside it (Shape.png, by
// Procreate's own documented brush-authoring convention: a white brush mark on a
// transparent background), so it decodes with the browser's normal image handling,
// no proprietary format guessing needed.
async function parseBrushsetPack(bytes, fileName) {
  const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
  const zip = await JSZip.loadAsync(bytes);
  const names = [...new Set(
    Object.keys(zip.files)
      .map((n) => n.match(/^([^/]+)\.brush\//))
      .filter(Boolean)
      .map((m) => m[1])
  )];
  const packName = fileName.replace(/\.brushset$/i, '');
  const picked = names.length ? names.slice(0, 24) : [packName];
  const results = [];
  for (const name of picked) {
    const preset = {
      id: crypto.randomUUID(),
      name,
      size: 16,
      opacity: 0.85,
      thinning: 0.4,
      smoothing: 0.5,
      streamline: 0.5,
      packName,
      sourceFormat: 'brushset-partial'
    };
    const shapeMatches = zip.file(new RegExp(`^${escapeRegExp(name)}\\.brush/Shape\\.png$`, 'i'));
    const anyPngMatches = zip.file(new RegExp(`^${escapeRegExp(name)}\\.brush/.*\\.png$`, 'i'));
    const shapeEntry = shapeMatches[0] || anyPngMatches[0];
    if (shapeEntry) {
      try {
        const pngBytes = await shapeEntry.async('uint8array');
        const img = await loadImageFromBytes(pngBytes, 'image/png');
        const built = downscaleImageToDataUrl(img);
        preset.tipImage = built.dataUrl;
        preset.tipWidth = built.width;
        preset.tipHeight = built.height;
      } catch (err) { console.error('Failed to decode Shape.png for', name, err); }
    }
    results.push(preset);
  }
  return results;
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
  const withTip = presets.filter((p) => p.tipImage).length;
  const label = `${presets.length} brush${presets.length > 1 ? 'es' : ''}`;
  let msg = `Imported ${label}`;
  if (partial) {
    msg = withTip === presets.length ? `Imported ${label} with real tip textures`
      : withTip > 0 ? `Imported ${label} — ${withTip} with real tip texture, rest are flat`
      : `Imported ${label} — texture not preserved`;
  }
  showToast(msg);
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

// ---- Bitmap-tip stamping ----
// Real brush-tip bitmaps paint by stamping the (recolored) tip image repeatedly along
// the stroke path — spaced by arc length, rotated to follow the direction of travel —
// rather than filling a single vector outline. The result is composited onto a
// STAGE_WIDTH x STAGE_HEIGHT scratch canvas that backs one Konva.Image per stroke, kept
// in sync with the existing undo/redo/draft-save code below since those already treat
// "the current shape" as an opaque Konva.Node. A raw canvas can't survive Konva's
// stage.toJSON() draft serialization (it drops DOM elements silently), so the finished
// stroke's pixels are also stashed as a data URL in a custom attr and restored by
// rebuildLayersFromStage — the same fix the paint-bucket fill node needed for the
// same reason.
let strokeIsStamp = false;
let stampCanvasEl = null;
let stampCtx = null;
let stampTintedCanvas = null;
let stampAspect = 1;
let stampLastPos = null;
let stampDistanceAccum = 0;

function stampSizeFor(size) {
  // brush.size (4-200) reads as stroke thickness for the vector path; a recognizable
  // tip shape (a whole leaf/vine segment, not just a dab) needs a much larger scale.
  return size * 6;
}

function drawTipStamp(x, y, angle) {
  const h = stampSizeFor(brush.size);
  const w = h * stampAspect;
  stampCtx.save();
  stampCtx.translate(x, y);
  stampCtx.rotate(angle + Math.PI / 2);
  stampCtx.globalAlpha = brush.opacity;
  stampCtx.drawImage(stampTintedCanvas, -w / 2, -h / 2, w, h);
  stampCtx.restore();
}

function stampSegment(fromX, fromY, toX, toY) {
  const spacing = Math.max(2, stampSizeFor(brush.size) * 0.16);
  const dx = toX - fromX, dy = toY - fromY;
  const segLen = Math.hypot(dx, dy);
  if (segLen === 0) return;
  const angle = Math.atan2(dy, dx);
  let pos = 0;
  while (true) {
    const remainingToStamp = spacing - stampDistanceAccum;
    if (pos + remainingToStamp > segLen) {
      stampDistanceAccum += segLen - pos;
      break;
    }
    pos += remainingToStamp;
    stampDistanceAccum = 0;
    const t = pos / segLen;
    drawTipStamp(fromX + dx * t, fromY + dy * t, angle);
  }
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

  strokeIsStamp = activeTool === 'brush' && !!activeBitmapTip?.image;
  if (strokeIsStamp) {
    stampCanvasEl = document.createElement('canvas');
    stampCanvasEl.width = STAGE_WIDTH;
    stampCanvasEl.height = STAGE_HEIGHT;
    stampCtx = stampCanvasEl.getContext('2d');
    stampTintedCanvas = getTintedStamp(activeBitmapTip.image, brush.color);
    stampAspect = activeBitmapTip.width / activeBitmapTip.height;
    stampLastPos = { x: pos.x, y: pos.y };
    stampDistanceAccum = 0;
    drawTipStamp(pos.x, pos.y, 0);
    currentShape = new Konva.Image({
      image: stampCanvasEl,
      x: 0, y: 0, width: STAGE_WIDTH, height: STAGE_HEIGHT,
      globalCompositeOperation: compositeOp,
      listening: false
    });
    layer.konvaLayer.add(currentShape);
    layer.konvaLayer.batchDraw();
    return;
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

  if (strokeIsStamp) {
    stampSegment(stampLastPos.x, stampLastPos.y, pos.x, pos.y);
    stampLastPos = { x: pos.x, y: pos.y };
    activeLayer().konvaLayer.batchDraw();
    return;
  }

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
    if (strokeIsStamp) currentShape.setAttr('customImageSrc', stampCanvasEl.toDataURL());
    pushUndo({ type: 'add', layerIndex: activeLayerIndex, node: currentShape });
    scheduleDraftSave();
    refreshThumbsIfPanelOpen();
  }
  currentShape = null;
  strokePoints = [];
  strokeIsStamp = false;
  stampCanvasEl = null;
  stampCtx = null;
  stampTintedCanvas = null;
  stampLastPos = null;
}

// ---- Fill (paint bucket) ----
// Clicking anywhere fills the connected same-color region on the active layer — a
// background layer is one uniform color everywhere, so clicking it naturally fills
// the whole layer with no special-casing needed; clicking inside line art fills just
// the enclosed area, same as any standard paint-bucket tool.
function handleFillClick(e) {
  if (isMultiTouch(e)) return;
  const pos = relativePointer();
  if (!pos) return;
  floodFillAt(Math.floor(pos.x), Math.floor(pos.y));
}

const FILL_TOLERANCE_SQ = 40 * 40;

function floodFillAt(px, py) {
  const width = STAGE_WIDTH, height = STAGE_HEIGHT;
  if (px < 0 || py < 0 || px >= width || py >= height) return;
  const layer = activeLayer();

  // Konva renders a layer's toCanvas() output through each shape's live absolute
  // transform, which includes the STAGE's current pan/zoom (the canvas auto-fits the
  // container on load, so this is virtually never 1:1). Sampling with that transform
  // still active would crop a shrunken, offset view of the real content into a
  // full-size buffer — mostly blank canvas outside a small sub-rectangle — and the
  // flood fill would leak through that blank area. Sample at a neutral 1:1 transform
  // instead, then restore the real one; nothing repaints on screen in between since
  // we never yield to the browser before restoring it.
  const prevScale = { x: stage.scaleX(), y: stage.scaleY() };
  const prevPos = { x: stage.x(), y: stage.y() };
  stage.scale({ x: 1, y: 1 });
  stage.position({ x: 0, y: 0 });
  const srcCanvas = layer.konvaLayer.toCanvas({ x: 0, y: 0, width, height, pixelRatio: 1 });
  stage.scale(prevScale);
  stage.position(prevPos);
  const srcData = srcCanvas.getContext('2d').getImageData(0, 0, width, height).data;

  const startIdx = (py * width + px) * 4;
  const tr = srcData[startIdx], tg = srcData[startIdx + 1], tb = srcData[startIdx + 2], ta = srcData[startIdx + 3];

  const fillRgb = hexToRgb(brush.color) || { r: 0, g: 0, b: 0 };
  const fillAlpha = Math.round((brush.opacity ?? 1) * 255);

  const visited = new Uint8Array(width * height);
  const out = new ImageData(width, height);
  const outData = out.data;

  function matches(x, y) {
    const vIdx = y * width + x;
    if (visited[vIdx]) return false;
    const idx = vIdx * 4;
    const dr = srcData[idx] - tr, dg = srcData[idx + 1] - tg, db = srcData[idx + 2] - tb, da = srcData[idx + 3] - ta;
    return dr * dr + dg * dg + db * db + da * da <= FILL_TOLERANCE_SQ;
  }
  function setPixel(x, y) {
    const vIdx = y * width + x;
    visited[vIdx] = 1;
    const idx = vIdx * 4;
    outData[idx] = fillRgb.r;
    outData[idx + 1] = fillRgb.g;
    outData[idx + 2] = fillRgb.b;
    outData[idx + 3] = fillAlpha;
  }

  // Scanline stack-based flood fill — fills whole horizontal runs at once instead of
  // pushing every individual pixel, which matters at this resolution (2400x1600).
  const stack = [[px, py]];
  let filledAny = false;
  while (stack.length) {
    let [x, y] = stack.pop();
    while (x >= 0 && matches(x, y)) x--;
    x++;
    let spanAbove = false, spanBelow = false;
    while (x < width && matches(x, y)) {
      setPixel(x, y);
      filledAny = true;
      if (y > 0) {
        const above = matches(x, y - 1);
        if (above && !spanAbove) stack.push([x, y - 1]);
        spanAbove = above;
      }
      if (y < height - 1) {
        const below = matches(x, y + 1);
        if (below && !spanBelow) stack.push([x, y + 1]);
        spanBelow = below;
      }
      x++;
    }
  }
  if (!filledAny) return;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  outCanvas.getContext('2d').putImageData(out, 0, 0);
  const fillNode = new Konva.Image({ image: outCanvas, x: 0, y: 0, width, height, globalCompositeOperation: layer.blendMode });
  // stage.toJSON() (used for draft persistence) can't serialize a live canvas/Image
  // element — it silently drops it — so stash the pixels as a data URL too;
  // rebuildLayersFromStage reloads it into a real Image on restore.
  fillNode.setAttr('customImageSrc', outCanvas.toDataURL());
  layer.konvaLayer.add(fillNode);
  layer.konvaLayer.batchDraw();
  pushUndo({ type: 'add', layerIndex: activeLayerIndex, node: fillNode });
  scheduleDraftSave();
  refreshThumbsIfPanelOpen();
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
    if (activeTool === 'fill') { handleFillClick(e); return; }
    startStroke(e);
  });
  stage.on('pointermove', (e) => {
    if (activeTool === 'select' || activeTool === 'pan' || activeTool === 'fill') return;
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
  layers.forEach((l) => {
    l.konvaLayer.visible(l.visible);
    l.konvaLayer.opacity(l.opacity);
    l.konvaLayer.clip({ x: 0, y: 0, width: STAGE_WIDTH, height: STAGE_HEIGHT }); // re-apply for drafts saved before this was the default
    // Konva.Image nodes (paint-bucket fills, bitmap-tip strokes) carry their real pixels
    // in a customImageSrc data URL because stage.toJSON() can't serialize a canvas/Image
    // element — restore each one into a real Image now that the node tree exists.
    l.konvaLayer.find((n) => n.getAttr && n.getAttr('customImageSrc')).forEach((node) => {
      const img = new Image();
      img.onload = () => { node.image(img); l.konvaLayer.batchDraw(); };
      img.src = node.getAttr('customImageSrc');
    });
  });
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
  bgLayer.clip({ x: 0, y: 0, width: STAGE_WIDTH, height: STAGE_HEIGHT });
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
