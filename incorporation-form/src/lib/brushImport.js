// Brush pack import — ported from ULTform's js/canvas.js (parseJsonBrushPack /
// parseAbrBrushPack / parseBrushsetPack / listZipEntryNames). .abr and .brushset are
// proprietary formats without a public spec; like the original, this recovers only what's
// realistically extractable (brush names, and for .abr a rough size) and imports each as a
// generic brush using that name — texture/dynamics are not preserved for those two formats.

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

function genId() {
  return (crypto.randomUUID ? crypto.randomUUID() : `brush-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

function parseJsonBrushPack(json, fileName) {
  const packName = (typeof json.name === 'string' && json.name.trim()) || fileName;
  const list = Array.isArray(json.brushes) ? json.brushes : [];
  return list.map((b, i) => ({
    id: genId(),
    name: (typeof b.name === 'string' && b.name.trim()) || `Brush ${i + 1}`,
    size: clampNum(b.size, 1, 200, 12),
    opacity: clampNum(b.opacity, 0.05, 1, 0.9),
    thinning: clampNum(b.thinning, -1, 1, 0.5),
    smoothing: clampNum(b.smoothing, 0, 1, 0.5),
    streamline: clampNum(b.streamline, 0, 1, 0.5),
    taperStart: clampNum(b.taperStart, 0, 200, 0),
    taperEnd: clampNum(b.taperEnd, 0, 200, clampNum(b.size, 1, 200, 12) * 1.5),
    packName,
    sourceFormat: 'json'
  }));
}

// Scans raw bytes for runs of UTF-16BE printable characters — how Adobe's .abr format
// stores brush names — without attempting to decode the surrounding binary structure.
function scanUtf16BeStrings(bytes, minLen = 3, maxResults = 60) {
  const found = [];
  let current = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = (bytes[i] << 8) | bytes[i + 1];
    const isPrintable = code >= 32 && code < 0xd800 && code !== 0x7f;
    if (isPrintable) {
      current += String.fromCharCode(code);
    } else {
      if (current.length >= minLen && /[A-Za-z]/.test(current)) found.push(current.trim());
      current = '';
      if (found.length >= maxResults) break;
    }
  }
  return [...new Set(found)];
}

function parseAbrBrushPack(bytes, fileName) {
  const names = scanUtf16BeStrings(bytes).filter((n) => n.length <= 40);
  const packName = fileName.replace(/\.abr$/i, '');
  const picked = names.length ? names.slice(0, 24) : [packName];
  return picked.map((name) => ({
    id: genId(),
    name,
    size: 16,
    opacity: 0.85,
    thinning: 0.4,
    smoothing: 0.5,
    streamline: 0.5,
    taperStart: 0,
    taperEnd: 24,
    packName,
    sourceFormat: 'abr-partial'
  }));
}

// .brushset is a renamed zip; Procreate stores each brush as a "<Name>.brush/" folder
// entry. Reading the zip's central directory for entry names needs no decompression.
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
    id: genId(),
    name,
    size: 16,
    opacity: 0.85,
    thinning: 0.4,
    smoothing: 0.5,
    streamline: 0.5,
    taperStart: 0,
    taperEnd: 24,
    packName,
    sourceFormat: 'brushset-partial'
  }));
}

export async function importBrushPackFile(file) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.json')) {
    const json = JSON.parse(await file.text());
    return parseJsonBrushPack(json, file.name.replace(/\.json$/i, ''));
  }
  if (lower.endsWith('.abr')) {
    return parseAbrBrushPack(new Uint8Array(await file.arrayBuffer()), file.name);
  }
  if (lower.endsWith('.brushset')) {
    return parseBrushsetPack(new Uint8Array(await file.arrayBuffer()), file.name);
  }
  throw new Error('Unsupported file — use .json, .abr, or .brushset');
}
