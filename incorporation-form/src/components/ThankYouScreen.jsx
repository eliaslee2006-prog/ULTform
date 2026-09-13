import React from 'react';
import { useSettings } from '../context/SettingsContext.jsx';
import { sharePdf } from '../lib/share.js';

export default function ThankYouScreen({ record, onStartNew }) {
  const { settings } = useSettings();

  return (
    <div
      className="if-thankyou"
      style={{
        backgroundColor: settings.thankYouBgColor,
        backgroundImage: settings.thankYouBgImageDataUrl ? `url(${settings.thankYouBgImageDataUrl})` : undefined
      }}
    >
      <div className="if-thankyou-card">
        <h1>Thank you for filling out the form</h1>
        <p>Your incorporation factsheet has been recorded. A copy has been generated for your records.</p>
        {record && (
          <button className="if-btn if-btn-primary" onClick={() => sharePdf(record.pdfBlob, record.fileName)}>
            Download your copy
          </button>
        )}
        <div className="if-sync-note">
          {record?.syncStatus === 'synced'
            ? 'Uploaded to company storage.'
            : 'Saved on this device — it will sync to company storage automatically once connected.'}
        </div>
        <div style={{ marginTop: 22 }}>
          <button className="if-btn if-btn-ghost" onClick={onStartNew}>
            Fill out another form
          </button>
        </div>
      </div>
    </div>
  );
}
