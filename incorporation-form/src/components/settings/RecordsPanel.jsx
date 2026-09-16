import React, { useState } from 'react';
import { useRecords } from '../../hooks/useRecords.js';
import { sharePdf } from '../../lib/share.js';

const STATUS_LABEL = { synced: 'Synced', queued: 'Pending', failed: 'Failed', deleted_remote: 'Removed from SharePoint' };
const PAGE_SIZE = 10;

export default function RecordsPanel() {
  const { records, refreshSyncStatuses, deleteRecord } = useRecords();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);
  const [page, setPage] = useState(0);

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

  const handleDelete = async (record) => {
    if (!window.confirm(`Permanently delete "${record.customerName}" from this device? This can't be undone.`)) return;
    await deleteRecord(record.id);
    setPage((p) => (p > 0 && p * PAGE_SIZE >= records.length - 1 ? p - 1 : p));
  };

  const pageCount = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRecords = records.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

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
        <>
          {pageRecords.map((record) => (
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
                <button
                  className="if-btn if-btn-danger"
                  style={{ padding: '6px 10px', fontSize: 12 }}
                  onClick={() => handleDelete(record)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}

          {pageCount > 1 && (
            <div className="if-pagination">
              <button
                className="if-btn if-btn-ghost"
                style={{ padding: '5px 10px', fontSize: 12 }}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
              >
                Prev
              </button>
              <span className="if-pagination-label">
                Page {currentPage + 1} of {pageCount}
              </span>
              <button
                className="if-btn if-btn-ghost"
                style={{ padding: '5px 10px', fontSize: 12 }}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={currentPage >= pageCount - 1}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
