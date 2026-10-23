// Banco local (IndexedDB). Tudo fica no próprio iPad — faça backup pela ferramenta Exportar.
const DB_NAME = 'cadastro-imoveis';
const VERSION = 2;
const STORES = ['properties', 'rooms', 'photos', 'measures', 'services'];
const INDEXED = ['rooms', 'photos', 'measures', 'services'];

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: 'id' });
        if (INDEXED.includes(name)) store.createIndex('propertyId', 'propertyId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export const db = {
  async get(name, id) {
    return done((await store(name)).get(id));
  },
  async all(name) {
    return done((await store(name)).getAll());
  },
  async byProperty(name, propertyId) {
    return done((await store(name)).index('propertyId').getAll(propertyId));
  },
  async put(name, obj) {
    obj.updatedAt = Date.now();
    await done((await store(name, 'readwrite')).put(obj));
    return obj;
  },
  async del(name, id) {
    return done((await store(name, 'readwrite')).delete(id));
  },
  async deleteProperty(propertyId) {
    for (const name of INDEXED) {
      for (const item of await this.byProperty(name, propertyId)) await this.del(name, item.id);
    }
    await this.del('properties', propertyId);
  },
  STORES,
};
