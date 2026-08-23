import { PGliteWorker } from '@electric-sql/pglite/worker';
import schemaSql from './schema.sql?raw';
import { MIGRATIONS } from './migrations.js';

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

// Lightweight, version-tracked schema evolution — deliberately not a
// migration framework. schema_migrations holds one row per applied
// migration id; migrations.js is a plain ordered array of
// {id, up(pg)} steps. Two cases:
//   - Fresh database (no `destinations` table yet): run schema.sql as
//     one shot (fast, avoids replaying history that has no data to
//     protect yet), then mark every migration id in MIGRATIONS as
//     already-applied, since schema.sql already reflects their combined
//     result.
//   - Existing database (has `destinations` already, meaning it was
//     created by an earlier version of schema.sql): schema.sql is NOT
//     re-run (it has no IF NOT EXISTS guards and would error/duplicate).
//     Instead, schema_migrations is created if missing, and any
//     migration id not yet recorded there is applied in order via its
//     up(pg) step, then recorded. This is what actually protects
//     existing local data introduced before this mechanism existed —
//     the Phase 0 migration (see migrations.js) uses additive,
//     data-preserving ALTER/CREATE statements specifically so a
//     database created under the pre-Phase-0 schema gains the new
//     columns/tables/values without losing anything already stored.
async function ensureSchema(pg) {
  const check = await pg.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='destinations'"
  );
  const isFreshDatabase = check.rows.length === 0;

  await pg.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  if (isFreshDatabase) {
    await pg.exec(schemaSql);
    // schema.sql already reflects the end state of every migration in
    // MIGRATIONS, so mark them all applied without re-running their SQL
    // (re-running would error against objects schema.sql already made).
    for (const m of MIGRATIONS) {
      await pg.query('INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING', [m.id]);
    }
    return;
  }

  const appliedResult = await pg.query('SELECT id FROM schema_migrations');
  const applied = new Set(appliedResult.rows.map(r => r.id));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    await migration.up(pg);
    await pg.query('INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING', [migration.id]);
  }
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

// Test-only seam: runs the exact same fresh-vs-existing schema/migration
// logic getDb() uses, against a caller-supplied raw PGlite connection.
// Lets tests exercise ensureSchema()'s real behavior (not a re-implementation
// of it) against both a brand-new in-memory database and one pre-seeded
// with an older schema shape.
export async function __ensureSchemaForTest(pg) {
  return ensureSchema(pg);
}

// Exposed for the Import flow (§ replace-not-merge): drops and recreates
// every domain table so a restored backup starts from a clean, known
// state rather than merging with whatever was there before.
export async function resetSchema() {
  const pg = await getDb();
  // TRUNCATE ... CASCADE clears all data while preserving table structure,
  // constraints, and indexes exactly as defined in schema.sql — simpler
  // and safer than dropping/recreating tables, and avoids re-running DDL.
  // schema_migrations is deliberately excluded: it's bookkeeping about
  // which migrations have run, not restorable user data, and wiping it
  // would make ensureSchema() try to re-apply migrations against a
  // database that already has their effects — at best a no-op thanks to
  // the existence checks in migrations.js, at worst a confusing error.
  const tablesResult = await pg.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name != 'schema_migrations'"
  );
  const tableNames = tablesResult.rows.map(r => `"${r.table_name}"`).join(', ');
  if (tableNames) {
    await pg.exec(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE;`);
  }
}
