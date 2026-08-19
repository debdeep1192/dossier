const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');
const { spawn } = require('child_process');

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('Starting real Postgres-wire-protocol server on 127.0.0.1:55433...');
  const pglite = new PGlite();
  await pglite.waitReady;
  const socketServer = new PGLiteSocketServer({ db: pglite, port: 55433, host: '127.0.0.1' });
  await socketServer.start();

  console.log('Starting backend server with DATABASE_URL pointed at it (production code path)...');
  const backend = spawn('node', ['src/server.js'], {
    cwd: '/home/claude/travel-app/backend',
    env: {
      ...process.env,
      DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:55433/postgres',
      JWT_SECRET: 'test-secret-for-wire-protocol-verification',
      PORT: '3099',
    },
  });

  let ready = false;
  let usedPglite = false;
  backend.stdout.on('data', d => {
    const s = d.toString();
    process.stdout.write('SERVER: ' + s);
    if (s.includes('listening')) ready = true;
  });
  backend.stderr.on('data', d => {
    const s = d.toString();
    process.stderr.write('SERVER ERR: ' + s);
    if (s.includes('falling back to local PGlite')) usedPglite = true;
  });

  for (let i = 0; i < 30 && !ready; i++) await wait(300);
  await wait(300);

  if (usedPglite) {
    console.error('\nFAILURE: server fell back to local PGlite instead of using DATABASE_URL. The pg driver path was NOT exercised.');
    backend.kill();
    process.exit(1);
  }
  console.log('\nBackend confirmed running on the pg driver / DATABASE_URL path (not PGlite fallback).\n');

  // Run the existing 41-test suite against this server, on the alternate port
  const testProc = spawn('node', ['test/e2e.js'], {
    cwd: '/home/claude/travel-app/backend',
    env: { ...process.env, TEST_BASE_URL: 'http://localhost:3099/api' },
  });
  let out = '';
  testProc.stdout.on('data', d => { out += d; process.stdout.write(d); });
  testProc.stderr.on('data', d => process.stderr.write(d));

  const exitCode = await new Promise(resolve => testProc.on('close', resolve));

  backend.kill();
  await socketServer.stop();
  await wait(300);

  process.exit(exitCode);
}

main().catch(err => {
  console.error('WIRE PROTOCOL FULL-SUITE TEST FAILED:', err);
  process.exit(1);
});
