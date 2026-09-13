import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { get, put } from '../lib/db.js';
import { BUILTIN_BRUSH_PRESETS, DEFAULT_BRUSH_ID } from '../lib/brushEngine.js';
import { importBrushPackFile } from '../lib/brushImport.js';

const SETTINGS_KEY = 'appearance';

const DEFAULT_SETTINGS = {
  fontFamily: '',
  customFontFamily: null, // set once a custom font file is registered
  fontScale: 1,
  textColor: '#1b2333',
  accentColor: '#2f6fed',
  bgColor: '#eef0f4',
  bgImageDataUrl: null,
  thankYouBgColor: '#eef0f4',
  thankYouBgImageDataUrl: null,
  selectedBrushId: DEFAULT_BRUSH_ID,
  customBrushPresets: []
};

const SettingsContext = createContext(null);

function applyCssVars(settings) {
  const root = document.documentElement.style;
  const family = settings.customFontFamily
    ? `"${settings.customFontFamily}", var(--if-font-family)`
    : settings.fontFamily || 'var(--if-font-family)';
  root.setProperty('--if-user-font', family);
  root.setProperty('--if-user-text-color', settings.textColor);
  root.setProperty('--if-user-accent', settings.accentColor);
  root.setProperty('--if-user-bg-color', settings.bgColor);
  root.setProperty('--if-user-bg-image', settings.bgImageDataUrl ? `url(${settings.bgImageDataUrl})` : 'none');
  root.setProperty(
    '--if-user-thankyou-bg-image',
    settings.thankYouBgImageDataUrl ? `url(${settings.thankYouBgImageDataUrl})` : settings.bgImageDataUrl ? `url(${settings.bgImageDataUrl})` : 'none'
  );
  root.setProperty('--if-font-scale', settings.fontScale);
}

async function registerCustomFontFace(bytes, family) {
  const fontFace = new FontFace(family, bytes);
  await fontFace.load();
  document.fonts.add(fontFace);
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const rec = await get('Settings', SETTINGS_KEY);
      const merged = { ...DEFAULT_SETTINGS, ...(rec ? rec.value : {}) };
      if (merged.customFontBytes && merged.customFontFamily) {
        try {
          await registerCustomFontFace(merged.customFontBytes, merged.customFontFamily);
        } catch (err) {
          console.error('Failed to restore custom font', err);
        }
      }
      setSettings(merged);
      applyCssVars(merged);
      setLoaded(true);
    })();
  }, []);

  const persist = useCallback((next) => {
    put('Settings', { key: SETTINGS_KEY, value: next });
  }, []);

  const updateSettings = useCallback(
    (partial) => {
      setSettings((prev) => {
        const next = { ...prev, ...partial };
        applyCssVars(next);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const importFont = useCallback(
    async (file) => {
      const bytes = await file.arrayBuffer();
      const family = `if-custom-font-${Date.now().toString(36)}`;
      await registerCustomFontFace(bytes, family);
      updateSettings({ customFontFamily: family, customFontBytes: bytes, fontFamily: '' });
    },
    [updateSettings]
  );

  const importBrushPack = useCallback(
    async (file) => {
      const presets = await importBrushPackFile(file);
      updateSettings({ customBrushPresets: [...settings.customBrushPresets, ...presets] });
      return presets;
    },
    [settings.customBrushPresets, updateSettings]
  );

  const allBrushPresets = useMemo(
    () => [...BUILTIN_BRUSH_PRESETS, ...settings.customBrushPresets],
    [settings.customBrushPresets]
  );

  const selectedBrush = useMemo(
    () => allBrushPresets.find((p) => p.id === settings.selectedBrushId) || allBrushPresets[0],
    [allBrushPresets, settings.selectedBrushId]
  );

  const value = useMemo(
    () => ({
      settings,
      loaded,
      updateSettings,
      importFont,
      importBrushPack,
      allBrushPresets,
      selectedBrush,
      setSelectedBrushId: (id) => updateSettings({ selectedBrushId: id })
    }),
    [settings, loaded, updateSettings, importFont, importBrushPack, allBrushPresets, selectedBrush]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
