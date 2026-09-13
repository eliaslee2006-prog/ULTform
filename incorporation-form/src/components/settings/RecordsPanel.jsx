import React from 'react';
import { useRecords } from '../../hooks/useRecords.js';
import { sharePdf } from '../../lib/share.js';

const STATUS_LABEL = { synced: 'Synced', queued: 'Pending', failed: 'Failed' };

export default function RecordsPanel() {
  const { records } = useRecords();

  if (records.length === 0) {
    return <p style={{ color: 'var(--if-text-muted)', fontSize: 13 }}>No forms have been submitted yet.</p>;
  }

  return (
    <div>
      {records.map((record) => (
        <div className="if-record-row" key={record.id}>
          <div className="if-record-meta">
            <span className="if-record-name">{record.customerName}</span>
            <span className="if-record-date">{new Date(record.createdAt).toLocaleString()}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={`if-status-badge if-status-${record.syncStatus}`}>
              {STATUS_LABEL[record.syncStatus] || record.syncStatus}
            </span>
            <button
              className="if-btn if-btn-ghost"
              style={{ padding: '6px 10px', fontSize: 12 }}
              onClick={() => sharePdf(record.pdfBlob, record.fileName)}
            >
              Export
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
