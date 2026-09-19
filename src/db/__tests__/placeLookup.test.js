// Place lookup verification — src/lib/placeLookup.js.
//
// Every test here mocks `fetchImpl` directly; NONE of these tests
// touch the live Wikidata or Nominatim services. This is deliberate:
// the automated test suite must never depend on network access or a
// third-party service's availability/rate limits.
//
// Fixture data below is based on real, researched facts (verified via
// web search during implementation, not fabricated) about the actual
// entities involved — in particular the Wikidata entity for the
// "Temple of the Sacred Tooth Relic" (Q289175, coordinates roughly
// 7.294 N 80.641 E in Kandy, Sri Lanka), which has "Sacred Tooth
// Temple" as a known alias. This is FIXTURE/UNIT verification, not
// live API verification — see DOSSIER_HANDOVER.md for what could and
// could not be confirmed against the actual running services.
//
// Run with: npm run test:place-lookup (see package.json)

import assert from 'node:assert/strict';
import {
  buildContextualQuery,
  buildFallbackNames,
  buildConfirmedPlace,
  nameSimilarity,
  rankCandidates,
  mergeCandidates,
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

function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
  };
}

// Helpers building already-normalized candidates directly (bypassing
// the network layer), for tests that exercise rankCandidates()/
// mergeCandidates() in isolation from lookupPlace()'s fetch orchestration.
function nomCandidate({ name, city = '', country = '', osmClass = null, importance = 0, lat = null, lng = null }) {
  return { source: 'nominatim', raw: { name }, name, displayName: `${name}, ${city}, ${country}`.replace(/^, |, $/g, ''), lat, lng, addressCity: city, addressCountry: country, osmClass, importance };
}
function wdCandidate({ name, lat = null, lng = null }) {
  return { source: 'wikidata', raw: { label: name }, name, displayName: name, lat, lng, addressCity: '', addressCountry: '', osmClass: null, importance: 0 };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

// A realistic Nominatim raw result shape, for tests that go through
// fetchImpl (and therefore normalizeNominatimResult) rather than
// building already-normalized candidates directly.
function rawNominatim({ name, city = '', country = '', osmClass = null, importance = 0.3, lat = '0', lon = '0' }) {
  return { name, display_name: `${name}, ${city}, ${country}`.replace(/^, |, $/g, ''), address: { city, country }, class: osmClass, importance, lat, lon };
}

// A realistic Wikidata wbsearchentities hit + the corresponding
// wbgetentities entity payload, matching the real documented API
// response shapes.
function wikidataFixture({ id, matchedLabel, canonicalLabel, description, lat, lng }) {
  const hit = { id, label: matchedLabel, description };
  const entity = {
    labels: { en: { value: canonicalLabel } },
    descriptions: { en: { value: description } },
    claims: lat != null ? { P625: [{ mainsnak: { datavalue: { value: { latitude: lat, longitude: lng } } } }] } : {},
  };
  return { hit, entity };
}

function mockBothSources({ nominatimResults = [], wikidataHits = [], wikidataEntities = {} } = {}) {
  return async (url) => {
    if (url.includes('nominatim')) return jsonResponse(nominatimResults);
    if (url.includes('wbsearchentities')) return jsonResponse({ search: wikidataHits });
    if (url.includes('wbgetentities')) return jsonResponse({ entities: wikidataEntities });
    throw new Error(`Unexpected URL in test: ${url}`);
  };
}

// A query-aware mock, for tests that need DIFFERENT responses
// depending on which exact `q=`/`search=` string a request used — in
// particular, verifying the fallback-retry behavior actually sends a
// shortened query and stops as soon as any real candidates come back,
// rather than just checking the final merged result. `responses` maps
// an exact search string (decoded) to { nominatimResults, wikidataHits,
// wikidataEntities } for that specific attempt; an unlisted string
// resolves to all-empty (a genuine zero-result attempt), matching how
// the real providers behave for a query with no indexed match.
function mockQueryAware(responses) {
  return async (url) => {
    const parsed = new URL(url);
    if (url.includes('nominatim')) {
      const q = parsed.searchParams.get('q');
      return jsonResponse(responses[q]?.nominatimResults || []);
    }
    if (url.includes('wbsearchentities')) {
      const search = parsed.searchParams.get('search');
      return jsonResponse({ search: responses[search]?.wikidataHits || [] });
    }
    if (url.includes('wbgetentities')) {
      // Every attempt's wikidataEntities get merged in — wbgetentities
      // is only ever called with ids that came from THIS attempt's own
      // wbsearchentities hits, so there's no cross-attempt ambiguity.
      const merged = Object.assign({}, ...Object.values(responses).map(r => r.wikidataEntities || {}));
      return jsonResponse({ entities: merged });
    }
    throw new Error(`Unexpected URL in test: ${url}`);
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

await test('a city and destination sharing the same name are not duplicated in the query (the Darjeeling/Darjeeling bug)', () => {
  const q = buildContextualQuery({ name: "Glenary's", locationName: 'Darjeeling', destinationName: 'Darjeeling' });
  assert.equal(q, "Glenary's, Darjeeling", 'the destination should not repeat a city name it already matches');
});

await test('deduplication is case-insensitive', () => {
  const q = buildContextualQuery({ name: 'Tiger Hill', locationName: 'darjeeling', destinationName: 'Darjeeling' });
  assert.equal(q, 'Tiger Hill, darjeeling', 'the FIRST occurrence\'s casing is kept, the later duplicate is dropped');
});

await test('a genuinely different city and destination are both kept (no over-eager deduplication)', () => {
  const q = buildContextualQuery({ name: 'Wat Pho', locationName: 'Bangkok', destinationName: 'Thailand' });
  assert.equal(q, 'Wat Pho, Bangkok, Thailand');
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

await test('an apostrophe does not split a name into spurious extra tokens (Glenary\'s vs Glenarys)', () => {
  assert.equal(nameSimilarity('Glenarys', "Glenary's"), 1);
});

await test('apostrophe handling is case-insensitive', () => {
  assert.equal(nameSimilarity("GLENARY'S", 'glenarys'), 1);
});

await test('a curly/typographic apostrophe is handled the same as a straight one', () => {
  assert.equal(nameSimilarity('Glenary\u2019s', 'Glenarys'), 1);
});

await test('an internal period in an abbreviation does not block a match (St. Joseph\'s vs St Josephs)', () => {
  assert.equal(nameSimilarity("St. Joseph's", 'St Josephs'), 1);
});

await test('hyphens still separate words as before (unchanged behavior)', () => {
  assert.equal(nameSimilarity('Xi-An', 'Xi An'), 1);
});

await test('repeated/extra whitespace still collapses as before (unchanged behavior)', () => {
  assert.equal(nameSimilarity('Foo  Bar', 'Foo Bar'), 1);
});

console.log('\n3. Candidate ranking — works uniformly on already-normalized candidates from either source');
await test('ranking prefers the candidate with the closer name match', () => {
  const candidates = [
    nomCandidate({ name: 'Ganesh Restaurant', city: 'Bangkok', country: 'Thailand', importance: 0.3 }),
    nomCandidate({ name: 'Ganesh Temple', city: 'Bangkok', country: 'Thailand', importance: 0.3 }),
  ];
  const ranked = rankCandidates(candidates, { name: 'Ganesh Temple', locationName: 'Bangkok', destinationName: 'Thailand' });
  assert.equal(ranked[0].name, 'Ganesh Temple', 'the exact name match should rank first despite identical location/importance');
});

await test('a matching current city/location improves ranking over an otherwise-similar candidate elsewhere', () => {
  const candidates = [
    nomCandidate({ name: 'Ganesh Temple', city: 'Chiang Mai', country: 'Thailand', importance: 0.3 }),
    nomCandidate({ name: 'Ganesh Temple', city: 'Bangkok', country: 'Thailand', importance: 0.3 }),
  ];
  const ranked = rankCandidates(candidates, { name: 'Ganesh Temple', locationName: 'Bangkok', destinationName: 'Thailand' });
  assert.equal(ranked[0].addressCity, 'Bangkok', 'the candidate actually in the current city should outrank an identically-named one elsewhere');
});

await test('a matching destination/country improves ranking when location is unknown', () => {
  const candidates = [
    nomCandidate({ name: 'Ganesh Temple', country: 'Nepal', importance: 0.3 }),
    nomCandidate({ name: 'Ganesh Temple', country: 'Thailand', importance: 0.3 }),
  ];
  const ranked = rankCandidates(candidates, { name: 'Ganesh Temple', destinationName: 'Thailand' });
  assert.equal(ranked[0].addressCountry, 'Thailand');
});

await test('category plausibility nudges ranking when an expected category is provided', () => {
  const candidates = [
    nomCandidate({ name: 'Grand Palace Souvenirs', city: 'Bangkok', osmClass: 'shop', importance: 0.35 }),
    nomCandidate({ name: 'Grand Palace', city: 'Bangkok', osmClass: 'tourism', importance: 0.3 }),
  ];
  const ranked = rankCandidates(candidates, { name: 'Grand Palace', locationName: 'Bangkok', expectedCategory: CATEGORY_HINTS.attraction });
  assert.equal(ranked[0].osmClass, 'tourism', 'a tourism-classed result should be favored over a shop when an attraction is expected, all else being close');
});

await test('Nominatim importance acts only as a secondary tiebreaker, never overriding a clearly better name match', () => {
  const candidates = [
    nomCandidate({ name: 'Some Unrelated Landmark', city: 'Bangkok', importance: 0.9 }),
    nomCandidate({ name: 'Ganesh Temple', city: 'Bangkok', importance: 0.1 }),
  ];
  const ranked = rankCandidates(candidates, { name: 'Ganesh Temple', locationName: 'Bangkok' });
  assert.equal(ranked[0].name, 'Ganesh Temple', 'high importance alone must not beat a name match this decisive — importance is a secondary signal only');
});

await test('ranking never uses or references review counts, ratings, or popularity', () => {
  const candidates = [nomCandidate({ name: 'Ganesh Temple', city: 'Bangkok', importance: 0.3 })];
  const ranked = rankCandidates(candidates, { name: 'Ganesh Temple', locationName: 'Bangkok' });
  assert.ok(!('rating' in ranked[0]) && !('reviewCount' in ranked[0]) && !('popularity' in ranked[0]));
});

console.log('\n3b. Ranking — Wikidata candidates scored by the SAME formula, never auto-boosted for existing');
await test('a Wikidata candidate with a poor name/location match ranks below a Nominatim candidate with a good one', () => {
  const candidates = [
    wdCandidate({ name: 'Ganesh Temple', lat: 27.7, lng: 85.3 }),
    nomCandidate({ name: 'Ganesh Temple', city: 'Bangkok', country: 'Thailand', importance: 0.2 }),
  ];
  const ranked = rankCandidates(candidates, { name: 'Ganesh Temple', locationName: 'Bangkok', destinationName: 'Thailand' });
  assert.equal(ranked[0].source, 'nominatim', 'a Wikidata hit existing is not enough — it must actually match location/destination to outrank a well-matched Nominatim result');
});

await test('a Wikidata candidate with a strong alias match CAN legitimately outrank a weak Nominatim match, on its own merits', () => {
  const candidates = [
    wdCandidate({ name: 'Temple of the Sacred Tooth Relic' }),
    nomCandidate({ name: 'Unrelated Cafe', city: 'Kandy', country: 'Sri Lanka', importance: 0.1 }),
  ];
  const ranked = rankCandidates(candidates, { name: 'Sacred Tooth Temple' });
  assert.equal(ranked[0].source, 'wikidata', 'a strong name match legitimately wins on its own score, not because it came from Wikidata');
});

console.log('\n4. Candidate merging and deduplication');
await test('the same real place found by both sources (close coordinates, similar name) is deduplicated to one entry', () => {
  const wikidata = [wdCandidate({ name: 'Temple of the Sacred Tooth Relic', lat: 7.2936, lng: 80.6413 })];
  const nominatim = [nomCandidate({ name: 'Sri Dalada Maligawa', city: 'Kandy', country: 'Sri Lanka', lat: 7.2937, lng: 80.6412, importance: 0.5 })];
  const merged = mergeCandidates(wikidata, nominatim);
  assert.equal(merged.length, 1, 'two results within ~1km of each other with overlapping names should merge to one');
  assert.equal(merged[0].source, 'nominatim', 'the kept version should be the one with fuller structured address data (Nominatim), for display purposes');
});

await test('two genuinely different places with a similar name are NOT merged', () => {
  const wikidata = [wdCandidate({ name: 'Ganesh Temple', lat: 27.7, lng: 85.3 })];
  const nominatim = [nomCandidate({ name: 'Ganesh Temple', city: 'Bangkok', country: 'Thailand', lat: 13.75, lng: 100.5, importance: 0.2 })];
  const merged = mergeCandidates(wikidata, nominatim);
  assert.equal(merged.length, 2, 'candidates thousands of km apart must never be merged just because the names overlap');
});

await test('a Wikidata result with no coordinates and no strong name match is NOT merged away', () => {
  const wikidata = [wdCandidate({ name: 'Some Obscure Shrine' })];
  const nominatim = [nomCandidate({ name: 'Completely Different Place', city: 'Kandy', importance: 0.3 })];
  const merged = mergeCandidates(wikidata, nominatim);
  assert.equal(merged.length, 2);
});

console.log('\n5. lookupPlace() — merged Wikidata + Nominatim network behaviour, all via a mocked fetchImpl');

await test('the "Sacred Tooth Temple" / Kandy scenario: Wikidata alias matching surfaces the correct entity', async () => {
  const { hit, entity } = wikidataFixture({
    id: 'Q289175', matchedLabel: 'Sacred Tooth Temple', canonicalLabel: 'Temple of the Sacred Tooth Relic',
    description: 'Buddhist temple in Kandy, Sri Lanka', lat: 7.2936, lng: 80.6413,
  });
  const fetchImpl = mockBothSources({ nominatimResults: [], wikidataHits: [hit], wikidataEntities: { Q289175: entity } });
  const { candidates, error } = await lookupPlace(
    { name: 'Sacred Tooth Temple', locationName: 'Kandy', destinationName: 'Sri Lanka' },
    { fetchImpl, now: () => 1000000 },
  );
  assert.equal(error, null);
  assert.ok(candidates.length >= 1, 'the Wikidata alias match should surface a candidate even when Nominatim alone found nothing');
  assert.equal(candidates[0].source, 'wikidata');
  assert.equal(candidates[0].lat, 7.2936, 'coordinates from Wikidata are carried through for use on the map');
});

await test('an ambiguous attraction name: city context correctly promotes the candidate actually in that city', async () => {
  const fetchImpl = mockBothSources({
    nominatimResults: [
      rawNominatim({ name: 'White Temple', city: 'Chiang Mai', country: 'Thailand', importance: 0.4 }),
      rawNominatim({ name: 'White Temple', city: 'Chiang Rai', country: 'Thailand', importance: 0.35 }),
    ],
  });
  const { candidates } = await lookupPlace(
    { name: 'White Temple', locationName: 'Chiang Rai', destinationName: 'Thailand' },
    { fetchImpl, now: () => 1100000 },
  );
  assert.equal(candidates[0].addressCity, 'Chiang Rai', 'the destination context must promote the candidate actually located there, even though the other has higher importance');
});

await test('a restaurant with a common name: category + city context together identify the right one', async () => {
  const fetchImpl = mockBothSources({
    nominatimResults: [
      rawNominatim({ name: 'The Local', city: 'Colombo', country: 'Sri Lanka', osmClass: 'amenity', importance: 0.3 }),
      rawNominatim({ name: 'The Local', city: 'Auckland', country: 'New Zealand', osmClass: 'amenity', importance: 0.6 }),
    ],
  });
  const { candidates } = await lookupPlace(
    { name: 'The Local', locationName: 'Colombo', destinationName: 'Sri Lanka', expectedCategory: CATEGORY_HINTS.restaurant },
    { fetchImpl, now: () => 1200000 },
  );
  assert.equal(candidates[0].addressCity, 'Colombo', 'the current destination/city context must win over raw importance for a common restaurant name in an unrelated country');
});

await test('a Wikidata alias differs from what Nominatim calls the same place: both are found, correctly deduplicated', async () => {
  const { hit, entity } = wikidataFixture({
    id: 'Q289175', matchedLabel: 'Temple of the Tooth', canonicalLabel: 'Temple of the Sacred Tooth Relic',
    description: 'Buddhist temple', lat: 7.2936, lng: 80.6413,
  });
  const fetchImpl = mockBothSources({
    nominatimResults: [rawNominatim({ name: 'Sri Dalada Maligawa', city: 'Kandy', country: 'Sri Lanka', importance: 0.5, lat: '7.2937', lon: '80.6412' })],
    wikidataHits: [hit], wikidataEntities: { Q289175: entity },
  });
  const { candidates } = await lookupPlace(
    { name: 'Temple of the Tooth', locationName: 'Kandy', destinationName: 'Sri Lanka' },
    { fetchImpl, now: () => 1300000 },
  );
  assert.equal(candidates.length, 1, 'the Wikidata and Nominatim results for the same real place should merge into one candidate, not appear twice');
  assert.equal(candidates[0].addressCity, 'Kandy', 'the merged candidate keeps the fuller Nominatim address data for display');
});

await test('a wrong-city candidate never outranks a geographically appropriate one just because it came from Wikidata', async () => {
  const { hit, entity } = wikidataFixture({
    id: 'Q999999', matchedLabel: 'Ganesh Temple', canonicalLabel: 'Ganesh Temple', description: 'A temple somewhere else entirely', lat: 27.7, lng: 85.3,
  });
  const fetchImpl = mockBothSources({
    nominatimResults: [rawNominatim({ name: 'Ganesh Temple', city: 'Bangkok', country: 'Thailand', importance: 0.2 })],
    wikidataHits: [hit], wikidataEntities: { Q999999: entity },
  });
  const { candidates } = await lookupPlace(
    { name: 'Ganesh Temple', locationName: 'Bangkok', destinationName: 'Thailand' },
    { fetchImpl, now: () => 1400000 },
  );
  assert.equal(candidates[0].addressCity, 'Bangkok', 'the Nominatim candidate actually in the requested city must rank first, even though a same-named Wikidata entity also exists elsewhere');
});

await test('when only Wikidata fails but Nominatim succeeds, useful candidates are still returned', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('nominatim')) return jsonResponse([rawNominatim({ name: 'Galle Fort', city: 'Galle', country: 'Sri Lanka', importance: 0.6 })]);
    throw new TypeError('Wikidata unreachable');
  };
  const { candidates, error } = await lookupPlace({ name: 'Galle Fort', locationName: 'Galle', destinationName: 'Sri Lanka' }, { fetchImpl, now: () => 1500000 });
  assert.equal(error, null);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].source, 'nominatim');
});

