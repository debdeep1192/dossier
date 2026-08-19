const path = require('path');
const fs = require('fs');

// ============================================================
// Database adapter selection
//
// Production (and any environment with DATABASE_URL set, e.g. Render
// pointed at Neon): uses the standard 'pg' driver against a real,
// persistent, hosted PostgreSQL server. This is the only path that
// should ever be used for real data.
//
// Local development ONLY (no DATABASE_URL set): falls back to PGlite,
// a real Postgres engine embedded in-process with local file storage.
// This exists purely for convenience when developing without a Neon
// database at hand, and must never be relied on as a source of truth.
// Both paths expose the same minimal interface — query(sql, params)
// and exec(sql) — so no route/business logic code depends on which
// one is active.
// ============================================================

let dbInstance = null;

async function getDb() {
  if (dbInstance) return dbInstance;

  if (process.env.DATABASE_URL) {
    dbInstance = await createPgAdapter(process.env.DATABASE_URL);
  } else {
    console.warn(
      'No DATABASE_URL set — falling back to local PGlite for development only. ' +
      'This is NOT suitable for production data. Set DATABASE_URL to a real ' +
      'PostgreSQL connection string (e.g. from Neon) for any persistent deployment.'
    );
    dbInstance = await createPgliteAdapter();
  }

  return dbInstance;
}

async function createPgAdapter(connectionString) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString,
    // Neon (and most hosted Postgres providers) require TLS; reject
    // unauthorized is disabled here because Neon's pooled connection
    // string uses a certificate chain not always present in minimal
    // container images. This matches Neon's own documented Node.js
    // connection guidance.
    ssl: connectionString.includes('sslmode=require') || process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : undefined,
  });

  // Fail fast and loudly if the connection string is bad, rather than
  // deferring the error to the first request.
  await pool.query('SELECT 1');

  return {
    query: async (sql, params) => pool.query(sql, params),
    exec: async (sql) => { await pool.query(sql); },
  };
}

async function createPgliteAdapter() {
  const { PGlite } = require('@electric-sql/pglite');
  const DATA_DIR = path.join(__dirname, '../../data/pgdata');
  fs.mkdirSync(path.dirname(DATA_DIR), { recursive: true });
  const pg = new PGlite(DATA_DIR);
  await pg.waitReady;
  return {
    query: async (sql, params) => pg.query(sql, params),
    exec: async (sql) => { await pg.exec(sql); },
  };
}

module.exports = { getDb };
