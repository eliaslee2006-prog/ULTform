const DB_NAME = 'intake-db';
const DB_VERSION = 2;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('Templates')) {
        db.createObjectStore('Templates', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('PendingSync')) {
        db.createObjectStore('PendingSync', { keyPath: 'idempotencyKey' });
      }
      if (!db.objectStoreNames.contains('Files')) {
        db.createObjectStore('Files', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('Settings')) {
        db.createObjectStore('Settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('Fonts')) {
        db.createObjectStore('Fonts', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('Folders')) {
        db.createObjectStore('Folders', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('NexusSessions')) {
        db.createObjectStore('NexusSessions', { keyPath: 'id' });
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
  return tx(storeName, 'readwrite', store => store.put(record));
}

export async function getAll(storeName) {
  return new Promise(async (resolve, reject) => {
    const db = await openDB();
    const t = db.transaction(storeName, 'readonly');
    const req = t.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function get(storeName, key) {
  return new Promise(async (resolve, reject) => {
    const db = await openDB();
    const t = db.transaction(storeName, 'readonly');
    const req = t.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function remove(storeName, key) {
  return tx(storeName, 'readwrite', store => store.delete(key));
}

export async function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    const granted = await navigator.storage.persist();
    return granted;
  }
  return false;
}
