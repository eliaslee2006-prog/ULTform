// Stroke rendering for the signature module — ported from ULTform's js/canvas.js brush
// engine (same perfect-freehand technique + preset shape) so signatures render with the
// same quality of ink as the rest of the app, but tuned for a tapered "calligraphy nib"
// look by default instead of a flat uniform-width line.

import getStroke from 'perfect-freehand';

// Presets share the { size, opacity, thinning, smoothing, streamline } shape used by
// ULTform's canvas.js BUILTIN_PRESETS, plus optional start/end taper (perfect-freehand
// options not used by canvas.js's presets, added here for a true pointed nib effect).
export const BUILTIN_BRUSH_PRESETS = [
  {
    id: 'builtin-calligraphy',
    name: 'Calligraphy',
    size: 7,
    opacity: 1,
    thinning: 0.85,
    smoothing: 0.55,
    streamline: 0.55,
    taperStart: 10,
    taperEnd: 28
  },
  { id: 'builtin-fine', name: 'Fine Liner', size: 4, opacity: 1, thinning: 0.5, smoothing: 0.5, streamline: 0.5, taperStart: 0, taperEnd: 6 },
  { id: 'builtin-soft', name: 'Soft Brush', size: 20, opacity: 0.65, thinning: 0.7, smoothing: 0.6, streamline: 0.4, taperStart: 0, taperEnd: 10 },
  { id: 'builtin-marker', name: 'Marker', size: 12, opacity: 0.9, thinning: 0.1, smoothing: 0.3, streamline: 0.6, taperStart: 0, taperEnd: 4 },
  { id: 'builtin-pencil', name: 'Pencil', size: 3, opacity: 0.9, thinning: 0.8, smoothing: 0.4, streamline: 0.5, taperStart: 0, taperEnd: 4 }
];

export const DEFAULT_BRUSH_ID = 'builtin-calligraphy';

export function findPreset(presets, id) {
  return presets.find((p) => p.id === id) || presets[0];
}

// points: [{ x, y, pressure }]  ->  outline polygon points for filling
export function strokeToOutline(points, preset) {
  if (points.length === 0) return [];
  const input = points.map((p) => [p.x, p.y, p.pressure ?? 0.5]);
  const hasRealPressure = points.some((p) => p.pressure !== undefined && p.pressure !== 0.5);

  const stroke = getStroke(input, {
    size: preset.size,
    thinning: preset.thinning,
    smoothing: preset.smoothing,
    streamline: preset.streamline,
    simulatePressure: !hasRealPressure,
    start: { taper: preset.taperStart ?? 0, cap: (preset.taperStart ?? 0) === 0 },
    end: { taper: preset.taperEnd ?? 0, cap: (preset.taperEnd ?? 0) === 0 }
  });

  return stroke.map(([x, y]) => ({ x, y }));
}

export function drawOutlineToContext(ctx, outline, color, opacity) {
  if (outline.length < 2) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(outline[0].x, outline[0].y);
  for (let i = 1; i < outline.length; i++) {
    ctx.lineTo(outline[i].x, outline[i].y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
