// Verifies the production DB path (pg driver + DATABASE_URL) against a
// REAL Postgres wire-protocol server, not just PGlite's in-process API.
// This is the closest possible local proof that the Neon deployment path
// will work, without requiring an actual Neon account.

const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

async function main() {
  console.log('Starting a real Postgres-wire-protocol test server...');
  const pglite = new PGlite();
  await pglite.waitReady;
  const server = new PGLiteSocketServer({ db: pglite, port: 55432, host: '127.0.0.1' });
  await server.start();
  console.log('Wire-protocol server listening on 127.0.0.1:55432');

  process.env.DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:55432/postgres';

main().catch(err => {
  console.error('WIRE PROTOCOL TEST FAILED:', err);
  process.exit(1);
});
