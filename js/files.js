import { getAll, put, get, remove } from './db.js';
import { wireRipples } from './ripple.js';
import { shareCompletedPDF, openWhatsAppShare, openTelegramShare } from './share.js';

const COLORS = [null, '#E2483D', '#E0932B', '#1FA971', '#3E63DD', '#8B5CF6'];
let activeFolderId = '';

export async function addFileRecord({ id, fileName, pdfBlob, templateId, source = 'form' }) {
  await put('Files', {
    id,
    fileName,
    pdfBlob,
    templateId: templateId || null,
    folderId: null,
    color: null,
    source,
    syncStatus: source === 'imported' ? 'local' : 'queued',
    sharepointFileId: null,
    webUrl: null,
    createdAt: Date.now()
  });
}

function iconShare() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7M16 6l-4-4-4 4M12 2v14"/></svg>';
}
function iconWhatsApp() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 21l1.6-4.8A8 8 0 1112 20a8 8 0 01-5.2-1.9L3 21z"/><path d="M8.5 9.5c0 3 2 5 5 5"/></svg>';
}
function iconTelegram() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 3L3 10.5l7 2.5m11-10l-4 17-7-6m11-11l-11 11"/></svg>';
}
function iconDelete() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';
}

async function renderFolderChips() {
  const folders = await getAll('Folders');
  const wrap = document.getElementById('folderChips');
  wrap.innerHTML = '';

  const allChip = document.createElement('button');
  allChip.className = 'folder-chip' + (activeFolderId === '' ? ' active' : '');
  allChip.textContent = 'All files';
  allChip.addEventListener('click', () => { activeFolderId = ''; refreshFilesList(); });
  wrap.appendChild(allChip);

  folders.forEach((f) => {
    const chip = document.createElement('button');
    chip.className = 'folder-chip' + (activeFolderId === f.id ? ' active' : '');
    chip.style.setProperty('--chip-color', f.color || 'var(--accent)');
    chip.textContent = f.name;
    chip.addEventListener('click', () => { activeFolderId = f.id; refreshFilesList(); });

    const del = document.createElement('span');
    del.className = 'folder-chip-x';
    del.textContent = '×';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      const files = await getAll('Files');
      await Promise.all(files.filter((r) => r.folderId === f.id).map((r) => put('Files', { ...r, folderId: null })));
      await remove('Folders', f.id);
      if (activeFolderId === f.id) activeFolderId = '';
      refreshFilesList();
    });
    chip.appendChild(del);
    wrap.appendChild(chip);
  });
}

function syncLabel(state) {
  return { synced: 'Synced', queued: 'Waiting to sync', syncing: 'Syncing…', failed: 'Sync failed', local: 'Local only' }[state] || state;
}

async function renderFileRow(record, folders) {
  const row = document.createElement('div');
  row.className = 'file-row glass';
  row.dataset.id = record.id;

  const colorBtn = document.createElement('button');
  colorBtn.className = 'file-color';
  colorBtn.style.background = record.color || 'rgba(128,128,128,0.25)';
  colorBtn.title = 'Tap to change color';
  colorBtn.addEventListener('click', async () => {
    const next = COLORS[(COLORS.indexOf(record.color) + 1) % COLORS.length];
    await put('Files', { ...record, color: next });
    refreshFilesList();
  });
  row.appendChild(colorBtn);

  const nameEl = document.createElement('div');
  nameEl.className = 'file-name';
  nameEl.contentEditable = 'true';
  nameEl.spellcheck = false;
  nameEl.textContent = record.fileName;
  nameEl.addEventListener('blur', async () => {
    const newName = nameEl.textContent.trim() || record.fileName;
    if (newName !== record.fileName) await put('Files', { ...record, fileName: newName });
  });
  nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } });
  row.appendChild(nameEl);

  const folderSelect = document.createElement('select');
  folderSelect.className = 'file-folder-select';
  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = 'No folder';
  folderSelect.appendChild(noneOpt);
  folders.forEach((f) => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.name;
    if (record.folderId === f.id) opt.selected = true;
    folderSelect.appendChild(opt);
  });
  folderSelect.addEventListener('change', async () => {
    await put('Files', { ...record, folderId: folderSelect.value || null });
    refreshFilesList();
  });
  row.appendChild(folderSelect);

  const syncDot = document.createElement('span');
  syncDot.className = 'file-sync';
  syncDot.dataset.state = record.syncStatus;
  syncDot.title = syncLabel(record.syncStatus);
  row.appendChild(syncDot);

  const actions = document.createElement('div');
  actions.className = 'file-actions';

  const shareBtn = document.createElement('button');
  shareBtn.className = 'file-action';
  shareBtn.innerHTML = iconShare();
  shareBtn.title = 'Share';
  shareBtn.addEventListener('click', () => shareCompletedPDF(record.pdfBlob, record.fileName));
  actions.appendChild(shareBtn);

  const waBtn = document.createElement('button');
  waBtn.className = 'file-action';
  waBtn.innerHTML = iconWhatsApp();
  waBtn.title = 'WhatsApp';
  waBtn.addEventListener('click', () => openWhatsAppShare(null, `Sharing ${record.fileName} from NexDash`));
  actions.appendChild(waBtn);

  const tgBtn = document.createElement('button');
  tgBtn.className = 'file-action';
  tgBtn.innerHTML = iconTelegram();
  tgBtn.title = 'Telegram';
  tgBtn.addEventListener('click', () => openTelegramShare(null, `Sharing ${record.fileName} from NexDash`));
  actions.appendChild(tgBtn);

  const delBtn = document.createElement('button');
  delBtn.className = 'file-action file-action--danger';
  delBtn.innerHTML = iconDelete();
  delBtn.title = 'Delete';
  delBtn.addEventListener('click', async () => {
    await remove('Files', record.id);
    refreshFilesList();
  });
  actions.appendChild(delBtn);

  row.appendChild(actions);
  return row;
}

export async function refreshFilesList() {
  await renderFolderChips();
  const [files, folders] = await Promise.all([getAll('Files'), getAll('Folders')]);
  const visible = files
    .filter((r) => (activeFolderId === '' ? true : r.folderId === activeFolderId))
    .sort((a, b) => b.createdAt - a.createdAt);

  const list = document.getElementById('filesList');
  list.innerHTML = '';
  document.getElementById('filesEmpty').classList.toggle('hidden', visible.length > 0);

  for (const record of visible) {
    list.appendChild(await renderFileRow(record, folders));
  }
  wireRipples(list);
}

export function initFilesTab() {
  document.getElementById('btnNewFolder').addEventListener('click', async () => {
    const name = prompt('Folder name?');
    if (!name) return;
    const colorChoice = COLORS[1 + Math.floor(Math.random() * (COLORS.length - 1))];
    await put('Folders', { id: crypto.randomUUID(), name: name.trim(), color: colorChoice, createdAt: Date.now() });
    refreshFilesList();
  });

  document.getElementById('importFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const pdfBlob = file.slice(0, file.size, 'application/pdf');
    await addFileRecord({ id: crypto.randomUUID(), fileName: file.name, pdfBlob, source: 'imported' });
    e.target.value = '';
    refreshFilesList();
  });

  refreshFilesList();
  setInterval(() => {
    if (!document.getElementById('screen-files').classList.contains('hidden')) refreshFilesList();
  }, 4000);
}
