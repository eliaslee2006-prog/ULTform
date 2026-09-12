function ripple(e, el) {
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const r = document.createElement('span');
  r.className = 'ripple';
  r.style.width = r.style.height = size + 'px';
  r.style.left = (e.clientX - rect.left - size / 2) + 'px';
  r.style.top = (e.clientY - rect.top - size / 2) + 'px';
  el.style.position = el.style.position || 'relative';
  el.style.overflow = 'hidden';
  el.appendChild(r);
  setTimeout(() => r.remove(), 500);
}

export function wireRipples(root = document) {
  root.querySelectorAll('.rail-item, .hud-btn, .hud-complete, .btn, .field--signature, .theme-swatch, .gallery-thumb, .icon-btn, .file-action').forEach((el) => {
    if (el.dataset.rippleWired) return;
    el.dataset.rippleWired = '1';
    el.addEventListener('click', (e) => ripple(e, el));
  });
}
