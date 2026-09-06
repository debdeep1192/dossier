// Place lookup verification — src/lib/placeLookup.js.
//
// Every test here mocks `fetchImpl` directly; NONE of these tests
// touch the live Nominatim service. This is deliberate: the test
// suite must never depend on network access or a third-party
// service's availability/rate limits.
//
// Run with: npm run test:place-lookup (see package.json)

import assert from 'node:assert/strict';
import {
  buildContextualQuery,
  nameSimilarity,
  rankCandidates,
  lookupPlace,
  CATEGORY_HINTS,
  getCachedConfirmedResult,
  setCachedConfirmedResult,
} from '../../lib/placeLookup.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${e.stack}`);
  }
}

// A minimal in-memory Storage-like object for the confirmed-result
// cache tests, so they don't depend on a real localStorage (this is a
// plain Node process).
function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
  };
}

console.log('\n1. Contextual query construction');
await test('combines name, location, and destination with commas, in order', () => {
  const q = buildContextualQuery({ name: 'Ganesh Temple', locationName: 'Bangkok', destinationName: 'Thailand' });
  assert.equal(q, 'Ganesh Temple, Bangkok, Thailand');
});

await test('omits blank parts rather than leaving empty segments', () => {
  assert.equal(buildContextualQuery({ name: 'Batasia Loop', locationName: '', destinationName: 'India' }), 'Batasia Loop, India');
  assert.equal(buildContextualQuery({ name: 'Batasia Loop' }), 'Batasia Loop');
  assert.equal(buildContextualQuery({}), '');
});

await test('trims whitespace from each part', () => {
  assert.equal(buildContextualQuery({ name: '  Ganesh Temple  ', locationName: ' Bangkok ', destinationName: ' Thailand ' }), 'Ganesh Temple, Bangkok, Thailand');
});

console.log('\n2. Name similarity scoring');
await test('an exact name match scores 1', () => {
  assert.equal(nameSimilarity('Ganesh Temple', 'Ganesh Temple'), 1);
});

await test('a completely unrelated name scores 0', () => {
  assert.equal(nameSimilarity('Ganesh Temple', 'Central Railway Station'), 0);
});

await test('a partial word overlap scores between 0 and 1', () => {
  const score = nameSimilarity('Ganesh Temple Bangkok', 'Ganesh Temple Restaurant');
  assert.ok(score > 0 && score < 1, `expected a partial score, got ${score}`);
});

console.log('\n3. Candidate ranking — name match, location match, destination match, category plausibility, importance');
await test('ranking prefers the candidate with the closer name match', () => {
  const raw = [
    { name: 'Ganesh Restaurant', display_name: 'Ganesh Restaurant, Bangkok, Thailand', address: { city: 'Bangkok', country: 'Thailand' }, importance: 0.3 },
    { name: 'Ganesh Temple', display_name: 'Ganesh Temple, Bangkok, Thailand', address: { city: 'Bangkok', country: 'Thailand' }, importance: 0.3 },
  ];
  const ranked = rankCandidates(raw, { name: 'Ganesh Temple', locationName: 'Bangkok', destinationName: 'Thailand' });
  assert.equal(ranked[0].raw.name, 'Ganesh Temple', 'the exact name match should rank first despite identical location/importance');
});

await test('a matching current city/location improves ranking over an otherwise-similar candidate elsewhere', () => {
  const raw = [
    { name: 'Ganesh Temple', display_name: 'Ganesh Temple, Chiang Mai, Thailand', address: { city: 'Chiang Mai', country: 'Thailand' }, importance: 0.3 },
    { name: 'Ganesh Temple', display_name: 'Ganesh Temple, Bangkok, Thailand', address: { city: 'Bangkok', country: 'Thailand' }, importance: 0.3 },
  ];
  const ranked = rankCandidates(raw, { name: 'Ganesh Temple', locationName: 'Bangkok', destinationName: 'Thailand' });
  assert.equal(ranked[0].raw.address.city, 'Bangkok', 'the candidate actually in the current city should outrank an identically-named one elsewhere');
});

await test('a matching destination/country improves ranking when location is unknown', () => {
  const raw = [
    { name: 'Ganesh Temple', display_name: 'Ganesh Temple, Nepal', address: { country: 'Nepal' }, importance: 0.3 },
    { name: 'Ganesh Temple', display_name: 'Ganesh Temple, Thailand', address: { country: 'Thailand' }, importance: 0.3 },
  ];
  const ranked = rankCandidates(raw, { name: 'Ganesh Temple', destinationName: 'Thailand' });
  assert.equal(ranked[0].raw.address.country, 'Thailand');
});

