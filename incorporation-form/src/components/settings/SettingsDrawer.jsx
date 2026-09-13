import React, { useState } from 'react';
import AppearanceSettings from './AppearanceSettings.jsx';
import SignatureBrushSettings from './SignatureBrushSettings.jsx';
import RecordsPanel from './RecordsPanel.jsx';

const TABS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'brush', label: 'Signature Brush' },
  { id: 'records', label: 'Records' }
];

export default function SettingsDrawer({ open, onClose }) {
  const [tab, setTab] = useState('appearance');

  if (!open) return null;

  return (
    <>
      <div className="if-drawer-overlay" onClick={onClose} />
      <aside className="if-drawer">
        <div className="if-drawer-header">
          <h2 style={{ margin: 0, fontSize: 16 }}>Settings</h2>
          <button className="if-modal-close" onClick={onClose} aria-label="Close settings">
            &times;
          </button>
        </div>
        <div className="if-drawer-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`if-drawer-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="if-drawer-body">
          {tab === 'appearance' && <AppearanceSettings />}
          {tab === 'brush' && <SignatureBrushSettings />}
          {tab === 'records' && <RecordsPanel />}
        </div>
      </aside>
    </>
  );
}
