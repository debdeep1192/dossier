import { PGliteWorker } from '@electric-sql/pglite/worker';
import schemaSql from './schema.sql?raw';

// ============================================================
// Local-first database connection.
//
// This is the browser-side replacement for what used to be an HTTP call
// to a Node/Express backend. There is no server anymore: PGlite runs the
// actual Postgres engine inside a Web Worker in this browser tab, with
// data persisted to IndexedDB via the 'idb://dossier-data' data directory
// configured in pglite-worker.js. This module is the single place that
// knows how the database is reached — everything above it (the api/*.js
// modules the UI actually calls) is unchanged in shape from Phase 1,
// preserving the data-access abstraction seam intentionally, so this is
// the only layer that would need to change again for future sync work.
// ============================================================

let dbInstance = null;
let initPromise = null;

async function createConnection() {
  const pg = new PGliteWorker(
    new Worker(new URL('./pglite-worker.js', import.meta.url), { type: 'module' })
  );
  await pg.waitReady;
  return pg;
}

async function ensureSchema(pg) {
  // Idempotent: CREATE TABLE has no IF NOT EXISTS guard in the frozen
  // schema (matching the original migration exactly, unmodified), so we
  // check whether the schema has already been applied before running it,
  // rather than relying on error-swallowing.
  const check = await pg.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='destinations'"
  );
  if (check.rows.length > 0) return; // schema already present from a prior session

  await pg.exec(schemaSql);
}

export async function getDb() {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const pg = await createConnection();
    await ensureSchema(pg);
    dbInstance = {
      query: async (sql, params) => pg.query(sql, params),
      exec: async (sql) => pg.exec(sql),
    };
    return dbInstance;
  })();

  return initPromise;
}

// Test-only seam: lets a Node-side test harness inject a plain (non-worker)
// PGlite connection in place of the browser worker path, so the actual
// query/business logic in db/queries/*.js can be exercised with a real
// Postgres engine outside a browser. Never called by application code.
export function __setTestDb(db) {
  dbInstance = db;
  initPromise = Promise.resolve(db);
}

// Exposed for the Import flow (§ replace-not-merge): drops and recreates
// every domain table so a restored backup starts from a clean, known
// state rather than merging with whatever was there before.
export async function resetSchema() {
  const pg = await getDb();
  // TRUNCATE ... CASCADE clears all data while preserving table structure,
  // constraints, and indexes exactly as defined in schema.sql — simpler
  // and safer than dropping/recreating tables, and avoids re-running DDL.
  const tablesResult = await pg.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"
  );
  const tableNames = tablesResult.rows.map(r => `"${r.table_name}"`).join(', ');
  if (tableNames) {
    await pg.exec(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE;`);
  }
}