await test('category plausibility nudges ranking when an expected category is provided', () => {
  const raw = [
    { name: 'Grand Palace Souvenirs', display_name: 'Grand Palace Souvenirs, Bangkok', address: { city: 'Bangkok' }, class: 'shop', importance: 0.35 },
    { name: 'Grand Palace', display_name: 'Grand Palace, Bangkok', address: { city: 'Bangkok' }, class: 'tourism', importance: 0.3 },
  ];
  const ranked = rankCandidates(raw, { name: 'Grand Palace', locationName: 'Bangkok', expectedCategory: CATEGORY_HINTS.attraction });
  assert.equal(ranked[0].raw.class, 'tourism', 'a tourism-classed result should be favored over a shop when an attraction is expected, all else being close');
});

await test('Nominatim importance acts only as a secondary tiebreaker, never overriding a clearly better name match', () => {
  const raw = [
    { name: 'Some Unrelated Landmark', display_name: 'Some Unrelated Landmark, Bangkok', address: { city: 'Bangkok' }, importance: 0.9 },
    { name: 'Ganesh Temple', display_name: 'Ganesh Temple, Bangkok', address: { city: 'Bangkok' }, importance: 0.1 },
  ];
  const ranked = rankCandidates(raw, { name: 'Ganesh Temple', locationName: 'Bangkok' });
  assert.equal(ranked[0].raw.name, 'Ganesh Temple', 'high importance alone must not beat a name match this decisive — importance is a secondary signal only');
});

await test('ranking never uses or references review counts, ratings, or popularity — the raw candidate shape has none, and scoring never fabricates any', () => {
  const raw = [{ name: 'Ganesh Temple', display_name: 'Ganesh Temple, Bangkok', address: { city: 'Bangkok' }, importance: 0.3 }];
  const ranked = rankCandidates(raw, { name: 'Ganesh Temple', locationName: 'Bangkok' });
  assert.equal(ranked[0].raw.rating, undefined);
  assert.equal(ranked[0].raw.reviewCount, undefined);
  assert.ok(!('rating' in ranked[0]) && !('reviewCount' in ranked[0]) && !('popularity' in ranked[0]));
});

console.log('\n4. lookupPlace() — network behaviour, all via a mocked fetchImpl');
function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

await test('a successful lookup returns ranked candidates and no error', async () => {
  const raw = [
    { name: 'Ganesh Temple', display_name: 'Ganesh Temple, Bangkok, Thailand', address: { city: 'Bangkok', country: 'Thailand' }, importance: 0.4, lat: '13.75', lon: '100.5' },
  ];
  const fetchImpl = async (url) => {
    assert.ok(url.includes('format=jsonv2'), 'must request jsonv2 format');
    assert.ok(url.includes('addressdetails=1'), 'must request address details');
    assert.ok(url.includes(encodeURIComponent('Ganesh Temple')), 'query must include the place name');
    assert.ok(url.includes(encodeURIComponent('Bangkok')), 'query must include the city context');
    assert.ok(url.includes(encodeURIComponent('Thailand')), 'query must include the destination context');
    return jsonResponse(raw);
  };
  const { candidates, error } = await lookupPlace(
    { name: 'Ganesh Temple', locationName: 'Bangkok', destinationName: 'Thailand' },
    { fetchImpl, now: () => 100000 },
  );
  assert.equal(error, null);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].raw.name, 'Ganesh Temple');
});

await test('a limit parameter of roughly 3-5 is requested (spec: "around 3-5")', async () => {
  let capturedUrl = '';
  const fetchImpl = async (url) => { capturedUrl = url; return jsonResponse([]); };
  await lookupPlace({ name: 'Test Place' }, { fetchImpl, now: () => 200000 });
  const limitMatch = capturedUrl.match(/limit=(\d+)/);
  assert.ok(limitMatch, 'URL must include a limit parameter');
  const limit = parseInt(limitMatch[1], 10);
  assert.ok(limit >= 3 && limit <= 5, `expected limit between 3 and 5, got ${limit}`);
});

await test('a zero-result response is not treated as an error', async () => {
  const fetchImpl = async () => jsonResponse([]);
  const { candidates, error } = await lookupPlace({ name: 'Totally Obscure Place Name Xyzzy' }, { fetchImpl, now: () => 300000 });
  assert.deepEqual(candidates, []);
  assert.equal(error, null, 'zero results is a normal outcome, not an error');
});

