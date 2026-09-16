import React, { useState } from 'react';
import { useRecords } from '../../hooks/useRecords.js';
import { sharePdf } from '../../lib/share.js';

const STATUS_LABEL = { synced: 'Synced', queued: 'Pending', failed: 'Failed', deleted_remote: 'Removed from SharePoint' };

export default function RecordsPanel() {
  const { records, refreshSyncStatuses } = useRecords();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await refreshSyncStatuses();
    } catch (err) {
      setRefreshError(err.message || 'Could not check SharePoint status.');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button className="if-btn if-btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? 'Checking…' : 'Refresh status'}
        </button>
      </div>
      {refreshError && <div className="if-error-text" style={{ marginBottom: 10 }}>{refreshError}</div>}

      {records.length === 0 ? (
        <p style={{ color: 'var(--if-text-muted)', fontSize: 13 }}>No forms have been submitted yet.</p>
      ) : (
        records.map((record) => (
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
        ))
      )}
    </div>
  );
}
