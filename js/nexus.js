import { PDFDocument, StandardFonts, rgb } from 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';
import { getAll, put, get } from './db.js';
import { wireRipples } from './ripple.js';
import { WORKER_BASE_URL } from './worker-config.js';

let mediaRecorder = null;
let audioChunks = [];
let sessionState = null;
let activeSessionRecord = null;

function setRecordingIndicator(active) {
  document.getElementById('nexusRecBanner').classList.toggle('hidden', !active);
}

async function populateLinkedFileSelect() {
  const select = document.getElementById('nexusLinkedFile');
  const current = select.value;
  const files = await getAll('Files');
  select.innerHTML = '<option value="">No linked file</option>';
  files.sort((a, b) => b.createdAt - a.createdAt).forEach((f) => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.fileName;
    select.appendChild(opt);
  });
  if (current) select.value = current;
}

function appendTranscript(text) {
  const el = document.getElementById('nexusTranscript');
  const placeholder = el.querySelector('.nexus-placeholder');
  if (placeholder) placeholder.remove();
  const p = document.createElement('p');
  p.textContent = text;
  el.appendChild(p);
  el.scrollTop = el.scrollHeight;
}

async function transcribeChunk(blob) {
  const form = new FormData();
  form.append('audio', blob, 'chunk.webm');
  try {
    const resp = await fetch(`${WORKER_BASE_URL}/nexus/transcribe`, { method: 'POST', body: form });
    const data = await resp.json();
    if (data.success && data.text && data.text.trim()) {
      sessionState.transcriptParts.push(data.text.trim());
      appendTranscript(data.text.trim());
    }
  } catch (err) {
    console.error('Transcription chunk failed', err);
  }
}

async function startSession() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    alert('Microphone access is required to start a NEXUS session.');
    return;
  }

  sessionState = {
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    transcriptParts: [],
    linkedFileId: document.getElementById('nexusLinkedFile').value || null
  };
  audioChunks = [];

  const mimeType = (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
    ? 'audio/webm;codecs=opus' : '';
  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  mediaRecorder.addEventListener('dataavailable', (e) => {
    if (e.data && e.data.size > 0) {
      audioChunks.push(e.data);
      transcribeChunk(e.data);
    }
  });
  mediaRecorder.addEventListener('stop', () => stream.getTracks().forEach((t) => t.stop()));
  mediaRecorder.start(10000);

  document.getElementById('nexusTranscript').innerHTML = '';
  document.getElementById('nexusSummary').classList.add('hidden');
  document.getElementById('nexusExportRow').classList.add('hidden');
  document.getElementById('btnNexusStart').classList.add('hidden');
  document.getElementById('btnNexusStop').classList.remove('hidden');
  setRecordingIndicator(true);
}

