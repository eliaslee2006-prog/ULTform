const canvas = document.getElementById('signaturePad');
const ctx = canvas.getContext('2d');
const clearBtn = document.getElementById('clearBtn');
const intakeForm = document.getElementById('intakeForm');
const submitBtn = document.getElementById('submitBtn');
const toast = document.getElementById('toast');

let isDrawing = false;
let hasSigned = false;

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  ctx.scale(ratio, ratio);
  
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#000000';
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function getTouchPos(e) {
  const rect = canvas.getBoundingClientRect();
  const touch = e.touches ? e.touches[0] : e;
  return {
    x: touch.clientX - rect.left,
    y: touch.clientY - rect.top
  };
}

function startDrawing(e) {
  e.preventDefault();
  isDrawing = true;
  hasSigned = true;
  const pos = getTouchPos(e);
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
}

function draw(e) {
  if (!isDrawing) return;
  e.preventDefault();
  const pos = getTouchPos(e);
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
}

function stopDrawing() {
  isDrawing = false;
}

canvas.addEventListener('touchstart', startDrawing, { passive: false });
canvas.addEventListener('touchmove', draw, { passive: false });
canvas.addEventListener('touchend', stopDrawing);
canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);

clearBtn.addEventListener('click', () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  hasSigned = false;
});

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

intakeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  if (!hasSigned) {
    showToast('Please provide a signature.');
    return;
  }

  const fullName = document.getElementById('fullName').value.trim();
  const email = document.getElementById('email').value.trim();
  const signatureDataUrl = canvas.toDataURL('image/png');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Uploading...';

  try {
    const response = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, email, signatureDataUrl })
    });

    const result = await response.json();

    if (response.ok && result.success) {
      showToast('Document securely uploaded!');
      intakeForm.reset();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasSigned = false;
    } else {
      throw new Error(result.error || 'Submission failed');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit & Upload';
  }
});
