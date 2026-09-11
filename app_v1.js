// --- 1. Tab & Theme Navigation System ---
const tabs = document.querySelectorAll('.hud-btn');
const contents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    contents.forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});

document.getElementById('darkThemeToggle').addEventListener('change', (e) => {
  document.body.classList.toggle('dark-mode', e.target.checked);
});

// --- 2. State & Core Engine Variables ---
let currentPdf = null;
let pdfRawBytes = null;
let pageNum = 1;
let totalPages = 0;
const pageOverlays = {}; // Cache: { [pageNumber]: Array<OverlayObject> }

const canvas = document.getElementById('pdf-background');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('interactive-overlay');
const pageIndicator = document.getElementById('pageIndicator');

// --- 3. PDF.js Render Pipeline ---
document.getElementById('pdfUploader').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const fileReader = new FileReader();
  fileReader.onload = async function() {
    pdfRawBytes = new Uint8Array(this.result);
    currentPdf = await pdfjsLib.getDocument({ data: pdfRawBytes }).promise;
    totalPages = currentPdf.numPages;
    pageNum = 1;

    for (let pageKey in pageOverlays) delete pageOverlays[pageKey];
    await renderPage(pageNum);
  };
  fileReader.readAsArrayBuffer(file);
});

async function renderPage(num) {
  if (!currentPdf) return;

  const page = await currentPdf.getPage(num);
  pageIndicator.innerText = `Page ${num} of ${totalPages}`;

  const viewportElement = document.getElementById('a4-container');
  const unscaledViewport = page.getViewport({ scale: 1 });
  const scale = viewportElement.clientWidth / unscaledViewport.width;
  const viewport = page.getViewport({ scale });

  canvas.width = viewport.width * window.devicePixelRatio;
  canvas.height = viewport.height * window.devicePixelRatio;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const renderContext = {
    canvasContext: ctx,
    viewport: viewport,
    transform: [window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0]
  };

  await page.render(renderContext).promise;
  restorePageOverlay(num);
}

// --- 4. Page Overlay Preservation & Drag System ---
function saveCurrentPageOverlay() {
  if (!pageNum) return;
  const wrappers = overlay.querySelectorAll('.overlay-wrapper');
  const items = [];

  wrappers.forEach(wrap => {
    const type = wrap.dataset.type;
    const left = wrap.style.left;
    const top = wrap.style.top;

    if (type === 'text') {
      const input = wrap.querySelector('input');
      items.push({ type: 'text', left, top, value: input.value });
    } else if (type === 'signature') {
      const img = wrap.querySelector('img');
      items.push({ type: 'signature', left, top, dataUrl: img.src });
    }
  });

  pageOverlays[pageNum] = items;
}

function restorePageOverlay(targetPage) {
  overlay.innerHTML = '';
  const items = pageOverlays[targetPage] || [];
  items.forEach(item => {
    if (item.type === 'text') {
      createDraggableText(item.left, item.top, item.value);
    } else if (item.type === 'signature') {
      createDraggableSignature(item.dataUrl, item.left, item.top);
    }
  });
}

function makeDraggable(element) {
  let posX = 0, posY = 0, initialX = 0, initialY = 0;

  element.addEventListener('touchstart', dragStart, { passive: false });
  element.addEventListener('mousedown', dragStart);

  function dragStart(e) {
    if (e.target.tagName === 'INPUT') return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    initialX = clientX;
    initialY = clientY;

    document.addEventListener('touchmove', dragMove, { passive: false });
    document.addEventListener('touchend', dragEnd);
    document.addEventListener('mousemove', dragMove);
    document.addEventListener('mouseup', dragEnd);
  }

  function dragMove(e) {
    e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    posX = initialX - clientX;
    posY = initialY - clientY;
    initialX = clientX;
    initialY = clientY;

    const containerRatio = overlay.getBoundingClientRect();
    let newTopPercent = ((element.offsetTop - posY) / containerRatio.height) * 100;
    let newLeftPercent = ((element.offsetLeft - posX) / containerRatio.width) * 100;

    element.style.top = `${Math.max(0, Math.min(newTopPercent, 90))}%`;
    element.style.left = `${Math.max(0, Math.min(newLeftPercent, 90))}%`;
  }

  function dragEnd() {
    document.removeEventListener('touchmove', dragMove);
    document.removeEventListener('touchend', dragEnd);
    document.removeEventListener('mousemove', dragMove);
    document.removeEventListener('mouseup', dragEnd);
  }
}

