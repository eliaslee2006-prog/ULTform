export const WORKER_BASE_URL = 'https://intake.eliaslhx.com';

// This is a plain static site (no build step), so there's nowhere to inject a secret
// at build time the way incorporation-form does via .env. Ask each device once and
// keep it in localStorage instead of committing it to this public repo's source.
const SYNC_KEY_STORAGE = 'nexdash-sync-api-key';

export function getSyncApiKey() {
  let key = localStorage.getItem(SYNC_KEY_STORAGE);
  if (!key) {
    key = window.prompt('Enter the sync API key for this device (ask your admin):') || '';
    if (key) localStorage.setItem(SYNC_KEY_STORAGE, key);
  }
  return key;
}
