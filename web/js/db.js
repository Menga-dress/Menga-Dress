// Archivio locale sul telefono (IndexedDB). Niente server: i dati restano sul dispositivo.

const DB_NAME = 'dress';
const DB_VERSION = 1;

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('outfits')) db.createObjectStore('outfits', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const result = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const newId = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export const getAll = (store) => run(store, 'readonly', (s) => s.getAll());
export const get = (store, id) => run(store, 'readonly', (s) => s.get(id));
export const put = (store, value) => run(store, 'readwrite', (s) => s.put(value));
export const remove = (store, id) => run(store, 'readwrite', (s) => s.delete(id));
export const clear = (store) => run(store, 'readwrite', (s) => s.clear());

export const getKV = (key) => run('kv', 'readonly', (s) => s.get(key));
export const setKV = (key, value) => run('kv', 'readwrite', (s) => s.put(value, key));

// Chiede al browser di non cancellare i dati quando lo spazio scarseggia.
export async function askPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch { /* non indispensabile */ }
}

// ---- Backup ----

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function dataURLToBlob(url) {
  const res = await fetch(url);
  return res.blob();
}

export async function exportBackup() {
  const items = await getAll('items');
  const outfits = await getAll('outfits');
  const profile = await getKV('profile');
  const itemsOut = [];
  for (const it of items) {
    itemsOut.push({ ...it, image: it.image ? await blobToDataURL(it.image) : null });
  }
  return {
    app: 'dress',
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: profile || null,
    items: itemsOut,
    outfits,
  };
}

export async function importBackup(data) {
  if (!data || data.app !== 'dress' || !Array.isArray(data.items)) {
    throw new Error('Il file non sembra un backup di Dress.');
  }
  for (const it of data.items) {
    await put('items', { ...it, image: it.image ? await dataURLToBlob(it.image) : null });
  }
  for (const o of data.outfits || []) await put('outfits', o);
  if (data.profile) await setKV('profile', data.profile);
  return data.items.length;
}