function createDraggableText(left = '10%', top = '10%', value = '') {
  const wrapper = document.createElement('div');
  wrapper.className = 'overlay-wrapper';
  wrapper.dataset.type = 'text';
  wrapper.style.left = left;
  wrapper.style.top = top;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'overlay-element';
  input.placeholder = 'Tap to edit...';
  input.value = value;

  wrapper.appendChild(input);
  overlay.appendChild(wrapper);
  makeDraggable(wrapper);
}

function createDraggableSignature(dataUrl, left = '20%', top = '20%') {
  const wrapper = document.createElement('div');
  wrapper.className = 'overlay-wrapper';
  wrapper.dataset.type = 'signature';
  wrapper.style.left = left;
  wrapper.style.top = top;

  const img = document.createElement('img');
  img.src = dataUrl;
  img.className = 'overlay-signature-img';

  wrapper.appendChild(img);
  overlay.appendChild(wrapper);
  makeDraggable(wrapper);
}

document.getElementById('addTextBtn').addEventListener('click', () => createDraggableText());

// --- 5. Pagination Handlers ---
document.getElementById('prevPage').addEventListener('click', async () => {
  if (pageNum <= 1) return;
  saveCurrentPageOverlay();
  pageNum--;
  await renderPage(pageNum);
});

document.getElementById('nextPage').addEventListener('click', async () => {
  if (pageNum >= totalPages) return;
  saveCurrentPageOverlay();
  pageNum++;
  await renderPage(pageNum);
});

// --- 6. Signature Modal Module ---
const sigModal = document.getElementById('signatureModal');
const sigCanvas = document.getElementById('modalSigCanvas');
const sigCtx = sigCanvas.getContext('2d');
let isDrawing = false;

document.getElementById('addSigBtn').addEventListener('click', () => {
  sigModal.classList.add('active');
  sigCanvas.width = sigCanvas.offsetWidth;
  sigCanvas.height = sigCanvas.offsetHeight;
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
});

const getPos = (e) => {
  const rect = sigCanvas.getBoundingClientRect();
  return {
    x: (e.touches ? e.touches[0].clientX : e.clientX) - rect.left,
    y: (e.touches ? e.touches[0].clientY : e.clientY) - rect.top
  };
};

const startDraw = (e) => { isDrawing = true; const pos = getPos(e); sigCtx.beginPath(); sigCtx.moveTo(pos.x, pos.y); };
const moveDraw = (e) => { if (!isDrawing) return; e.preventDefault(); const pos = getPos(e); sigCtx.lineTo(pos.x, pos.y); sigCtx.stroke(); };
const stopDraw = () => { isDrawing = false; };

sigCanvas.addEventListener('mousedown', startDraw);
sigCanvas.addEventListener('mousemove', moveDraw);
sigCanvas.addEventListener('mouseup', stopDraw);
sigCanvas.addEventListener('touchstart', startDraw, { passive: false });
sigCanvas.addEventListener('touchmove', moveDraw, { passive: false });
sigCanvas.addEventListener('touchend', stopDraw);

document.getElementById('clearModalSigBtn').addEventListener('click', () => sigCtx.clearRect(0,0,sigCanvas.width, sigCanvas.height));
document.getElementById('closeModalSigBtn').addEventListener('click', () => sigModal.classList.remove('active'));

document.getElementById('saveModalSigBtn').addEventListener('click', () => {
  const dataUrl = sigCanvas.toDataURL('image/png');
  createDraggableSignature(dataUrl);
  sigModal.classList.remove('active');
});

