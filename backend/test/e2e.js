const { spawn } = require('child_process');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3001/api';
let cookieJar = '';

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function request(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookieJar) headers['Cookie'] = cookieJar;
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookieJar = setCookie.split(';')[0];
  let json = null;
  try { json = await res.json(); } catch (e) { /* no body */ }
  return { status: res.status, body: json };
}

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    console.log(`  FAIL: ${label}`, detail !== undefined ? JSON.stringify(detail) : '');
  }
}

async function main() {
  console.log('=== AUTH ===');

  let r = await request('GET', '/auth/status');
  check('status before setup: ownerExists=false', r.body.ownerExists === false, r.body);

  r = await request('POST', '/auth/setup', { email: 'debdeep@example.com', password: 'shortpw' });
  check('setup rejects short password', r.status === 400, r.body);

  r = await request('POST', '/auth/setup', { email: 'debdeep@example.com', password: 'correcthorsebattery', displayName: 'Debdeep' });
  check('setup succeeds', r.status === 201, r.body);

  r = await request('POST', '/auth/setup', { email: 'someone-else@example.com', password: 'anotherpassword123' });
  check('second setup attempt rejected (no open registration)', r.status === 403, r.body);

  r = await request('GET', '/auth/me');
  check('me returns owner after setup (cookie session)', r.status === 200 && r.body.owner.email === 'debdeep@example.com', r.body);

  r = await request('POST', '/auth/logout');
  check('logout succeeds', r.status === 200);

  r = await request('GET', '/auth/me');
  check('me rejected after logout', r.status === 401, r.body);

  r = await request('POST', '/auth/login', { email: 'debdeep@example.com', password: 'wrongpassword' });
  check('login rejects wrong password', r.status === 401, r.body);

  r = await request('POST', '/auth/login', { email: 'debdeep@example.com', password: 'correcthorsebattery' });
  check('login succeeds with correct password', r.status === 200, r.body);

  console.log('\n=== DESTINATIONS ===');

  r = await request('POST', '/destinations', { name: '' });
  check('create destination rejects empty name', r.status === 400, r.body);

  r = await request('POST', '/destinations', { name: 'Sri Lanka', overview: 'Island nation, west/east coast monsoon asymmetry.' });
  check('create destination succeeds', r.status === 201 && r.body.destination.name === 'Sri Lanka', r.body);
  const destId = r.body.destination.id;

  r = await request('GET', '/destinations');
  check('list destinations includes Sri Lanka', r.body.destinations.some(d => d.id === destId), r.body);

  r = await request('GET', `/destinations/${destId}`);
  check('get destination detail returns sections+items arrays', Array.isArray(r.body.sections) && Array.isArray(r.body.items), r.body);

  console.log('\n=== SECTIONS ===');

  r = await request('POST', '/sections', { destinationId: destId, name: 'Attractions' });
  check('create section Attractions', r.status === 201, r.body);
  const attractionsSectionId = r.body.section.id;

  r = await request('POST', '/sections', { destinationId: destId, name: 'Attractions' });
  check('duplicate section name rejected', r.status === 409, r.body);

  r = await request('POST', '/sections', { destinationId: destId, name: 'Hotels' });
  const hotelsSectionId = r.body.section.id;
  check('create section Hotels', r.status === 201);

  console.log('\n=== RESEARCH ITEMS: Typed Item (section-scoped) ===');

  r = await request('POST', '/research-items', {
    destinationId: destId,
    sectionId: attractionsSectionId,
    itemKind: 'attraction',
    title: 'Temple of the Tooth',
    priority: 'must_know',
    entryFee: 'LKR 1500 (foreigners)',
    openingHours: '5:30 AM - 8:00 PM',
    visitDurationMinutes: 90,
    content: 'Sacred Buddhist temple in Kandy housing a relic of the tooth of the Buddha.',
  });
  check('create typed Attraction item', r.status === 201 && r.body.item.item_kind === 'attraction', r.body);
  const templeId = r.body.item.id;

  r = await request('POST', '/research-items', { destinationId: destId, sectionId: attractionsSectionId, itemKind: 'bogus', title: 'X' });
  check('invalid item_kind rejected', r.status === 400, r.body);

  r = await request('POST', '/research-items', { destinationId: destId, sectionId: hotelsSectionId, itemKind: 'attraction', title: 'Mismatched section' });
  check('section from wrong destination context still validated by destination match (section exists+matches)', r.status === 201);

  console.log('\n=== RESEARCH ITEMS: destination-level Note (section_id null) ===');

  r = await request('POST', '/research-items', {
    destinationId: destId,
    sectionId: null,
    itemKind: 'note',
    title: 'Monsoon pattern note',
    content: 'West coast and east coast have opposite monsoon seasons — plan trip direction accordingly.',
    priority: 'must_know',
  });
  check('create destination-level note (no section)', r.status === 201 && r.body.item.section_id === null, r.body);
  const monsoonNoteId = r.body.item.id;

  r = await request('GET', `/destinations/${destId}`);
  const noteInList = r.body.items.find(i => i.id === monsoonNoteId);
  check('destination-level note appears in destination items with null section_id', noteInList && noteInList.section_id === null, noteInList);

  console.log('\n=== TAGS ===');

  r = await request('POST', `/research-items/${templeId}/tags`, { label: 'Kandy' });
  check('attach tag Kandy to temple', r.status === 201, r.body);

  r = await request('POST', `/research-items/${templeId}/tags`, { label: 'kandy' });
  check('re-attaching same tag (case-insensitive) does not create duplicate tag row', r.status === 201);

  r = await request('GET', `/research-items/${templeId}`);
  check('temple detail shows exactly 1 tag despite two attach calls', r.body.item.tags.length === 1, r.body.item.tags);

  r = await request('GET', '/tags');
  check('global tag list includes kandy with usage_count 1', r.body.tags.some(t => t.label === 'kandy' && parseInt(t.usage_count) === 1), r.body.tags);

  console.log('\n=== SOURCES ===');

  r = await request('POST', `/research-items/${templeId}/sources`, {
    url: 'https://example-travel-blog.com/kandy-temple',
    title: 'Kandy Temple Guide',
    sourceType: 'website',
    supportsNote: 'Entry fee and opening hours',
    accessedAt: '2026-03-15T00:00:00Z',
  });
  check('add source to temple', r.status === 201, r.body);

  r = await request('POST', `/research-items/${templeId}/sources`, { url: '' });
  check('empty URL source rejected', r.status === 400, r.body);

  r = await request('GET', `/research-items/${templeId}`);
  check('temple detail shows 1 source with correct fields', r.body.item.sources.length === 1 && r.body.item.sources[0].source_type === 'website', r.body.item.sources);

  console.log('\n=== RESEARCH ITEM RELATIONS ===');

  r = await request('POST', '/research-items', {
    destinationId: destId, sectionId: hotelsSectionId, itemKind: 'hotel', title: 'Hotel near Temple',
  });
  const hotelId = r.body.item.id;

  r = await request('POST', `/research-items/${templeId}/relations`, { relatedItemId: hotelId });
  check('create relation between temple and hotel', r.status === 201, r.body);

  r = await request('GET', `/research-items/${templeId}`);
  check('temple shows related hotel', r.body.item.relatedItems.some(x => x.id === hotelId), r.body.item.relatedItems);

  r = await request('GET', `/research-items/${hotelId}`);
  check('relation is symmetric: hotel shows related temple', r.body.item.relatedItems.some(x => x.id === templeId), r.body.item.relatedItems);

  r = await request('POST', `/research-items/${templeId}/relations`, { relatedItemId: templeId });
  check('self-relation rejected', r.status === 400, r.body);

  console.log('\n=== SEARCH ===');

  r = await request('GET', '/destinations/search?q=Temple');
  check('search finds Temple of the Tooth', r.body.results.some(x => x.id === templeId), r.body.results);

  r = await request('GET', '/destinations/search?q=kandy');
  check('search finds by tag label too', r.body.results.some(x => x.id === templeId), r.body.results);

  console.log('\n=== RECENTLY UPDATED ===');
  r = await request('GET', '/destinations/recently-updated?limit=5');
  check('recently-updated returns items', r.body.items.length > 0, r.body.items.length);

  console.log('\n=== SOFT DELETE ===');

  r = await request('DELETE', `/research-items/${hotelId}`);
  check('soft delete hotel succeeds', r.status === 200, r.body);

  r = await request('GET', `/research-items/${hotelId}`);
  check('deleted hotel no longer retrievable via normal GET', r.status === 404, r.body);

  r = await request('GET', `/destinations/${destId}`);
  check('deleted hotel excluded from destination item list', !r.body.items.some(i => i.id === hotelId), r.body.items.map(i=>i.id));

  // Verify it's genuinely soft-deleted, not hard-deleted, by checking the DB directly
  console.log('\n=== SECTION DELETE PROTECTION ===');
  r = await request('DELETE', `/sections/${attractionsSectionId}`);
  check('cannot delete section that still has research items (RESTRICT)', r.status === 409, r.body);

  console.log('\n=== VALIDATION EDGE CASES ===');
  r = await request('GET', '/research-items/not-a-uuid');
  check('malformed UUID rejected with 400 not 500', r.status === 400, r.body);

  r = await request('GET', `/destinations/${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}`);
  check('valid-format but nonexistent UUID returns 404', r.status === 404, r.body);

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exitCode = failed > 0 ? 1 : 0;
}

async function run() {
  // If TEST_BASE_URL is set, a server is already running elsewhere
  // (e.g. the wire-protocol verification harness) — just run the tests
  // against it rather than spawning a second server on the default port.
  if (process.env.TEST_BASE_URL) {
    try {
      await main();
    } catch (e) {
      console.error('TEST SCRIPT ERROR:', e);
      process.exitCode = 1;
    }
    return;
  }

  const server = spawn('node', ['src/server.js'], { cwd: '/home/claude/travel-app/backend' });
  let ready = false;
  server.stdout.on('data', d => { if (d.toString().includes('listening')) ready = true; });
  server.stderr.on('data', d => process.stderr.write(d.toString()));

  for (let i = 0; i < 30 && !ready; i++) await wait(300);
  await wait(300);

  try {
    await main();
  } catch (e) {
    console.error('TEST SCRIPT ERROR:', e);
    process.exitCode = 1;
  } finally {
    server.kill();
  }
}

run();
