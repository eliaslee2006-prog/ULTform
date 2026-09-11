let pdfDocBytes = null;
let signaturePad = null;
let activeElement = null;

// Toast Notification Manager
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerText = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Initialize Vector Signature Engine
document.addEventListener('DOMContentLoaded', () => {
  const sigCanvas = document.getElementById('modalSigCanvas');
  
  function resizeSigCanvas() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    sigCanvas.width = sigCanvas.offsetWidth * ratio;
    sigCanvas.height = sigCanvas.offsetHeight * ratio;
    sigCanvas.getContext('2d').scale(ratio, ratio);
    if (signaturePad) signaturePad.clear();
  }

  window.addEventListener('resize', resizeSigCanvas);

  signaturePad = new SignaturePad(sigCanvas, {
    minWidth: 1.2,
    maxWidth: 3.5,
    penColor: 'rgb(0, 0, 0)',
    backgroundColor: 'rgba(255, 255, 255, 0)' // Fully transparent background
  });

  document.getElementById('openSigBtn').addEventListener('click', () => {
    document.getElementById('sigModal').classList.add('active');
    resizeSigCanvas();
  });

  document.getElementById('clearSigBtn').addEventListener('click', () => signaturePad.clear());
  document.getElementById('cancelSigBtn').addEventListener('click', () => {
    document.getElementById('sigModal').classList.remove('active');
  });

  document.getElementById('saveSigBtn').addEventListener('click', () => {
    if (signaturePad.isEmpty()) {
      showToast('Please provide a signature first', 'error');
      return;
    }
    const dataUrl = signaturePad.toDataURL('image/png'); // Transparent PNG
    createOverlayElement('signature', dataUrl);
    document.getElementById('sigModal').classList.remove('active');
    showToast('Signature added', 'success');
  });
});

// Interactive Element Creation & Deletion
function createOverlayElement(type, content = '') {
  const overlay = document.getElementById('interactiveOverlay');
  const wrapper = document.createElement('div');
  wrapper.className = 'overlay-element active';
  wrapper.style.left = '50px';
  wrapper.style.top = '50px';

  // Delete Button
  const delBtn = document.createElement('button');
  delBtn.className = 'delete-btn';
  delBtn.innerText = '×';
  delBtn.onclick = (e) => {
    e.stopPropagation();
    wrapper.remove();
    showToast('Element removed', 'info');
  };
  wrapper.appendChild(delBtn);

  if (type === 'text') {
    wrapper.style.width = '180px';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Tap to type...';
    wrapper.appendChild(input);
  } else if (type === 'signature') {
    wrapper.style.width = '160px';
    wrapper.style.height = '80px';
    const img = document.createElement('img');
    img.src = content;
    wrapper.appendChild(img);
  }

  // Touch & Drag Handling
  let isDragging = false, startX, startY, initialLeft, initialTop;

  const startDrag = (e) => {
    isDragging = true;
    const touch = e.touches ? e.touches[0] : e;
    startX = touch.clientX;
    startY = touch.clientY;
    initialLeft = wrapper.offsetLeft;
    initialTop = wrapper.offsetTop;
    selectElement(wrapper);
  };

  const doDrag = (e) => {
    if (!isDragging) return;
    const touch = e.touches ? e.touches[0] : e;
    wrapper.style.left = `${initialLeft + (touch.clientX - startX)}px`;
    wrapper.style.top = `${initialTop + (touch.clientY - startY)}px`;
  };

  const stopDrag = () => { isDragging = false; };

  wrapper.addEventListener('mousedown', startDrag);
  wrapper.addEventListener('touchstart', startDrag, { passive: true });
  window.addEventListener('mousemove', doDrag);
  window.addEventListener('touchmove', doDrag, { passive: true });
  window.addEventListener('mouseup', stopDrag);
  window.addEventListener('touchend', stopDrag);

  overlay.appendChild(wrapper);
  selectElement(wrapper);
}

function selectElement(el) {
  document.querySelectorAll('.overlay-element').forEach(item => item.classList.remove('active'));
  if (el) el.classList.add('active');
  activeElement = el;
}

document.getElementById('addTextBtn').addEventListener('click', () => createOverlayElement('text'));

// Dynamic Screen Orientation Recalibration
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    const container = document.getElementById('a4Container');
    if (container) {
      container.style.height = `${window.innerHeight - 140}px`;
      showToast('Layout adjusted to orientation', 'info');
    }
  }, 200);
});