await test('when only Nominatim fails but Wikidata succeeds, useful candidates are still returned', async () => {
  const { hit, entity } = wikidataFixture({ id: 'Q1', matchedLabel: 'Sigiriya', canonicalLabel: 'Sigiriya', description: 'Ancient rock fortress', lat: 7.957, lng: 80.76 });
  const fetchImpl = async (url) => {
    if (url.includes('wbsearchentities')) return jsonResponse({ search: [hit] });
    if (url.includes('wbgetentities')) return jsonResponse({ entities: { Q1: entity } });
    throw new TypeError('Nominatim unreachable');
  };
  const { candidates, error } = await lookupPlace({ name: 'Sigiriya', destinationName: 'Sri Lanka' }, { fetchImpl, now: () => 1600000 });
  assert.equal(error, null);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].source, 'wikidata');
});

await test('when BOTH sources fail (network errors), a graceful error is returned and manual entry remains available', async () => {
  const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  const { candidates, error } = await lookupPlace({ name: 'Ganesh Temple' }, { fetchImpl, now: () => 1700000 });
  assert.deepEqual(candidates, []);
  assert.ok(error && /manually/i.test(error));
});

await test('when BOTH sources genuinely return zero results, that is not an error, just an empty outcome', async () => {
  const fetchImpl = mockBothSources({});
  const { candidates, error } = await lookupPlace({ name: 'Totally Obscure Place Xyzzy' }, { fetchImpl, now: () => 1800000 });
  assert.deepEqual(candidates, []);
  assert.equal(error, null);
});

