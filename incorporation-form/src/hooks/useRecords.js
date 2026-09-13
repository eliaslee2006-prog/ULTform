import { useCallback, useEffect, useState } from 'react';
import { getAll, put } from '../lib/db.js';
import { enqueue, setStatusListener } from '../lib/syncEngine.js';
import { TEMPLATE_ID } from '../lib/workerConfig.js';

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
      const fileName = `${(customerName || 'incorporation-factsheet').replace(/[^a-z0-9-_]+/gi, '-')}-${id.slice(0, 8)}.pdf`;
      const record = {
        id,
        idempotencyKey: id,
        fileName,
        customerName: customerName || 'Untitled submission',
        createdAt: Date.now(),
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

  return { records, refresh, submitRecord };
}
