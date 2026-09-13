import React, { useRef, useState } from 'react';

// Shared by the signature popup and Settings → Signature Brush — whichever preset is
// selected here is what SignatureModal renders with.
export default function BrushPicker({ presets, selectedId, onSelect, onImport }) {
  const fileInputRef = useRef(null);
  const [importError, setImportError] = useState(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setImportError(null);
      const imported = await onImport(file);
      if (imported?.length) onSelect(imported[0].id);
    } catch (err) {
      setImportError(err.message || 'Could not import brush pack');
    }
  };

  return (
    <div className="if-brush-picker">
      <select value={selectedId} onChange={(e) => onSelect(e.target.value)}>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.packName ? ` (${p.packName})` : ''}
          </option>
        ))}
      </select>
      <button type="button" className="if-btn if-btn-ghost" onClick={() => fileInputRef.current?.click()}>
        Import brush pack
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.abr,.brushset"
        hidden
        onChange={handleFile}
      />
      {importError && <div className="if-error-text">{importError}</div>}
    </div>
  );
}