await test('a non-2xx Nominatim response combined with a working Wikidata still yields candidates', async () => {
  const { hit, entity } = wikidataFixture({ id: 'Q2', matchedLabel: 'Test Place', canonicalLabel: 'Test Place', description: '', lat: 1, lng: 1 });
  const fetchImpl = async (url) => {
    if (url.includes('nominatim')) return jsonResponse({}, { ok: false, status: 503 });
    if (url.includes('wbsearchentities')) return jsonResponse({ search: [hit] });
    if (url.includes('wbgetentities')) return jsonResponse({ entities: { Q2: entity } });
  };
  const { candidates, error } = await lookupPlace({ name: 'Test Place' }, { fetchImpl, now: () => 1900000 });
  assert.equal(error, null);
  assert.equal(candidates.length, 1);
});

await test('a malformed (non-array) Nominatim body combined with a working Wikidata still yields candidates', async () => {
  const { hit, entity } = wikidataFixture({ id: 'Q3', matchedLabel: 'Test Place 2', canonicalLabel: 'Test Place 2', description: '', lat: 1, lng: 1 });
  const fetchImpl = async (url) => {
    if (url.includes('nominatim')) return jsonResponse({ unexpected: 'shape' });
    if (url.includes('wbsearchentities')) return jsonResponse({ search: [hit] });
    if (url.includes('wbgetentities')) return jsonResponse({ entities: { Q3: entity } });
  };
  const { candidates, error } = await lookupPlace({ name: 'Test Place 2' }, { fetchImpl, now: () => 2000000 });
  assert.equal(error, null);
  assert.equal(candidates.length, 1);
});