await test('a network failure (fetch throws) resolves to a graceful error, never throws', async () => {
  const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  const { candidates, error } = await lookupPlace({ name: 'Ganesh Temple' }, { fetchImpl, now: () => 400000 });
  assert.deepEqual(candidates, []);
  assert.ok(error && error.length > 0, 'a network failure must produce a user-facing message, not an unhandled rejection');
  assert.ok(/manually/i.test(error), 'the error message should reassure the person manual entry still works');
});

await test('a non-2xx HTTP response resolves to a graceful error', async () => {
  const fetchImpl = async () => jsonResponse({}, { ok: false, status: 503 });
  const { candidates, error } = await lookupPlace({ name: 'Ganesh Temple' }, { fetchImpl, now: () => 500000 });
  assert.deepEqual(candidates, []);
  assert.ok(error);
});

await test('a malformed (non-array) response body resolves to a graceful error rather than crashing', async () => {
  const fetchImpl = async () => jsonResponse({ unexpected: 'shape' });
  const { candidates, error } = await lookupPlace({ name: 'Ganesh Temple' }, { fetchImpl, now: () => 600000 });
  assert.deepEqual(candidates, []);
  assert.ok(error);
});

await test('a response body that is not valid JSON resolves to a graceful error rather than crashing', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token'); } });
  const { candidates, error } = await lookupPlace({ name: 'Ganesh Temple' }, { fetchImpl, now: () => 700000 });
  assert.deepEqual(candidates, []);
  assert.ok(error);
});

await test('an aborted/timed-out request resolves to a graceful, distinct "timed out" error', async () => {
  const fetchImpl = async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  };
  const { candidates, error } = await lookupPlace({ name: 'Ganesh Temple' }, { fetchImpl, now: () => 800000 });
  assert.deepEqual(candidates, []);
  assert.ok(/timed out/i.test(error), `expected a timeout-specific message, got: ${error}`);
});

await test('a missing/blank name never reaches the network at all', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return jsonResponse([]); };
  const { candidates, error } = await lookupPlace({ name: '' }, { fetchImpl, now: () => 900000 });
  assert.equal(called, false, 'no network request should be made for an empty name');
  assert.deepEqual(candidates, []);
  assert.ok(error);
});

await test('rapid repeated calls are throttled without requiring a live network wait in the test', async () => {
  let callCount = 0;
  const fetchImpl = async () => { callCount++; return jsonResponse([]); };
  let clock = 1000000;
  const now = () => clock;

  await lookupPlace({ name: 'Ganesh Temple' }, { fetchImpl, now });
  assert.equal(callCount, 1);

  // Immediately again, same virtual instant — should be throttled and
  // never reach fetchImpl a second time.
  const second = await lookupPlace({ name: 'Ganesh Temple' }, { fetchImpl, now });
  assert.equal(callCount, 1, 'a second call within the throttle window must not hit the network');
  assert.ok(second.error, 'the throttled call should surface a message, not silently no-op');

  // Advance the virtual clock past the throttle window — should be allowed through.
  clock += 5000;
  await lookupPlace({ name: 'Ganesh Temple' }, { fetchImpl, now });
  assert.equal(callCount, 2, 'a call after the throttle window has passed should reach the network');
});

console.log('\n5. Confirmed-result local cache');
await test('a confirmed result can be cached and retrieved for the exact same name+context', () => {
  const storage = makeMemoryStorage();
  const place = { name: 'Ganesh Temple', locality: 'Sukhumvit', city: 'Bangkok', lat: 13.75, lng: 100.5 };
  setCachedConfirmedResult({ name: 'Ganesh Temple', locationName: 'Bangkok', destinationName: 'Thailand' }, place, { storage });
  const cached = getCachedConfirmedResult({ name: 'Ganesh Temple', locationName: 'Bangkok', destinationName: 'Thailand' }, { storage });
  assert.deepEqual(cached, place);
});

await test('a cache miss (different name/context) returns null, not a stale/wrong result', () => {
  const storage = makeMemoryStorage();
  setCachedConfirmedResult({ name: 'Ganesh Temple', locationName: 'Bangkok', destinationName: 'Thailand' }, { name: 'Ganesh Temple' }, { storage });
  const miss = getCachedConfirmedResult({ name: 'Tiger Hill', locationName: 'Darjeeling', destinationName: 'India' }, { storage });
  assert.equal(miss, null);
});

await test('reading the cache with no storage available (e.g. sandboxed context) fails gracefully to null', () => {
  const cached = getCachedConfirmedResult({ name: 'Ganesh Temple' }, { storage: null });
  assert.equal(cached, null);
});

await test('writing to the cache with no storage available never throws', () => {
  assert.doesNotThrow(() => setCachedConfirmedResult({ name: 'Ganesh Temple' }, { name: 'Ganesh Temple' }, { storage: null }));
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
