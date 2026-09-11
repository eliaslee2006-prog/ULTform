export function addField(container, type, xPct = 0.4, yPct = 0.4, pageIndex = 0) {
  const el = document.createElement('div');
  el.className = `field field--${type}`;
  el.dataset.type = type;
  el.dataset.xPct = xPct;
  el.dataset.yPct = yPct;
  el.dataset.pageIndex = pageIndex;
  el.style.left = `${xPct * 100}%`;
  el.style.top = `${yPct * 100}%`;

  if (type === 'text') {
    el.contentEditable = 'true';
    el.textContent = 'Text';
  } else if (type === 'checkbox') {
    el.textContent = '\u2610';
    el.addEventListener('click', (e) => {
      if (e.target === el) {
        const checked = el.dataset.checked === 'true';
        el.dataset.checked = String(!checked);
        el.textContent = !checked ? '\u2611' : '\u2610';
      }
    });
  } else if (type === 'date') {
    el.contentEditable = 'true';
    el.textContent = new Date().toLocaleDateString();
  }

  attachDragHandlers(el, container);
  attachDeleteHandle(el);
  container.appendChild(el);
  return el;
}

export function addSignatureField(container, pngDataUrl, xPct = 0.3, yPct = 0.7, widthPct = 0.3, heightPct = 0.08, pageIndex = 0) {
  const el = document.createElement('div');
  el.className = 'field field--signature';
  el.dataset.type = 'signature';
  el.dataset.xPct = xPct;
  el.dataset.yPct = yPct;
  el.dataset.pageIndex = pageIndex;
  el.dataset.widthPct = widthPct;
  el.dataset.heightPct = heightPct;
  el.style.left = `${xPct * 100}%`;
  el.style.top = `${yPct * 100}%`;
  el.style.width = `${widthPct * 100}%`;
  el.style.height = `${heightPct * 100}%`;
  el.style.backgroundImage = `url(${pngDataUrl})`;
  el.style.backgroundSize = 'contain';
  el.style.backgroundRepeat = 'no-repeat';
  el.dataset.pngDataUrl = pngDataUrl;

  attachDragHandlers(el, container);
  attachDeleteHandle(el);
  container.appendChild(el);
  return el;
}

function attachDragHandlers(el, container) {
  let dragging = false;

  el.addEventListener('pointerdown', (e) => {
    if (el.isContentEditable) return; // allow text editing focus without triggering drag
    dragging = true;
    el.setPointerCapture(e.pointerId);
  });

  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const rect = container.getBoundingClientRect();
    let xPct = (e.clientX - rect.left) / rect.width;
    let yPct = (e.clientY - rect.top) / rect.height;
    xPct = Math.min(Math.max(xPct, 0), 1);
    yPct = Math.min(Math.max(yPct, 0), 1);
    el.dataset.xPct = xPct;
    el.dataset.yPct = yPct;
    el.style.left = `${xPct * 100}%`;
    el.style.top = `${yPct * 100}%`;
  });

  el.addEventListener('pointerup', () => { dragging = false; });
  el.addEventListener('pointercancel', () => { dragging = false; });
}

function attachDeleteHandle(el) {
  el.addEventListener('dblclick', () => el.remove());
}

export function serializeFields(container) {
  const fields = [];
  container.querySelectorAll('.field').forEach((el) => {
    const type = el.dataset.type;
    const base = {
      type,
      pageIndex: parseInt(el.dataset.pageIndex || '0', 10),
      xPct: parseFloat(el.dataset.xPct),
      yPct: parseFloat(el.dataset.yPct)
    };
    if (type === 'text' || type === 'date') {
      base.value = el.textContent.trim();
    } else if (type === 'checkbox') {
      base.checked = el.dataset.checked === 'true';
    } else if (type === 'signature') {
      base.widthPct = parseFloat(el.dataset.widthPct);
      base.heightPct = parseFloat(el.dataset.heightPct);
      base.pngDataUrl = el.dataset.pngDataUrl;
    }
    fields.push(base);
  });
  return fields;
}