await test('an aborted/timed-out request (both sources) resolves to a graceful, distinct "timed out" error', async () => {
  const fetchImpl = async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  };
  const { candidates, error } = await lookupPlace({ name: 'Ganesh Temple' }, { fetchImpl, now: () => 2100000 });
  assert.deepEqual(candidates, []);
  assert.ok(/timed out/i.test(error), `expected a timeout-specific message, got: ${error}`);
});

await test('a missing/blank name never reaches the network at all', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return jsonResponse([]); };
  const { candidates, error } = await lookupPlace({ name: '' }, { fetchImpl, now: () => 2200000 });
  assert.equal(called, false, 'no network request should be made for an empty name');
  assert.deepEqual(candidates, []);
  assert.ok(error);
});

await test('rapid repeated calls are throttled per lookupPlace() invocation (not per underlying HTTP request)', async () => {
  let callCount = 0;
  const fetchImpl = mockBothSources({});
  const countingFetch = async (...args) => { callCount++; return fetchImpl(...args); };
  let clock = 2300000;
  const now = () => clock;

  // A single-word name is used deliberately: buildFallbackNames()
  // produces no shorter variants for a one-word name (see its own
  // tests below), so this stays a clean two-request round (Wikidata +
  // Nominatim) with no fallback retries — isolating exactly what this
  // test verifies (the throttle counts per lookupPlace() call, not per
  // underlying request) from the separate fallback-retry behavior
  // covered in section 5b below.
  await lookupPlace({ name: 'Ganesh' }, { fetchImpl: countingFetch, now });
  assert.equal(callCount, 2, 'one lookupPlace() call with no fallback retries fires exactly two underlying requests: Wikidata + Nominatim');

  const second = await lookupPlace({ name: 'Ganesh' }, { fetchImpl: countingFetch, now });
  assert.equal(callCount, 2, 'a second lookupPlace() call within the throttle window must not hit the network at all');
  assert.ok(second.error, 'the throttled call should surface a message, not silently no-op');

  clock += 5000;
  await lookupPlace({ name: 'Ganesh' }, { fetchImpl: countingFetch, now });
  assert.equal(callCount, 4, 'a call after the throttle window has passed should reach the network again (2 more requests)');
});