async function summarize(transcript) {
  if (!transcript.trim()) {
    return { summary: 'No speech detected in this session.', figures: [], discrepancies: [], definitions: [], keywords: [] };
  }
  try {
    const resp = await fetch(`${WORKER_BASE_URL}/nexus/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript })
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Summarize failed');
    return data;
  } catch (err) {
    console.error('Summarize failed', err);
    return { summary: 'Summary unavailable — the request to the summarization service failed.', figures: [], discrepancies: [], definitions: [], keywords: [] };
  }
}

function renderSummary(summary) {
  const el = document.getElementById('nexusSummary');
  el.classList.remove('hidden');
  el.innerHTML = '';

  const addBlock = (title, contentEl) => {
    const h = document.createElement('div');
    h.className = 'nexus-summary-h';
    h.textContent = title;
    el.appendChild(h);
    el.appendChild(contentEl);
  };
  const list = (items) => {
    const ul = document.createElement('ul');
    (items || []).forEach((i) => { const li = document.createElement('li'); li.textContent = i; ul.appendChild(li); });
    if (!items || !items.length) { const li = document.createElement('li'); li.textContent = 'None found'; li.className = 'nexus-none'; ul.appendChild(li); }
    return ul;
  };

  const p = document.createElement('p');
  p.textContent = summary.summary || '';
  addBlock('Summary', p);
  addBlock('Key figures', list(summary.figures));
  addBlock('Discrepancies', list(summary.discrepancies));

  const defList = document.createElement('ul');
  (summary.definitions || []).forEach((d) => {
    const li = document.createElement('li');
    li.textContent = `${d.term}: ${d.definition}`;
    defList.appendChild(li);
  });
  if (!summary.definitions || !summary.definitions.length) {
    const li = document.createElement('li'); li.textContent = 'None found'; li.className = 'nexus-none'; defList.appendChild(li);
  }
  addBlock('Definitions', defList);

  const kw = document.createElement('div');
  kw.className = 'nexus-keywords';
  (summary.keywords || []).forEach((k) => { const tag = document.createElement('span'); tag.className = 'nexus-tag'; tag.textContent = k; kw.appendChild(tag); });
  addBlock('Keywords', kw);
}

async function stopSession() {
  return new Promise((resolve) => {
    mediaRecorder.addEventListener('stop', async () => {
      setRecordingIndicator(false);
      document.getElementById('btnNexusStop').classList.add('hidden');
      document.getElementById('btnNexusStart').classList.remove('hidden');

      const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      const transcript = sessionState.transcriptParts.join(' ');
      appendTranscript('— session ended, generating summary —');

      const summary = await summarize(transcript);
      renderSummary(summary);

      const record = {
        id: sessionState.id,
        startedAt: sessionState.startedAt,
        endedAt: Date.now(),
        transcript,
        summary,
        audioBlob,
        linkedFileId: sessionState.linkedFileId,
        title: `Session ${new Date(sessionState.startedAt).toLocaleString()}`
      };
      await put('NexusSessions', record);
      activeSessionRecord = record;
      document.getElementById('nexusExportRow').classList.remove('hidden');
      await refreshHistoryList();
      resolve();
    }, { once: true });
    mediaRecorder.stop();
  });
}

function loadSessionView(record) {
  activeSessionRecord = record;
  document.getElementById('nexusTranscript').innerHTML = '';
  const sentences = (record.transcript || '').split(/(?<=[.?!])\s+/).filter((s) => s.trim());
  if (sentences.length) sentences.forEach((s) => appendTranscript(s.trim()));
  else appendTranscript('(no speech captured in this session)');
  renderSummary(record.summary || {});
  document.getElementById('nexusExportRow').classList.remove('hidden');
  document.getElementById('nexusLinkedFile').value = record.linkedFileId || '';
  refreshHistoryList();
}

export async function refreshHistoryList() {
  const sessions = await getAll('NexusSessions');
  const query = (document.getElementById('nexusSearch').value || '').trim().toLowerCase();
  const list = document.getElementById('nexusHistoryList');
  list.innerHTML = '';

  const filtered = sessions
    .sort((a, b) => b.startedAt - a.startedAt)
    .filter((s) => !query
      || s.title.toLowerCase().includes(query)
      || (s.transcript || '').toLowerCase().includes(query)
      || (s.summary?.summary || '').toLowerCase().includes(query));

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'nexus-history-empty';
    empty.textContent = sessions.length ? 'No sessions match your search.' : 'No sessions yet.';
    list.appendChild(empty);
    return;
  }

  filtered.forEach((s) => {
    const item = document.createElement('button');
    item.className = 'nexus-history-item' + (activeSessionRecord && s.id === activeSessionRecord.id ? ' active' : '');
    item.textContent = s.title;
    item.addEventListener('click', () => loadSessionView(s));
    list.appendChild(item);
  });
  wireRipples(list);
}

// ---- Exports ----
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function summaryText(record) {
  const s = record.summary || {};
  return [
    `KEY FIGURES\n${(s.figures || []).join('\n') || 'None'}`,
    `DISCREPANCIES\n${(s.discrepancies || []).join('\n') || 'None'}`,
    `DEFINITIONS\n${(s.definitions || []).map((d) => `${d.term}: ${d.definition}`).join('\n') || 'None'}`,
    `KEYWORDS\n${(s.keywords || []).join(', ') || 'None'}`
  ].join('\n\n');
}

function exportTxt(record) {
  const text = `${record.title}\n\nTRANSCRIPT\n${record.transcript || '(no speech captured)'}\n\nSUMMARY\n${record.summary?.summary || ''}\n\n${summaryText(record)}`;
  downloadBlob(new Blob([text], { type: 'text/plain' }), `${record.title}.txt`);
}

function renderTextToCanvas(title, text) {
  const width = 900;
  const canvas = document.createElement('canvas');
  const measureCtx = canvas.getContext('2d');
  measureCtx.font = '15px sans-serif';
  const maxWidth = width - 80;
  const lines = [];
  text.split('\n').forEach((paragraph) => {
    if (!paragraph) { lines.push(''); return; }
    let line = '';
    paragraph.split(' ').forEach((word) => {
      const test = line ? `${line} ${word}` : word;
      if (measureCtx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
      else line = test;
    });
    lines.push(line);
  });

  const lineHeight = 22;
  canvas.width = width;
  canvas.height = 110 + lines.length * lineHeight;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#14151a';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(title, 40, 50);
  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#2a2c33';
  lines.forEach((l, i) => ctx.fillText(l, 40, 90 + i * lineHeight));
  return canvas;
}

function exportImage(record, type) {
  const text = `TRANSCRIPT\n${record.transcript || '(no speech captured)'}\n\nSUMMARY\n${record.summary?.summary || ''}`;
  const canvas = renderTextToCanvas(record.title, text);
  const mime = type === 'jpeg' ? 'image/jpeg' : 'image/png';
  canvas.toBlob((blob) => downloadBlob(blob, `${record.title}.${type === 'jpeg' ? 'jpg' : 'png'}`), mime, 0.92);
}

async function buildPdf(title, sections) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, margin = 48;
  let page = doc.addPage([W, H]);
  let y = H - margin;

  function ensureSpace() {
    if (y < margin + 20) { page = doc.addPage([W, H]); y = H - margin; }
  }
  function drawHeading(text) {
    ensureSpace();
    page.drawText(text, { x: margin, y, size: 14, font: bold, color: rgb(0.1, 0.1, 0.1) });
    y -= 22;
  }
  function drawParagraph(text) {
    const maxWidth = W - margin * 2;
    const words = (text || '').split(/\s+/);
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, 11) > maxWidth && line) {
        ensureSpace();
        page.drawText(line, { x: margin, y, size: 11, font, color: rgb(0.15, 0.15, 0.18) });
        y -= 16;
        line = word;
      } else line = test;
    }
    if (line) { ensureSpace(); page.drawText(line, { x: margin, y, size: 11, font, color: rgb(0.15, 0.15, 0.18) }); y -= 16; }
    y -= 8;
  }

  ensureSpace();
  page.drawText(title, { x: margin, y, size: 18, font: bold, color: rgb(0.1, 0.1, 0.1) });
  y -= 30;
  for (const [heading, body] of sections) {
    drawHeading(heading);
    drawParagraph(body);
  }
  return doc.save();
}

async function exportPdf(record) {
  const s = record.summary || {};
  const sections = [
    ['Transcript', record.transcript || '(no speech captured)'],
    ['Summary', s.summary || ''],
    ['Key figures', (s.figures || []).join(', ') || 'None'],
    ['Discrepancies', (s.discrepancies || []).join(', ') || 'None'],
    ['Definitions', (s.definitions || []).map((d) => `${d.term}: ${d.definition}`).join('; ') || 'None'],
    ['Keywords', (s.keywords || []).join(', ') || 'None']
  ];
  const bytes = await buildPdf(record.title, sections);
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${record.title}.pdf`);
}

async function exportCrossModuleReport(record) {
  let linkedBody = 'No file linked to this session.';
  if (record.linkedFileId) {
    const file = await get('Files', record.linkedFileId);
    if (file) {
      linkedBody = `${file.fileName} — ${file.syncStatus}${file.webUrl ? `\nSharePoint: ${file.webUrl}` : ''}`;
    } else {
      linkedBody = 'Linked file was deleted from My Files.';
    }
  }
  const s = record.summary || {};
  const sections = [
    ['Linked file', linkedBody],
    ['Transcript', record.transcript || '(no speech captured)'],
    ['Summary', s.summary || ''],
    ['Key figures', (s.figures || []).join(', ') || 'None'],
    ['Discrepancies', (s.discrepancies || []).join(', ') || 'None'],
    ['Keywords', (s.keywords || []).join(', ') || 'None']
  ];
  const bytes = await buildPdf(`${record.title} — Cross-module report`, sections);
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${record.title}-cross-module-report.pdf`);
}

function exportRawAudio(record) {
  const ext = (record.audioBlob.type || '').includes('ogg') ? 'ogg' : 'webm';
  downloadBlob(record.audioBlob, `${record.title}.${ext}`);
}

// Browsers' MediaRecorder can't encode MP3 natively (it only ever gives us webm/opus
// or similar) — decode the recorded audio back to raw PCM via the Web Audio API, then
// re-encode that PCM to MP3 client-side with lamejs. Real CPU cost per export, but
// needs no server round-trip and keeps the API key concern entirely out of this path.
function floatTo16BitPCM(floatSamples) {
  const out = new Int16Array(floatSamples.length);
  for (let i = 0; i < floatSamples.length; i++) {
    const s = Math.max(-1, Math.min(1, floatSamples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

async function decodeAudioBlob(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioCtx();
  try {
    return await audioCtx.decodeAudioData(arrayBuffer);
  } finally {
    audioCtx.close();
  }
}

async function encodeMp3FromAudioBuffer(audioBuffer) {
  // Loaded on first MP3 export only — most sessions never touch this, and lamejs is a
  // meaningful dependency to make every NEXUS visit pay for upfront (same reasoning as
  // Canvas's lazy-loaded Konva/Perfect Freehand).
  const { Mp3Encoder } = await import('https://cdn.jsdelivr.net/npm/@breezystack/lamejs@1.2.7/dist/lamejs.js');
  const channels = Math.min(audioBuffer.numberOfChannels, 2);
  const encoder = new Mp3Encoder(channels, audioBuffer.sampleRate, 128);
  const left = floatTo16BitPCM(audioBuffer.getChannelData(0));
  const right = channels > 1 ? floatTo16BitPCM(audioBuffer.getChannelData(1)) : null;

  const blockSize = 1152;
  const chunks = [];
  for (let i = 0; i < left.length; i += blockSize) {
    const leftChunk = left.subarray(i, i + blockSize);
    const buf = right
      ? encoder.encodeBuffer(leftChunk, right.subarray(i, i + blockSize))
      : encoder.encodeBuffer(leftChunk);
    if (buf.length > 0) chunks.push(buf);
  }
  const finalBuf = encoder.flush();
  if (finalBuf.length > 0) chunks.push(finalBuf);
  return new Blob(chunks, { type: 'audio/mpeg' });
}

async function exportMp3(record) {
  const audioBuffer = await decodeAudioBlob(record.audioBlob);
  const mp3Blob = await encodeMp3FromAudioBuffer(audioBuffer);
  downloadBlob(mp3Blob, `${record.title}.mp3`);
}

function initExportRow() {
  document.querySelectorAll('#nexusExportRow [data-export]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!activeSessionRecord) return;
      const type = btn.dataset.export;
      if (type === 'txt') exportTxt(activeSessionRecord);
      else if (type === 'pdf') exportPdf(activeSessionRecord);
      else if (type === 'png' || type === 'jpeg') exportImage(activeSessionRecord, type);
      else if (type === 'raw-audio') exportRawAudio(activeSessionRecord);
      else if (type === 'mp3') {
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = 'Encoding…';
        try { await exportMp3(activeSessionRecord); }
        catch (err) { console.error('MP3 export failed', err); alert('MP3 export failed: ' + err.message); }
        finally { btn.disabled = false; btn.textContent = originalText; }
      }
    });
  });
  document.getElementById('btnCrossModuleReport').addEventListener('click', () => {
    if (activeSessionRecord) exportCrossModuleReport(activeSessionRecord);
  });
}

export async function refreshNexusView() {
  await populateLinkedFileSelect();
  await refreshHistoryList();
}

export function initNexusTab() {
  document.getElementById('btnNexusStart').addEventListener('click', startSession);
  document.getElementById('btnNexusStop').addEventListener('click', stopSession);
  document.getElementById('nexusSearch').addEventListener('input', () => refreshHistoryList());
  initExportRow();
  refreshNexusView();
}
