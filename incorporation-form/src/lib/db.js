// IndexedDB wrapper — ported from ULTform's js/db.js (same put/get/getAll/remove shape),
// trimmed to the stores this app needs: Settings, Records (submitted forms), PendingSync (offline queue), BrushPresets.

const DB_NAME = 'incorporation-form-db';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('Settings')) {
        db.createObjectStore('Settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('Records')) {
        db.createObjectStore('Records', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('PendingSync')) {
        db.createObjectStore('PendingSync', { keyPath: 'idempotencyKey' });
      }
      if (!db.objectStoreNames.contains('BrushPresets')) {
        db.createObjectStore('BrushPresets', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const result = fn(store);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  });
}

export async function put(storeName, record) {
  return tx(storeName, 'readwrite', (store) => store.put(record));
}

export async function getAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readonly');
    const req = t.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function get(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readonly');
    const req = t.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function remove(storeName, key) {
  return tx(storeName, 'readwrite', (store) => store.delete(key));
}