console.log('\n5a. buildFallbackNames() — progressively shorter variants when the full name query fails');
await test('a two-word name produces one fallback: the first word alone', () => {
  assert.deepEqual(buildFallbackNames('Tiger Hill'), ['Tiger']);
});

await test('a three-word name produces progressively shorter fallbacks, longest first', () => {
  assert.deepEqual(buildFallbackNames('Tiger Hill Observatory'), ['Tiger Hill', 'Tiger']);
});

await test('a single-word name has no shorter fallback to try', () => {
  assert.deepEqual(buildFallbackNames('Glenarys'), []);
});

await test('a blank/whitespace-only name produces no fallbacks', () => {
  assert.deepEqual(buildFallbackNames(''), []);
  assert.deepEqual(buildFallbackNames('   '), []);
});

console.log('\n5b. lookupPlace() fallback retry — the actual "Tiger Hill Observatory" / "Glenary\'s" bug scenarios');
await test('Tiger Hill Observatory: the full query legitimately finds nothing, but the "Tiger Hill" fallback finds the real place', async () => {
  const fetchImpl = mockQueryAware({
    // The full, over-specific query — a real, honest zero-result
    // response from both sources, matching how Nominatim/Wikidata
    // behave when a query word (here "Observatory") isn't part of
    // either the OSM name/alt_name tags or the Wikidata label/aliases
    // for the real underlying feature (see the code comment on
    // buildFallbackNames for the researched reasoning behind this).
    "Tiger Hill Observatory, Darjeeling": { nominatimResults: [], wikidataHits: [] },
    // The one-word-shorter fallback DOES match — this is the real
    // canonical name ("Tiger Hill, Darjeeling" per Wikidata Q16901632).
    'Tiger Hill, Darjeeling': {
      nominatimResults: [rawNominatim({ name: 'Tiger Hill', city: 'Darjeeling', country: 'India', osmClass: 'natural', importance: 0.4 })],
    },
    'Tiger Hill': { wikidataHits: [{ id: 'Q16901632', label: 'Tiger Hill, Darjeeling', description: 'hill in India with views of the Himalayas' }] },
  });
  const { candidates, error, matchedName } = await lookupPlace(
    { name: 'Tiger Hill Observatory', locationName: 'Darjeeling' },
    { fetchImpl, now: () => 3000000 },
  );
  assert.equal(error, null);
  assert.ok(candidates.length > 0, 'the fallback-shortened query should surface the real place, not leave the person with nothing');
  assert.equal(matchedName, 'Tiger Hill', 'the variant that actually found something should be reported, not the original name');
  // Crucially: even though the fallback query used the SHORTER name,
  // ranking still scores against the FULL name the person typed —
  // this is not a blind accept of whatever the shortened query found.
  assert.ok(candidates[0].sim > 0, 'the returned candidate must still score a real similarity against the full original name');
});

