let pad = null;

export function initSignaturePad(canvasEl) {
  resizeCanvasForDPR(canvasEl);

  pad = new SignaturePad(canvasEl, {
    backgroundColor: 'rgba(0,0,0,0)',
    penColor: 'rgb(20,20,20)',
    velocityFilterWeight: 0.7,
    minWidth: 1.2,
    maxWidth: 3.0
  });

  return pad;
}

export function resizeCanvasForDPR(canvasEl) {
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const rect = canvasEl.getBoundingClientRect();
  canvasEl.width = rect.width * ratio;
  canvasEl.height = rect.height * ratio;
  const ctx = canvasEl.getContext('2d');
  ctx.scale(ratio, ratio);
  if (pad) pad.clear(); // canvas resize wipes strokes on iOS; clearing keeps state consistent
}

export function clearSignature() {
  if (pad) pad.clear();
}

export function exportSignaturePNG() {
  if (!pad || pad.isEmpty()) {
    throw new Error('Signature required before continuing');
  }
  return pad.toDataURL('image/png');
}

export function isSignatureEmpty() {
  return !pad || pad.isEmpty();
}
