import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSettings } from '../../context/SettingsContext.jsx';
import { strokeToOutline, drawOutlineToContext } from '../../lib/brushEngine.js';
import BrushPicker from './BrushPicker.jsx';

const INK_COLOR = '#16233f';

export default function SignatureModal({ open, onClose, onSave }) {
  const { allBrushPresets, selectedBrush, setSelectedBrushId, importBrushPack } = useSettings();
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const ctxRef = useRef(null);
  const strokesRef = useRef([]); // committed strokes: [{ points }]
  const currentPointsRef = useRef([]);
  const drawingRef = useRef(false);
  const [isEmpty, setIsEmpty] = useState(true);

  const redraw = useCallback(() => {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    for (const stroke of strokesRef.current) {
      const outline = strokeToOutline(stroke.points, stroke.preset);
      drawOutlineToContext(ctx, outline, INK_COLOR, stroke.preset.opacity);
    }
    if (currentPointsRef.current.length > 0) {
      const outline = strokeToOutline(currentPointsRef.current, selectedBrush);
      drawOutlineToContext(ctx, outline, INK_COLOR, selectedBrush.opacity);
    }
  }, [selectedBrush]);

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctxRef.current = ctx;
    redraw();
  }, [redraw]);

  useEffect(() => {
    if (!open) return;
    strokesRef.current = [];
    currentPointsRef.current = [];
    setIsEmpty(true);
    const t = setTimeout(setupCanvas, 0); // wait for modal layout
    window.addEventListener('resize', setupCanvas);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', setupCanvas);
    };
  }, [open, setupCanvas]);

  if (!open) return null;

  const pointFromEvent = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5
    };
  };

  const handlePointerDown = (e) => {
    e.preventDefault();
    canvasRef.current.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    currentPointsRef.current = [pointFromEvent(e)];
    redraw();
  };

  const handlePointerMove = (e) => {
    if (!drawingRef.current) return;
    currentPointsRef.current.push(pointFromEvent(e));
    redraw();
  };

  const handlePointerUp = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (currentPointsRef.current.length > 1) {
      strokesRef.current.push({ points: currentPointsRef.current, preset: selectedBrush });
      setIsEmpty(false);
    }
    currentPointsRef.current = [];
    redraw();
  };

  const handleClear = () => {
    strokesRef.current = [];
    currentPointsRef.current = [];
    setIsEmpty(true);
    redraw();
  };

  const handleSave = () => {
    if (isEmpty) return;
    const canvas = canvasRef.current;
    onSave(canvas.toDataURL('image/png'));
  };

  return (
    <div className="if-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="if-modal">
        <div className="if-modal-header">
          <h2>Add your signature</h2>
          <button className="if-modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <div className="if-modal-body">
          <div className="if-sig-hint">Sign here</div>
          <div className="if-sig-canvas-wrap" ref={wrapRef}>
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />
          </div>
          <BrushPicker
            presets={allBrushPresets}
            selectedId={selectedBrush.id}
            onSelect={setSelectedBrushId}
            onImport={importBrushPack}
          />
        </div>
        <div className="if-modal-footer">
          <button className="if-btn if-btn-ghost" onClick={handleClear}>
            Clear
          </button>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="if-btn if-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="if-btn if-btn-primary" onClick={handleSave} disabled={isEmpty}>
              Save signature
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