await test('an unrelated place that only matches the SHORTENED fallback query does not get a free pass — it is still ranked, not blindly accepted', async () => {
  const fetchImpl = mockQueryAware({
    'Tiger Hill Zoo, Darjeeling': { nominatimResults: [], wikidataHits: [] },
    'Tiger Hill, Darjeeling': {
      // A real place that happens to match the shortened query text,
      // but is a poor match for what was actually typed.
      nominatimResults: [rawNominatim({ name: 'Tiger Hill', city: 'Darjeeling', country: 'India', osmClass: 'natural', importance: 0.4 })],
    },
    'Tiger Hill': { wikidataHits: [] },
  });
  const { candidates } = await lookupPlace(
    { name: 'Tiger Hill Zoo', locationName: 'Darjeeling' },
    { fetchImpl, now: () => 3100000 },
  );
  // The candidate is still returned (manual confirmation is always up
  // to the person — this module never silently filters), but its
  // score must reflect that "Tiger Hill" is only a partial match for
  // "Tiger Hill Zoo", not a perfect one.
  assert.ok(candidates.length > 0);
  assert.ok(candidates[0].sim < 1, 'a fallback-sourced candidate must not be scored as if it were an exact match to the original name');
});

await test("Glenary's: an EXACT match on the full query is used directly — no fallback attempt is even made", async () => {
  let attemptedQueries = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (url.includes('nominatim')) {
      attemptedQueries.push(parsed.searchParams.get('q'));
      return jsonResponse([rawNominatim({ name: "Glenary's", city: 'Darjeeling', country: 'India', osmClass: 'amenity', importance: 0.35 })]);
    }
    if (url.includes('wbsearchentities')) {
      attemptedQueries.push(parsed.searchParams.get('search'));
      return jsonResponse({ search: [{ id: 'Q102789668', label: "Glenary's", description: 'colonial-era cafe in Darjeeling, India' }] });
    }
    if (url.includes('wbgetentities')) return jsonResponse({ entities: { Q102789668: { labels: { en: { value: "Glenary's" } }, descriptions: { en: { value: 'colonial-era cafe in Darjeeling, India' } }, claims: {} } } });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const { candidates, error, matchedName } = await lookupPlace(
    { name: "Glenary's", locationName: 'Darjeeling', destinationName: 'Darjeeling' },
    { fetchImpl, now: () => 3200000 },
  );
  assert.equal(error, null);
  assert.ok(candidates.length > 0, "Glenary's should be found directly — both providers have real data for it (verified via web search; see the report for what could not be live-tested)");
  assert.equal(matchedName, "Glenary's", 'the ORIGINAL name matched — no fallback variant was needed');
  // Only 2 requests total (one Nominatim + one Wikidata search; the
  // wbgetentities follow-up is a 3rd but is part of the SAME attempt,
  // not a retry) — confirms no fallback round fired when the first
  // one already succeeded.
  assert.equal(attemptedQueries.length, 2, 'an exact-match first attempt must not trigger any fallback request');
  // And the duplicated-city bug is also gone: destination "Darjeeling"
  // is not repeated after location "Darjeeling" in the Nominatim query.
  assert.equal(attemptedQueries[0], "Glenary's, Darjeeling");
});

