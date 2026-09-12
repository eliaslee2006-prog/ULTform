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
const brush = { size: 8, opacity: 1, color: '#1B1D23', thinning: 0.6, smoothing: 0.5, streamline: 0.5 };

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
  document.getElementById('canvasBrushSize').value = preset.size;
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
    const dotSize = Math.max(6, Math.min(24, preset.size));
    dot.style.width = dotSize + 'px';
    dot.style.height = dotSize + 'px';
    dot.style.background = 'currentColor';
    dot.style.opacity = String(preset.opacity);
    swatch.appendChild(dot);
    swatch.addEventListener('click', () => {
      wrap.querySelectorAll('.brush-preset-swatch').forEach((s) => s.classList.remove('selected'));
      swatch.classList.add('selected');
      applyPreset(preset);
    });
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

  currentShape = new Konva.Line({
    points: outlinePoints(strokePoints, brush.size),
    fill,
    closed: true,
    opacity: activeTool === 'smudge' ? brush.opacity * 0.7 : brush.opacity,
    globalCompositeOperation: compositeOp,
    listening: activeTool !== 'eraser'
  });
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
  document.getElementById('canvasColor').addEventListener('input', (e) => { brush.color = e.target.value; });
  document.getElementById('canvasBrushSize').addEventListener('input', (e) => { brush.size = parseInt(e.target.value, 10); });
  document.getElementById('btnCanvasUndo').addEventListener('click', undo);
  document.getElementById('btnCanvasRedo').addEventListener('click', redo);
  document.getElementById('btnCanvasSave').addEventListener('click', saveCanvas);
  document.getElementById('btnCanvasLayers').addEventListener('click', () => {
    const panel = document.getElementById('canvasLayersPanel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) renderLayerList();
  });
  document.getElementById('btnAddLayer').addEventListener('click', () => addLayer());
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
    await renderPresets();
    renderLayerList();
    window.addEventListener('resize', () => fitStageToContainer(containerEl));
    initialized = true;
  } else {
    fitStageToContainer(containerEl);
  }
}
