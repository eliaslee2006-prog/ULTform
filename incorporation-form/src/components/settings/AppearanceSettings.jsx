import React, { useRef } from 'react';
import { useSettings } from '../../context/SettingsContext.jsx';

const FONT_CHOICES = [
  { value: '', label: 'Default (Inter / system)' },
  { value: "'Georgia', serif", label: 'Georgia (serif)' },
  { value: "'Courier New', monospace", label: 'Courier New (mono)' },
  { value: "'Trebuchet MS', sans-serif", label: 'Trebuchet MS' }
];

const ACCENT_SWATCHES = ['#2f6fed', '#16233f', '#0f9d58', '#d64545', '#a855f7', '#c2761f'];

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function AppearanceSettings() {
  const { settings, updateSettings, importFont } = useSettings();
  const bgInputRef = useRef(null);
  const thankYouInputRef = useRef(null);
  const fontInputRef = useRef(null);

  const handleBgImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    updateSettings({ bgImageDataUrl: await fileToDataUrl(file) });
  };

  const handleThankYouImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    updateSettings({ thankYouBgImageDataUrl: await fileToDataUrl(file) });
  };

  const handleFontFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await importFont(file);
  };

  return (
    <div>
      <div className="if-settings-group">
        <h3>Font</h3>
        <div className="if-settings-row">
          <label>Typeface</label>
          <select
            value={settings.customFontFamily ? '__custom__' : settings.fontFamily}
            onChange={(e) => updateSettings({ fontFamily: e.target.value, customFontFamily: null })}
          >
            {settings.customFontFamily && <option value="__custom__">Custom uploaded font</option>}
            {FONT_CHOICES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="if-settings-row">
          <label>Upload custom font (.ttf/.otf/.woff)</label>
          <button className="if-btn if-btn-ghost" onClick={() => fontInputRef.current?.click()}>
            Upload
          </button>
          <input ref={fontInputRef} type="file" accept=".ttf,.otf,.woff,.woff2" hidden onChange={handleFontFile} />
        </div>
        <div className="if-settings-row">
          <label>Text size</label>
          <input
            type="range"
            min="0.85"
            max="1.3"
            step="0.05"
            value={settings.fontScale}
            onChange={(e) => updateSettings({ fontScale: parseFloat(e.target.value) })}
          />
        </div>
      </div>

      <div className="if-settings-group">
        <h3>Color</h3>
        <div className="if-settings-row">
          <label>Text color</label>
          <input type="color" value={settings.textColor} onChange={(e) => updateSettings({ textColor: e.target.value })} />
        </div>
        <div className="if-settings-row">
          <label>Accent color</label>
          <div className="if-color-swatches">
            {ACCENT_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                className={`if-swatch${settings.accentColor === c ? ' selected' : ''}`}
                style={{ background: c }}
                onClick={() => updateSettings({ accentColor: c })}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="if-settings-group">
        <h3>Form background</h3>
        <div className="if-settings-row">
          <label>Background color</label>
          <input type="color" value={settings.bgColor} onChange={(e) => updateSettings({ bgColor: e.target.value })} />
        </div>
        <div className="if-settings-row">
          <label>Background image</label>
          <button className="if-btn if-btn-ghost" onClick={() => bgInputRef.current?.click()}>
            Upload
          </button>
          <input ref={bgInputRef} type="file" accept="image/*" hidden onChange={handleBgImage} />
        </div>
        {settings.bgImageDataUrl && (
          <button className="if-btn if-btn-ghost" onClick={() => updateSettings({ bgImageDataUrl: null })}>
            Remove background image
          </button>
        )}
      </div>

      <div className="if-settings-group">
        <h3>Thank-you page background</h3>
        <div className="if-settings-row">
          <label>Background color</label>
          <input
            type="color"
            value={settings.thankYouBgColor}
            onChange={(e) => updateSettings({ thankYouBgColor: e.target.value })}
          />
        </div>
        <div className="if-settings-row">
          <label>Background image</label>
          <button className="if-btn if-btn-ghost" onClick={() => thankYouInputRef.current?.click()}>
            Upload
          </button>
          <input ref={thankYouInputRef} type="file" accept="image/*" hidden onChange={handleThankYouImage} />
        </div>
        {settings.thankYouBgImageDataUrl && (
          <button className="if-btn if-btn-ghost" onClick={() => updateSettings({ thankYouBgImageDataUrl: null })}>
            Remove background image
          </button>
        )}
      </div>
    </div>
  );
}