await test('when even every fallback variant genuinely finds nothing, the result is a graceful empty outcome, not an error', async () => {
  const fetchImpl = mockQueryAware({}); // every possible query resolves to empty — a totally unknown place
  const { candidates, error } = await lookupPlace(
    { name: 'Some Made Up Place Nobody Mapped', locationName: 'Darjeeling' },
    { fetchImpl, now: () => 3300000 },
  );
  assert.deepEqual(candidates, []);
  assert.equal(error, null, 'exhausting all fallbacks with no results is still a genuine empty search, not a failure');
});

await test('a real network failure on the first attempt stops immediately — it does not retry fallbacks after a genuine error', async () => {
  let callCount = 0;
  const fetchImpl = async () => { callCount++; throw new Error('network down'); };
  const { candidates, error } = await lookupPlace(
    { name: 'Tiger Hill Observatory', locationName: 'Darjeeling' },
    { fetchImpl, now: () => 3400000 },
  );
  assert.deepEqual(candidates, []);
  assert.ok(error);
  assert.equal(callCount, 2, 'a genuine failure (not just an empty result) must not trigger fallback retries — only 1 round (2 requests) should fire');
});

console.log('\n5c. buildConfirmedPlace() — preserve the known Dossier City; route provider admin detail into Area/locality, never into a new City');

