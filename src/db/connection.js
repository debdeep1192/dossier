// ============================================================
// Local-first storage: IndexedDB, no engine to boot.
//
// This replaces the old Dossier's PGlite/Postgres-in-WASM approach.
// That architecture cost ~16MB of WASM/data payload and a Web Worker
// round-trip before the database was even usable — the dominant cause
// of slow startup and sluggish navigation in the previous app. Plain
// IndexedDB opens near-instantly (no engine to instantiate) and every
// read/write here is a direct, in-process call — no Worker hop, no
// message-passing overhead. This is the single biggest lever for the
// "fast first paint, no unnecessary loading screen" requirement.
//
// DB_VERSION / upgrade path: IndexedDB's own onupgradeneeded is the
// migration mechanism — no separate migration framework needed. Bump
// DB_VERSION and add a case to the upgrade switch when the store
// structure needs to change; each case only creates what's missing, so
// upgrading an existing database never touches data in stores that
// didn't change.
// ============================================================

const DB_NAME = 'dossier';
const DB_VERSION = 1;

// One object store per research section (each a genuinely distinct
// shape defined in db/stores/*.js — never a shared "item_kind" bucket),
// plus destinations and the shared building blocks (sources, intake
// documents, review candidates).
const STORE_DEFS = [
  { name: 'destinations', keyPath: 'id', indexes: [] },
  { name: 'sources', keyPath: 'id', indexes: [['destinationId', 'destinationId']] },
  { name: 'attractions', keyPath: 'id', indexes: [['destinationId', 'destinationId']] },
  { name: 'restaurants', keyPath: 'id', indexes: [['destinationId', 'destinationId']] },
  { name: 'accommodations', keyPath: 'id', indexes: [['destinationId', 'destinationId']] },
  { name: 'transport', keyPath: 'id', indexes: [['destinationId', 'destinationId']] },
  { name: 'costs', keyPath: 'id', indexes: [['destinationId', 'destinationId']] },
  { name: 'practicalInfo', keyPath: 'id', indexes: [['destinationId', 'destinationId']] },
  { name: 'weatherNotes', keyPath: 'id', indexes: [['destinationId', 'destinationId']] },
  { name: 'packingNotes', keyPath: 'id', indexes: [['destinationId', 'destinationId']] },
  { name: 'generalNotes', keyPath: 'id', indexes: [['destinationId', 'destinationId']] },
  { name: 'intakeDocuments', keyPath: 'id', indexes: [['destinationId', 'destinationId']] },
  {
    name: 'candidates',
    keyPath: 'id',
    indexes: [['intakeId', 'intakeId'], ['status', 'status'], ['destinationId', 'destinationId']],
  },
];

// The 9 stores that hold actual research entries (everything except
// destinations/sources/intakeDocuments/candidates, which are the shared
// building blocks, not sections themselves).
export const SECTION_STORES = [
  'attractions', 'restaurants', 'accommodations', 'transport',
  'costs', 'practicalInfo', 'weatherNotes', 'packingNotes', 'generalNotes',
];

let dbPromise = null;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const def of STORE_DEFS) {
        if (!db.objectStoreNames.contains(def.name)) {
          const store = db.createObjectStore(def.name, { keyPath: def.keyPath });
          for (const [indexName, keyPath] of def.indexes) {
            store.createIndex(indexName, keyPath, { unique: false });
          }
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database upgrade blocked by another open tab. Close other Dossier tabs and reload.'));
  });
}

// Singleton, memoized exactly like the old getDb() — opening is cheap
// here (no engine boot), but there's still no reason to reopen per call.
export async function getDb() {
  if (!dbPromise) dbPromise = openDatabase();
  return dbPromise;
}

// Test-only seam, mirrors the pattern from the previous Dossier's
// db/index.js — lets a test harness inject a fake-indexeddb instance.
export function __resetDbForTest() {
  dbPromise = null;
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function tx(storeNames, mode, fn) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, mode);
    const stores = Array.isArray(storeNames)
      ? Object.fromEntries(storeNames.map(name => [name, transaction.objectStore(name)]))
      : transaction.objectStore(storeNames);
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
    Promise.resolve(fn(stores)).then(r => { result = r; }).catch(reject);
  });
}

export async function getAll(storeName, indexName, indexValue) {
  return tx(storeName, 'readonly', (store) => {
    const source = indexName ? store.index(indexName) : store;
    return promisifyRequest(indexValue !== undefined ? source.getAll(indexValue) : source.getAll());
  });
}

export async function getOne(storeName, id) {
  return tx(storeName, 'readonly', (store) => promisifyRequest(store.get(id)));
}

export async function put(storeName, record) {
  return tx(storeName, 'readwrite', (store) => promisifyRequest(store.put(record)));
}

export async function remove(storeName, id) {
  return tx(storeName, 'readwrite', (store) => promisifyRequest(store.delete(id)));
}

export function newId() {
  return crypto.randomUUID();
}
