import { getAll, put } from './db.js';

export async function listFonts() {
  return getAll('Fonts');
}

export function fontFamilyCss(family) {
  if (!family) return '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
  return `"${family}", -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`;
}

async function registerFontFace(record) {
  const fontFace = new FontFace(record.family, record.bytes);
  await fontFace.load();
  document.fonts.add(fontFace);
}

export async function addFontFromFile(file) {
  const bytes = await file.arrayBuffer();
  const id = crypto.randomUUID();
  const family = `nexdash-font-${id.slice(0, 8)}`;
  const record = { id, name: file.name.replace(/\.[^.]+$/, ''), family, bytes, addedAt: Date.now() };
  await registerFontFace(record);
  await put('Fonts', record);
  return record;
}

export async function restoreFonts() {
  const fonts = await listFonts();
  for (const record of fonts) {
    try { await registerFontFace(record); }
    catch (err) { console.error('Failed to register stored font', record.name, err); }
  }
  return fonts;
}
