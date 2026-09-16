import { useCallback, useEffect, useState } from 'react';
import { getAll, put, remove } from '../lib/db.js';
import { enqueue, setStatusListener, checkRecordsStatus } from '../lib/syncEngine.js';
import { TEMPLATE_ID } from '../lib/workerConfig.js';

function formatFileTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function useRecords() {
  const [records, setRecords] = useState([]);

  const refresh = useCallback(async () => {
    const all = await getAll('Records');
    all.sort((a, b) => b.createdAt - a.createdAt);
    setRecords(all);
  }, []);

  useEffect(() => {
    refresh();
    setStatusListener(() => refresh());
  }, [refresh]);

  const submitRecord = useCallback(
    async ({ pdfBlob, customerName }) => {
      const id = crypto.randomUUID ? crypto.randomUUID() : `rec-${Date.now()}`;
      const createdAt = Date.now();
      const fileName = `${(customerName || 'incorporation-factsheet').replace(/[^a-z0-9-_]+/gi, '-')}-${formatFileTimestamp(new Date(createdAt))}.pdf`;
      const record = {
        id,
        idempotencyKey: id,
        fileName,
        customerName: customerName || 'Untitled submission',
        createdAt,
        syncStatus: 'queued',
        pdfBlob
      };
      await put('Records', record);
      await enqueue({ idempotencyKey: id, fileName, templateId: TEMPLATE_ID, pdfBlob });
      await refresh();
      return record;
    },
    [refresh]
  );

  const refreshSyncStatuses = useCallback(async () => {
    const all = await getAll('Records');
    const syncedWithId = all.filter((r) => r.syncStatus === 'synced' && r.sharepointFileId);
    if (syncedWithId.length === 0) return;

    const results = await checkRecordsStatus(syncedWithId.map((r) => r.sharepointFileId));
    for (const record of syncedWithId) {
      if (results[record.sharepointFileId] === false) {
        await put('Records', { ...record, syncStatus: 'deleted_remote' });
      }
    }
    await refresh();
  }, [refresh]);

  const deleteRecord = useCallback(
    async (id) => {
      await remove('Records', id);
      await remove('PendingSync', id); // no-op if it already synced/left the queue
      await refresh();
    },
    [refresh]
  );

  return { records, refresh, submitRecord, refreshSyncStatuses, deleteRecord };
}
