import React from 'react';
import { useSettings } from '../../context/SettingsContext.jsx';
import BrushPicker from '../signature/BrushPicker.jsx';

export default function SignatureBrushSettings() {
  const { allBrushPresets, selectedBrush, setSelectedBrushId, importBrushPack } = useSettings();

  return (
    <div className="if-settings-group">
      <h3>Signature brush</h3>
      <p style={{ fontSize: 12.5, color: 'var(--if-text-muted)', marginTop: 0 }}>
        Choose the ink style used when signing the form, or import a brush pack (.json, .abr, .brushset).
        Whichever brush is selected here is applied the next time the signature box is opened.
      </p>
      <BrushPicker
        presets={allBrushPresets}
        selectedId={selectedBrush.id}
        onSelect={setSelectedBrushId}
        onImport={importBrushPack}
      />
    </div>
  );
}
