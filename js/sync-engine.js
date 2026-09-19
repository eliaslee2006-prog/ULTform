import { getAll, put, remove, get } from './db.js';
import { WORKER_BASE_URL, getSyncApiKey } from './worker-config.js';

const WORKER_SYNC_URL = `${WORKER_BASE_URL}/sync`;
const MAX_RETRIES = 10;
const BACKOFF_STEPS = [5000, 15000, 45000, 120000]; // ms, last value repeats after this

let onStatusChange = () => {};
export function setStatusListener(fn) { onStatusChange = fn; }

export function initSyncEngine() {
  window.addEventListener('online', () => syncAll());
  setInterval(() => syncAll(), 30000); // iOS PWAs don't reliably fire 'online' in background
  syncAll();
}

export async function enqueue(record) {
  await put('PendingSync', { ...record, status: 'queued', retryCount: 0, lastError: null, createdAt: Date.now() });
  onStatusChange('queued');
  syncAll();
}

export async function syncAll() {
  if (!navigator.onLine) return;
  const pending = await getAll('PendingSync');
  const toSync = pending.filter(r => r.status !== 'syncing');
  if (toSync.length === 0) return;

  onStatusChange('syncing');

  for (const record of toSync) {
    await syncOne(record);
  }

  const remaining = await getAll('PendingSync');
  const anyFailed = remaining.some(r => r.status === 'failed');
  onStatusChange(anyFailed ? 'failed' : (remaining.length ? 'queued' : 'idle'));
}

async function syncOne(record) {
  record.status = 'syncing';
  await put('PendingSync', record);

  try {
    const resp = await fetch(WORKER_SYNC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        'X-Idempotency-Key': record.idempotencyKey,
        'X-File-Name': record.fileName,
        'X-Template-Id': record.templateId,
        'X-App-Key': getSyncApiKey()
      },
      body: record.pdfBlob
    });

    const data = await resp.json();
    if (!resp.ok || !data.success) {
      throw new Error(data.error || `Sync failed with status ${resp.status}`);
    }

    await remove('PendingSync', record.idempotencyKey);
    const fileRecord = await get('Files', record.idempotencyKey);
    if (fileRecord) {
      await put('Files', { ...fileRecord, sharepointFileId: data.fileId, webUrl: data.webUrl, syncStatus: 'synced' });
    }
  } catch (err) {
    record.retryCount = (record.retryCount || 0) + 1;
    record.lastError = err.message;
    record.status = record.retryCount >= MAX_RETRIES ? 'failed' : 'queued';
    await put('PendingSync', record);

    const fileRecord = await get('Files', record.idempotencyKey);
    if (fileRecord) {
      await put('Files', { ...fileRecord, syncStatus: record.status === 'failed' ? 'failed' : 'queued' });
    }

    if (record.status === 'queued') {
      const delay = BACKOFF_STEPS[Math.min(record.retryCount - 1, BACKOFF_STEPS.length - 1)];
      setTimeout(() => syncOne(record), delay);
    }
  }
}
