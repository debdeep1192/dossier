const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');
const { spawn } = require('child_process');

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function startBackend(port) {
  const backend = spawn('node', ['src/server.js'], {
    cwd: '/home/claude/travel-app/backend',
    env: {
      ...process.env,
      DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:55434/postgres',
      JWT_SECRET: 'test-secret-for-restart-verification',
      PORT: String(port),
    },
  });
  let ready = false;
  backend.stdout.on('data', d => { if (d.toString().includes('listening')) ready = true; });
  backend.stderr.on('data', d => process.stderr.write('SERVER ERR: ' + d));
  for (let i = 0; i < 30 && !ready; i++) await wait(300);
  await wait(300);
  return backend;
}

async function apiReq(port, method, url, body, cookieJar) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookieJar.value) headers['Cookie'] = cookieJar.value;
  const res = await fetch(`http://localhost:${port}/api${url}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookieJar.value = sc.split(';')[0];
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
  console.log('Starting persistent Postgres-wire-protocol database (simulating Neon, which stays up across backend restarts)...');
  const pglite = new PGlite(); // stays alive for the whole test — simulates Neon persisting independently of the backend process
  await pglite.waitReady;
  const socketServer = new PGLiteSocketServer({ db: pglite, port: 55434, host: '127.0.0.1' });
  await socketServer.start();

  console.log('\n--- Round 1: starting backend, creating data ---');
  let backend = await startBackend(4001);
  let cookieJar = { value: '' };

  let r = await apiReq(4001, 'POST', '/auth/setup', { email: 'restart-test@example.com', password: 'testpassword123' }, cookieJar);
  console.log('Setup:', r.status);
  if (r.status !== 201) throw new Error('Setup failed: ' + JSON.stringify(r.body));

  r = await apiReq(4001, 'POST', '/destinations', { name: 'Persistence Test Destination', overview: 'Should survive a restart.' }, cookieJar);
  console.log('Destination created:', r.status, r.body.destination?.id);
  const destId = r.body.destination.id;

  r = await apiReq(4001, 'POST', '/sections', { destinationId: destId, name: 'Attractions' }, cookieJar);
  const sectionId = r.body.section.id;

  r = await apiReq(4001, 'POST', '/research-items', {
    destinationId: destId, sectionId, itemKind: 'attraction', title: 'Persisted Attraction', priority: 'must_know',
  }, cookieJar);
  const itemId = r.body.item.id;
  console.log('Item created:', itemId);

  console.log('\n--- Stopping backend process (simulating a Render restart/redeploy) ---');
  backend.kill('SIGTERM');
  await wait(1500);

  console.log('\n--- Round 2: starting a FRESH backend process on the SAME database ---');
  backend = await startBackend(4002);
  let cookieJar2 = { value: '' };

  r = await apiReq(4002, 'POST', '/auth/login', { email: 'restart-test@example.com', password: 'testpassword123' }, cookieJar2);
  console.log('Login after restart:', r.status);
  if (r.status !== 200) throw new Error('Login failed after restart — owner account did not persist!');

  r = await apiReq(4002, 'GET', `/destinations/${destId}`, null, cookieJar2);
  console.log('Destination fetch after restart:', r.status);
  const survived = r.status === 200 && r.body.destination.name === 'Persistence Test Destination';
  const itemSurvived = r.body.items?.some(i => i.id === itemId && i.title === 'Persisted Attraction');

  console.log('\n=== RESULTS ===');
  console.log('Owner account survived restart:', r.status === 200 ? 'YES' : 'NO');
  console.log('Destination survived restart:', survived ? 'YES' : 'NO');
  console.log('Research item survived restart:', itemSurvived ? 'YES' : 'NO');

  backend.kill();
  await socketServer.stop();
  await wait(300);

  if (!survived || !itemSurvived) {
    console.error('\nFAILURE: data did not persist across backend restart.');
    process.exit(1);
  }
  console.log('\nSUCCESS: all data persisted correctly across a full backend process restart, using only the database connection — exactly how Render + Neon will behave.');
  process.exit(0);
}

main().catch(err => {
  console.error('PERSISTENCE TEST FAILED:', err);
  process.exit(1);
});