// --- 7. In-Memory pdf-lib Document Flattening Engine ---
async function generateFlattenedPdf() {
  saveCurrentPageOverlay();
  if (!pdfRawBytes) throw new Error("No base PDF template loaded.");

  const pdfDoc = await PDFLib.PDFDocument.load(pdfRawBytes);
  const pages = pdfDoc.getPages();

  for (let i = 0; i < pages.length; i++) {
    const pageIndex = i + 1;
    const page = pages[i];
    const { width, height } = page.getSize();
    const items = pageOverlays[pageIndex] || [];

    for (const item of items) {
      const xRatio = parseFloat(item.left) / 100;
      const yRatio = parseFloat(item.top) / 100;
      const targetX = width * xRatio;
      const targetY = height - (height * yRatio) - 20; // PDF coordinate system origin is bottom-left

      if (item.type === 'text' && item.value) {
        page.drawText(item.value, {
          x: targetX,
          y: targetY,
          size: 14,
          color: PDFLib.rgb(0, 0, 0)
        });
      } else if (item.type === 'signature' && item.dataUrl) {
        const base64Png = item.dataUrl.split(',')[1];
        const pngBytes = Uint8Array.from(atob(base64Png), c => c.charCodeAt(0));
        const pngImage = await pdfDoc.embedPng(pngBytes);
        page.drawImage(pngImage, {
          x: targetX,
          y: targetY - 40,
          width: 150,
          height: 50
        });
      }
    }
  }

  return await pdfDoc.save();
}

// --- 8. Export & Native Web Share Engine ---
document.getElementById('exportBtn').addEventListener('click', async () => {
  const format = document.getElementById('exportFormat').value;
  const btn = document.getElementById('exportBtn');
  btn.innerText = 'Building...';

  try {
    if (format === 'pdf') {
      const pdfBytes = await generateFlattenedPdf();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const file = new File([blob], `Document_${Date.now()}.pdf`, { type: 'application/pdf' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ title: 'Signed Intake Document', files: [file] });
      } else {
        downloadBlob(blob, file.name);
      }
    } else if (format === 'txt') {
      saveCurrentPageOverlay();
      const txtContent = JSON.stringify(pageOverlays, null, 2);
      const blob = new Blob([txtContent], { type: 'text/plain' });
      downloadBlob(blob, `Summary_${Date.now()}.txt`);
    } else if (format === 'png') {
      const dataUrl = canvas.toDataURL('image/png');
      const blob = await (await fetch(dataUrl)).blob();
      downloadBlob(blob, `Document_Page_${pageNum}.png`);
    } else if (format === 'json') {
      saveCurrentPageOverlay();
      const blob = new Blob([JSON.stringify(pageOverlays)], { type: 'application/json' });
      downloadBlob(blob, `State_${Date.now()}.json`);
    }
    btn.innerText = 'Exported';
  } catch (err) {
    alert(`Export Error: ${err.message}`);
    btn.innerText = 'Export / Share';
  }
  setTimeout(() => btn.innerText = 'Export / Share', 3000);
});

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// --- 9. Cloudflare Worker SharePoint Dual-Sync ---
document.getElementById('syncBtn').addEventListener('click', async () => {
  const syncBtn = document.getElementById('syncBtn');
  const endpoint = document.getElementById('apiEndpointInput').value;
  syncBtn.innerText = 'Syncing...';

  try {
    const pdfBytes = await generateFlattenedPdf();
    const response = await fetch(`${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        'X-File-Name': `Intake_Signed_${Date.now()}.pdf`
      },
      body: pdfBytes
    });

    const result = await response.json();
    if (result.success) {
      syncBtn.innerText = 'Synced to SharePoint!';
    } else {
      throw new Error(result.error);
    }
  } catch (err) {
    alert(`SharePoint Sync Error: ${err.message}`);
    syncBtn.innerText = 'Sync Failed';
  }
  setTimeout(() => syncBtn.innerText = 'Sync SharePoint', 3000);
});