// A candidate shaped exactly like what normalizeNominatimResult()
// produces for a real, sparsely-tagged rural feature (a hilltop with
// no city/town/village tag of its own) — this is the actual "Tiger
// Hill" scenario reported: Nominatim's address only has county/state.
function candidateWithAddress({ name, address, lat = 27.0, lng = 88.25 }) {
  return { name, lat, lng, raw: { address } };
}

await test('the Tiger Hill bug: a known Dossier City is preserved; the noisy county+state string never becomes the saved city', () => {
  const candidate = candidateWithAddress({
    name: 'Tiger Hill',
    address: { county: 'Rangli Rangliot Jorebunglow Sukiapokhri', state: 'West Bengal', country: 'India' },
  });
  const place = buildConfirmedPlace(candidate, 'Darjeeling'); // the city already established by the current Add/edit context
  assert.equal(place.city, 'Darjeeling', 'the already-known Dossier City must be preserved, not overwritten by provider admin data');
  assert.notEqual(place.city, 'Rangli Rangliot Jorebunglow Sukiapokhri West Bengal');
  assert.equal(place.locality, 'Rangli Rangliot Jorebunglow Sukiapokhri', 'the finer-grained provider detail belongs in Area/locality, not City');
});

await test('this works generically for ANY city/destination — not hardcoded to Darjeeling', () => {
  const candidate = candidateWithAddress({
    name: 'Some Rural Viewpoint',
    address: { county: 'Some Random District', state: 'Some Random State', country: 'Elsewhere' },
  });
  const place = buildConfirmedPlace(candidate, 'Springfield');
  assert.equal(place.city, 'Springfield', 'the mechanism must work for any known city name, not a special-cased one');
  assert.equal(place.locality, 'Some Random District');
});

await test('when no Dossier City context is known yet, a genuine city/town/village tag is used as city (not county/state)', () => {
  const candidate = candidateWithAddress({
    name: 'Ghoom Monastery',
    address: { town: 'Ghoom', county: 'Darjeeling district', state: 'West Bengal', country: 'India' },
  });
  const place = buildConfirmedPlace(candidate, null);
  assert.equal(place.city, 'Ghoom', 'a real city-level tag should still be used when there is no established context to preserve');
});

await test('when no Dossier City context is known AND the provider has no city/town/village tag either, city stays blank rather than falling back to county/state', () => {
  const candidate = candidateWithAddress({
    name: 'Tiger Hill',
    address: { county: 'Rangli Rangliot Jorebunglow Sukiapokhri', state: 'West Bengal', country: 'India' },
  });
  const place = buildConfirmedPlace(candidate, null);
  assert.equal(place.city, '', 'county/state must never be used as the City value, even with no context to fall back on');
  assert.equal(place.locality, 'Rangli Rangliot Jorebunglow Sukiapokhri', 'the detail is not lost — it still lands in Area/locality');
});

await test('a suburb/neighbourhood tag is preferred as locality over county/state when both exist', () => {
  const candidate = candidateWithAddress({
    name: 'Chowrasta',
    address: { suburb: 'Mall Road', city: 'Darjeeling', county: 'Darjeeling district', state: 'West Bengal' },
  });
  const place = buildConfirmedPlace(candidate, 'Darjeeling');
  assert.equal(place.locality, 'Mall Road', 'a genuine sub-city tag is more useful than the broader county/state fallback');
});

await test("when the provider's own city-level guess differs from the known context, that detail is preserved in locality rather than silently dropped", () => {
  const candidate = candidateWithAddress({
    name: 'Batasia Loop',
    address: { town: 'Ghoom', country: 'India' }, // provider says "Ghoom", but the record is scoped to "Darjeeling" city
  });
  const place = buildConfirmedPlace(candidate, 'Darjeeling');
  assert.equal(place.city, 'Darjeeling', 'the established Dossier City always wins');
  assert.equal(place.locality, 'Ghoom', "the provider's differing detail is not thrown away — it becomes Area context instead");
});

await test('no Dossier City change ever happens implicitly — buildConfirmedPlace only ever returns a free-text city/locality string, never a locationId', () => {
  const candidate = candidateWithAddress({ name: 'Tiger Hill', address: { county: 'Somewhere Rural', state: 'Some State' } });
  const place = buildConfirmedPlace(candidate, 'Darjeeling');
  assert.ok(!('locationId' in place), 'this function must never touch/create a real Dossier City record — only components/AddEntry.jsx\'s explicit "Other / Add new city" flow does that');
});

console.log('\n6. Confirmed-result local cache (unchanged by the Wikidata+Nominatim merge)');
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
