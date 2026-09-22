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
  buildEntityTypeSynonymVariant,
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

console.log('\n4b. Merge name preservation — the Ghum/Ghoom scenario: keep Nominatim\'s structured data, but use the more informative name');

await test('when merged, the Nominatim candidate keeps ALL its structured data (displayName, coordinates, addressCity, addressCountry, osmClass, importance) — only `name` can change', () => {
  const wikidata = [wdCandidate({ name: 'Ghum railway station', lat: 27.008643, lng: 88.254223 })];
  const nominatim = [nomCandidate({ name: 'Ghoom', city: 'Ghoom', country: 'India', osmClass: 'railway', importance: 0.15, lat: 27.0083, lng: 88.254 })];
  const merged = mergeCandidates(wikidata, nominatim, 'Ghum Railway station');
  assert.equal(merged.length, 1);
  const c = merged[0];
  assert.equal(c.source, 'nominatim', 'the kept candidate is still the Nominatim one — this is a name substitution, not a wholesale swap of which source is used');
  assert.equal(c.name, 'Ghum railway station', 'the more informative Wikidata name should be used, since it matches the searched query far better than the bare locality name "Ghoom" does');
  assert.equal(c.addressCity, 'Ghoom', "Nominatim's own structured address data is untouched");
  assert.equal(c.addressCountry, 'India');
  assert.equal(c.osmClass, 'railway');
  assert.equal(c.importance, 0.15);
  assert.equal(c.lat, 27.0083, "Nominatim's own coordinates are kept, not overwritten by Wikidata's");
  assert.equal(c.lng, 88.254);
});

await test('when Nominatim\'s own name is already an equal-or-better match to the query than Wikidata\'s, it is kept unchanged (this is a real comparison, not "always prefer Wikidata")', () => {
  const wikidata = [wdCandidate({ name: 'Tiger Hill, Darjeeling', lat: 27.0, lng: 88.25 })];
  const nominatim = [nomCandidate({ name: 'Tiger Hill', city: 'Darjeeling', country: 'India', osmClass: 'natural', importance: 0.4, lat: 27.0001, lng: 88.2501 })];
  const merged = mergeCandidates(wikidata, nominatim, 'Tiger Hill');
  assert.equal(merged[0].name, 'Tiger Hill', 'Nominatim\'s exact-match name should win over Wikidata\'s longer, less-exact label');
});

await test('with no queryName argument at all (e.g. the discovery-variant merge inside fetchRound, which has no Wikidata side to compare), the Nominatim name is always kept exactly as before — fully backward compatible with every existing 2-argument call', () => {
  const wikidata = [wdCandidate({ name: 'Ghum railway station', lat: 27.008643, lng: 88.254223 })];
  const nominatim = [nomCandidate({ name: 'Ghoom', city: 'Ghoom', country: 'India', osmClass: 'railway', importance: 0.15, lat: 27.0083, lng: 88.254 })];
  const merged = mergeCandidates(wikidata, nominatim); // no third argument
  assert.equal(merged[0].name, 'Ghoom', 'without a query to judge "more informative" against, nothing should change from the existing behavior');
});

await test('a non-duplicate Wikidata candidate (kept as its own entry, not merged into anything) is never touched by the name-preference logic', () => {
  const wikidata = [wdCandidate({ name: 'Some Obscure Shrine', lat: 27.5, lng: 88.5 })]; // far from the Nominatim candidate below
  const nominatim = [nomCandidate({ name: 'Completely Different Place', city: 'Kandy', importance: 0.3, lat: 7.29, lng: 80.64 })];
  const merged = mergeCandidates(wikidata, nominatim, 'Some Obscure Shrine');
  assert.equal(merged.length, 2);
  assert.equal(merged.find(c => c.source === 'wikidata').name, 'Some Obscure Shrine', 'a non-duplicate Wikidata candidate keeps its own name unchanged — the substitution logic only ever applies to an actual merged duplicate pair');
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

console.log('\n5a2. buildEntityTypeSynonymVariant() — the deterministic "zoo" -> "zoological park" discovery variant');

await test('a bare "zoo" query produces the "zoological park" variant', () => {
  assert.equal(buildEntityTypeSynonymVariant('zoo'), 'zoological park');
});

await test('the synonym is substituted in place, preserving the rest of a multi-word name', () => {
  assert.equal(buildEntityTypeSynonymVariant('Darjeeling zoo'), 'Darjeeling zoological park');
});

await test('matching is case-insensitive on the word itself', () => {
  assert.equal(buildEntityTypeSynonymVariant('Zoo'), 'zoological park');
  assert.equal(buildEntityTypeSynonymVariant('ZOO'), 'zoological park');
});

await test('matching is WORD-BOUNDARY safe — a name that merely contains "zoo" as a substring is untouched', () => {
  assert.equal(buildEntityTypeSynonymVariant('Zootopia Cafe'), null, 'the word-boundary regex must not match "zoo" inside "Zootopia"');
});

await test('a name with no entity-type synonym at all returns null (no extra request generated)', () => {
  assert.equal(buildEntityTypeSynonymVariant('Tiger Hill'), null);
  assert.equal(buildEntityTypeSynonymVariant(''), null);
  assert.equal(buildEntityTypeSynonymVariant(null), null);
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
  // 3 requests total on this one attempt: the contextualized Nominatim
  // query, the bare-name Nominatim query (see fetchRound's doc
  // comment — fired alongside the contextualized one on the FIRST
  // attempt only, along with the spelling/punctuation variants, when
  // any of those actually apply — neither applies here, since
  // "Glenary's" has no doubled vowel and already ends in "'s", not a
  // bare "s"), and the Wikidata search; the wbgetentities follow-up is
  // a 4th but is part of the SAME attempt, not a retry — confirms no
  // FALLBACK round fired when the first one already succeeded (which
  // is what this test is really guarding against).
  assert.equal(attemptedQueries.length, 3, 'an exact-match first attempt must not trigger any fallback request (it does include one extra bare-name Nominatim query alongside the original two; no spelling/punctuation variant applies to "Glenary\'s" itself)');
  // Both the contextualized query AND the bare-name query should be
  // present among what was attempted (order between the two Nominatim
  // requests and the Wikidata request isn't guaranteed since they run
  // in parallel via Promise.allSettled).
  assert.ok(attemptedQueries.includes("Glenary's, Darjeeling"), 'the duplicated-city bug is also gone: destination "Darjeeling" is not repeated after location "Darjeeling" in the contextualized Nominatim query');
  assert.ok(attemptedQueries.includes("Glenary's"), 'the bare name (no city/destination appended) should also have been tried, in parallel, on this first attempt');
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
  // 3 requests on this one round: contextualized Nominatim, bare-name
  // Nominatim (fired alongside it on the first attempt — see
  // fetchRound; no spelling/punctuation variant applies to "Tiger
  // Hill Observatory" itself), and Wikidata — all three reject, and
  // that's enough to conclude a genuine failure and stop; no fallback
  // retry attempt follows.
  assert.equal(callCount, 3, 'a genuine failure (not just an empty result) must not trigger fallback retries — only 1 round should fire, now with 3 requests (contextualized + bare-name Nominatim, plus Wikidata) instead of 2');
});

console.log('\n5d. Discovery-variant Nominatim requests — bare name, spelling variant, punctuation variant, entity-type synonym');

await test('spelling variant discovery: the contextual AND bare-name queries find nothing, but the "oo"->"u" spelling variant finds the real place (the Ghoom/Ghum Railway Station scenario)', async () => {
  const fetchImpl = mockQueryAware({
    // Neither the contextualized nor the bare "Ghoom" spelling finds
    // anything — this reproduces the real, researched fact that the
    // station's actual/canonical name is spelled "Ghum" (its own
    // Wikipedia article title), not "Ghoom" (the common alternate
    // spelling this query uses).
    'Ghoom Railway Station, Ghoom': { nominatimResults: [] },
    'Ghoom Railway Station': { nominatimResults: [] },
    // The spelling-variant query ("oo" -> "u", applied to the NAME
    // only — the locality "Ghoom" passed as context is untouched,
    // since buildSpellingVariant transforms just the name before
    // buildContextualQuery re-attaches the original, unmodified
    // locationName/destinationName) succeeds.
    'Ghum Railway Station, Ghoom': {
      nominatimResults: [rawNominatim({ name: 'Ghum railway station', city: 'Ghoom', country: 'India', osmClass: 'railway', importance: 0.15 })],
    },
  });
  const { candidates, error, matchedName, matchedViaEntityTypeDrop } = await lookupPlace(
    { name: 'Ghoom Railway Station', locationName: 'Ghoom' },
    { fetchImpl, now: () => 4000000 },
  );
  assert.equal(error, null);
  assert.ok(candidates.length > 0, 'the spelling-variant Nominatim query should surface the real station even though both the contextualized and bare-name queries found nothing');
  assert.equal(matchedName, 'Ghoom Railway Station', 'this is the ORIGINAL name, not a fallback variant — buildFallbackNames/word-dropping never had to run, since the spelling-variant request (a parallel discovery mechanism, not a broadening) found it on the first attempt');
  assert.equal(matchedViaEntityTypeDrop, false, 'nothing was dropped — this is alternative discovery of the SAME requested name, not a broader fallback, so the entity-type-drop flag must be false');
  assert.equal(candidates[0].name, 'Ghum railway station');
});

await test('punctuation variant discovery: "Glenarys" (no apostrophe) finds the real "Glenary\'s" via the possessive-apostrophe variant', async () => {
  const fetchImpl = mockQueryAware({
    'Glenarys, Darjeeling': { nominatimResults: [] },
    'Glenarys': { nominatimResults: [] },
    // The punctuation-variant query restores the apostrophe in its one
    // structurally valid position (immediately before the trailing
    // "s") and succeeds.
    "Glenary's, Darjeeling": {
      nominatimResults: [rawNominatim({ name: "Glenary's", city: 'Darjeeling', country: 'India', osmClass: 'amenity', importance: 0.35 })],
    },
  });
  const { candidates, error, matchedName, matchedViaEntityTypeDrop } = await lookupPlace(
    { name: 'Glenarys', locationName: 'Darjeeling' },
    { fetchImpl, now: () => 4050000 },
  );
  assert.equal(error, null);
  assert.ok(candidates.length > 0, 'the punctuation-variant Nominatim query should surface the real place');
  assert.equal(matchedName, 'Glenarys', 'this is the ORIGINAL name as typed — alternative discovery, not a fallback to a different name');
  assert.equal(matchedViaEntityTypeDrop, false);
  assert.equal(candidates[0].name, "Glenary's");
});

await test('the punctuation variant does not fire at all for a name that already has the apostrophe ("Glenary\'s" itself stays a 2-request lookup, not 3+)', async () => {
  let nominatimQueries = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (url.includes('nominatim')) {
      nominatimQueries.push(parsed.searchParams.get('q'));
      return jsonResponse([rawNominatim({ name: "Glenary's", city: 'Darjeeling', country: 'India', osmClass: 'amenity', importance: 0.35 })]);
    }
    if (url.includes('wbsearchentities')) return jsonResponse({ search: [] });
    throw new Error(`Unexpected URL: ${url}`);
  };
  await lookupPlace({ name: "Glenary's", locationName: 'Darjeeling' }, { fetchImpl, now: () => 4060000 });
  assert.equal(nominatimQueries.length, 2, 'only the contextual + bare-name queries should fire — "Glenary\'s" already ends in \'s, not a bare trailing s, so buildPunctuationVariant must return null and add no extra request');
});

await test('the spelling variant does not fire at all for a name with no doubled vowel ("Tiger Hill" stays a 2-request lookup)', async () => {
  let nominatimQueries = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (url.includes('nominatim')) {
      nominatimQueries.push(parsed.searchParams.get('q'));
      return jsonResponse([rawNominatim({ name: 'Tiger Hill', city: 'Darjeeling', country: 'India', osmClass: 'natural', importance: 0.4 })]);
    }
    if (url.includes('wbsearchentities')) return jsonResponse({ search: [] });
    throw new Error(`Unexpected URL: ${url}`);
  };
  await lookupPlace({ name: 'Tiger Hill', locationName: 'Darjeeling' }, { fetchImpl, now: () => 4070000 });
  assert.equal(nominatimQueries.length, 2, 'no "oo" in "Tiger Hill" — buildSpellingVariant must return null and add no extra request');
});

await test('a name spelled with the already-correct "Ghum" spelling does not trigger a redundant spelling-variant request', async () => {
  let nominatimQueries = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (url.includes('nominatim')) {
      nominatimQueries.push(parsed.searchParams.get('q'));
      return jsonResponse([rawNominatim({ name: 'Ghum railway station', city: 'Ghoom', country: 'India', osmClass: 'railway', importance: 0.15 })]);
    }
    if (url.includes('wbsearchentities')) return jsonResponse({ search: [] });
    throw new Error(`Unexpected URL: ${url}`);
  };
  await lookupPlace({ name: 'Ghum Railway Station', locationName: 'Ghoom' }, { fetchImpl, now: () => 4080000 });
  // "Ghum" has no "oo" to collapse, so buildSpellingVariant('Ghum
  // Railway Station') is null — only the contextual + bare-name
  // queries fire.
  assert.equal(nominatimQueries.length, 2, 'a query already using the canonical spelling must not fire a redundant, identical-effect spelling-variant request');
});

await test('merge/dedup: when the contextual/bare-name queries and a variant query all return the SAME real place, it appears only once in the final results, not duplicated', async () => {
  const sameStation = rawNominatim({ name: 'Tiger Hill', city: 'Darjeeling', country: 'India', osmClass: 'natural', importance: 0.4, lat: '27.01', lon: '88.26' });
  const fetchImpl = mockQueryAware({
    'Tiger Hill, Darjeeling': { nominatimResults: [sameStation] },
    'Tiger Hill': { nominatimResults: [sameStation] },
  });
  const { candidates, error } = await lookupPlace(
    { name: 'Tiger Hill', locationName: 'Darjeeling' },
    { fetchImpl, now: () => 4100000 },
  );
  assert.equal(error, null);
  assert.equal(candidates.length, 1, 'the same real place found by both the contextual and bare-name queries must be merged into a single candidate, not shown twice');
});

await test('merge/dedup: when the contextual and bare-name queries return DIFFERENT real places, both are kept as distinct candidates', async () => {
  const fetchImpl = mockQueryAware({
    'Tiger Hill, Darjeeling': {
      nominatimResults: [rawNominatim({ name: 'Tiger Hill', city: 'Darjeeling', country: 'India', osmClass: 'natural', importance: 0.4, lat: '27.01', lon: '88.26' })],
    },
    'Tiger Hill': {
      // A genuinely different, unrelated "Tiger Hill" far away —
      // distinct coordinates and no name-similarity-driven merge
      // either, since mergeCandidates only merges close-by
      // coordinates or a near-exact name+no-coordinates case (see
      // mergeCandidates' own doc comment) — two real, distant places
      // sharing a name are NOT the same place and must not collapse.
      nominatimResults: [rawNominatim({ name: 'Tiger Hill', city: 'Elsewhere', country: 'Elsewhere', osmClass: 'natural', importance: 0.2, lat: '10.0', lon: '10.0' })],
    },
  });
  const { candidates, error } = await lookupPlace(
    { name: 'Tiger Hill', locationName: 'Darjeeling' },
    { fetchImpl, now: () => 4200000 },
  );
  assert.equal(error, null);
  assert.equal(candidates.length, 2, 'two genuinely distinct real places must both be kept, not incorrectly merged just because they share a name');
});

await test('the "zoo" scenario end-to-end: "zoo" alone finds nothing, but the "zoological park" synonym variant discovers Padmaja Naidu Himalayan Zoological Park', async () => {
  const fetchImpl = mockQueryAware({
    // The plain word "zoo" genuinely returns nothing — this matches
    // live provider testing: Nominatim has no useful match for the
    // bare word "zoo" as a query.
    'zoo, Darjeeling': { nominatimResults: [] },
    'zoo': { nominatimResults: [] },
    // The entity-type-synonym variant, WITH the same city/destination
    // context the primary query already carried, succeeds — this is
    // the concrete, investigated case: "zoological park" is the term
    // the real facility's own data actually uses.
    'zoological park, Darjeeling': {
      nominatimResults: [rawNominatim({ name: 'Padmaja Naidu Himalayan Zoological Park', city: 'Darjeeling', country: 'India', osmClass: 'tourism', importance: 0.4 })],
    },
  });
  const { candidates, error, matchedName, matchedViaEntityTypeDrop } = await lookupPlace(
    { name: 'zoo', locationName: 'Darjeeling', destinationName: 'Darjeeling' },
    { fetchImpl, now: () => 4250000 },
  );
  assert.equal(error, null);
  assert.ok(candidates.length > 0, 'the entity-type synonym variant should surface the real zoo even though the bare "zoo" query found nothing');
  assert.equal(candidates[0].name, 'Padmaja Naidu Himalayan Zoological Park');
  assert.equal(matchedName, 'zoo', 'this is alternative DISCOVERY of the same requested word, not a fallback to a different/broader name — matchedName must stay exactly what was typed');
  assert.equal(matchedViaEntityTypeDrop, false, 'nothing was dropped — the synonym is an additional query, not a narrowing of the original one');
});

await test('the synonym variant keeps city/destination CONTEXT, unlike the bare-name variant (it uses the existing contextual Nominatim mechanism, per the requirement)', async () => {
  let synonymQuerySeen = null;
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (url.includes('nominatim')) {
      const q = parsed.searchParams.get('q');
      if (q.includes('zoological park')) synonymQuerySeen = q;
      return jsonResponse([]);
    }
    if (url.includes('wbsearchentities')) return jsonResponse({ search: [] });
    throw new Error(`Unexpected URL: ${url}`);
  };
  await lookupPlace({ name: 'zoo', locationName: 'Darjeeling', destinationName: 'Darjeeling' }, { fetchImpl, now: () => 4260000 });
  assert.equal(synonymQuerySeen, 'zoological park, Darjeeling', 'the synonym variant must be built through the same buildContextualQuery mechanism as the primary query — carrying locationName/destinationName, not a bare/context-free string');
});

await test('no entity-type-synonym request fires for a query with no matching entity-type word (bounded request growth)', async () => {
  let nominatimQueries = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (url.includes('nominatim')) { nominatimQueries.push(parsed.searchParams.get('q')); return jsonResponse([rawNominatim({ name: 'Tiger Hill', city: 'Darjeeling', country: 'India', osmClass: 'natural', importance: 0.4 })]); }
    if (url.includes('wbsearchentities')) return jsonResponse({ search: [] });
    throw new Error(`Unexpected URL: ${url}`);
  };
  await lookupPlace({ name: 'Tiger Hill', locationName: 'Darjeeling' }, { fetchImpl, now: () => 4270000 });
  assert.equal(nominatimQueries.length, 2, 'no "zoo" (or any other mapped entity-type word) in "Tiger Hill" — buildEntityTypeSynonymVariant must return null and add no extra request');
});

await test('the entity-type-synonym request is fired only on the FIRST attempt, never repeated for a fallback attempt', async () => {
  let nominatimQueries = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (url.includes('nominatim')) { nominatimQueries.push(parsed.searchParams.get('q')); return jsonResponse([]); }
    if (url.includes('wbsearchentities')) return jsonResponse({ search: [] });
    throw new Error(`Unexpected URL: ${url}`);
  };
  // "Darjeeling zoo view" is a 3-word name so it has 2 fallback tiers
  // ("Darjeeling zoo", "Darjeeling") — the first of which ALSO
  // contains "zoo" and could, if the discipline were wrong, trigger
  // its own synonym request too.
  await lookupPlace({ name: 'Darjeeling zoo view', locationName: 'Darjeeling' }, { fetchImpl, now: () => 4280000 });
  const synonymQueries = nominatimQueries.filter(q => q.includes('zoological park'));
  assert.equal(synonymQueries.length, 1, 'the entity-type-synonym variant must fire once, on the first attempt only — never again on the "Darjeeling zoo" fallback tier even though it also contains "zoo"');
});

await test('request behavior: discovery variants are fired only on the FIRST/full-name attempt, never repeated for a fallback attempt', async () => {
  let nominatimQueries = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (url.includes('nominatim')) {
      nominatimQueries.push(parsed.searchParams.get('q'));
      return jsonResponse([]); // every Nominatim attempt is a genuine zero-result, forcing every fallback tier to run
    }
    if (url.includes('wbsearchentities')) return jsonResponse({ search: [] });
    throw new Error(`Unexpected URL: ${url}`);
  };
  await lookupPlace({ name: 'Tiger Hill Observatory', locationName: 'Darjeeling' }, { fetchImpl, now: () => 4300000 });
  // 3 attempts total: "Tiger Hill Observatory" (full name — gets BOTH
  // the contextual AND bare-name Nominatim queries; no spelling or
  // punctuation variant applies to this name), "Tiger Hill" (first
  // fallback — contextual query only), "Tiger" (second fallback —
  // contextual query only). That's 2 + 1 + 1 = 4 Nominatim requests,
  // not 5 or 6 — confirming the extra discovery variants are NOT
  // repeated on either fallback tier.
  assert.equal(nominatimQueries.length, 4, 'discovery-variant requests must fire only on the first attempt, never again on fallback attempts');
  assert.ok(nominatimQueries.includes('Tiger Hill Observatory, Darjeeling'));
  assert.ok(nominatimQueries.includes('Tiger Hill Observatory'), 'the bare-name variant of the FULL original name should have been tried');
  assert.ok(nominatimQueries.includes('Tiger Hill, Darjeeling'), 'the first fallback tier still runs its normal contextual query');
  assert.ok(nominatimQueries.includes('Tiger, Darjeeling'), 'the second fallback tier still runs its normal contextual query');
  assert.ok(!nominatimQueries.includes('Tiger Hill'), 'the first fallback tier must NOT also get its own bare-name query');
  assert.ok(!nominatimQueries.includes('Tiger'), 'the second fallback tier must NOT also get its own bare-name query');
});

await test('no bare-name request is fired at all when there is no city/destination context to strip in the first place', async () => {
  let nominatimQueries = [];
  const fetchImpl = async (url) => {
    if (url.includes('nominatim')) {
      nominatimQueries.push(new URL(url).searchParams.get('q'));
      return jsonResponse([rawNominatim({ name: 'Solo Place', importance: 0.3 })]);
    }
    if (url.includes('wbsearchentities')) return jsonResponse({ search: [] });
    throw new Error(`Unexpected URL: ${url}`);
  };
  await lookupPlace({ name: 'Solo Place' }, { fetchImpl, now: () => 4400000 }); // no locationName/destinationName at all
  assert.equal(nominatimQueries.length, 1, 'when the contextual query already equals the bare name (no context was ever appended), firing a second identical request would be pure waste');
});

console.log('\n5e. Plain nameSimilarity + structural category matching — locality-vs-station safety, category words carry real weight, geographic words untouched');

await test('nameSimilarity is now PLAIN token overlap again — no generic-word deweighting — so a bare locality scores the ordinary, honest overlap against a multi-word query, not an inflated one', () => {
  const score = nameSimilarity('Ghoom Railway Station', 'Ghoom');
  assert.ok(Math.abs(score - 1 / 3) < 0.001, `expected the plain, ordinary token-overlap result (~0.333, one of three words shared), got ${score} — this is the direct regression guard for the locality-vs-station safety bug: the previous generic-word-deweighted formula scored this ~0.667, letting a completely different KIND of place (a locality, not a station) look like a near-match`);
});

await test('railway/station collision: once BOTH the correct station and an unrelated same-category station are discovered, plain name similarity (not deweighting) already tells them apart', () => {
  const candidates = [
    nomCandidate({ name: 'Ghoom railway station', city: 'Ghoom', country: 'India', osmClass: 'railway', importance: 0.15 }),
    nomCandidate({ name: 'Darjeeling railway station', city: 'Darjeeling', country: 'India', osmClass: 'railway', importance: 0.55 }),
  ];
  const ranked = rankCandidates(candidates, { name: 'Ghoom Railway Station', locationName: 'Ghoom' });
  assert.equal(ranked[0].name, 'Ghoom railway station', 'the station actually named after the searched place must outrank an unrelated, merely more "important" station of the same category — plain nameSimilarity already gives it a higher score (all 3 words match vs 2 of 3), no deweighting trick needed');
  assert.ok(ranked[0].score > ranked[1].score, 'the win should be decisive, not a near-tie left to chance');
});

await test('exact match still scores a perfect 1 (plain formula, no regression for the common case)', () => {
  assert.equal(nameSimilarity('Ganesh Temple', 'Ganesh Temple'), 1);
  assert.equal(nameSimilarity('Ghoom Railway Station', 'Ghoom Railway Station'), 1);
});

await test('geographic-feature words like "Hill" are treated as ordinary, fully-weighted tokens — "Tiger Hill" is unaffected by any category mechanism', () => {
  const exact = nameSimilarity('Tiger Hill', 'Tiger Hill');
  const differentHill = nameSimilarity('Tiger Hill', 'Elephant Hill');
  assert.equal(exact, 1);
  assert.equal(differentHill, 0.5, `"Hill" is a plain, fully-weighted token like any other — one of two words shared lands at an honest 50% overlap (got ${differentHill})`);
  assert.ok(differentHill < exact, 'the exact match must still clearly outrank the different-hill match');
});

console.log('\n5f. Category matching stays structural (categoryScore/osmClass/CATEGORY_HINTS), never inside name similarity');

await test('CATEGORY_HINTS.attraction includes "railway" — a legitimate railway station is a reasonable attraction, not an automatic category mismatch', () => {
  assert.ok(CATEGORY_HINTS.attraction.classes.includes('railway'), 'a real, correctly-tagged railway station/landmark should not be penalized as "wrong category" for an Attractions search');
});

await test('a railway-class candidate is NOT penalized as wrong-category for an attraction lookup (categoryScore, not name similarity, carries this signal)', () => {
  const candidates = [nomCandidate({ name: 'Ghoom railway station', city: 'Ghoom', country: 'India', osmClass: 'railway', importance: 0.15 })];
  const ranked = rankCandidates(candidates, { name: 'Ghoom Railway Station', locationName: 'Ghoom', expectedCategory: CATEGORY_HINTS.attraction });
  assert.equal(ranked[0].categoryScore, 1, 'railway is now a recognized attraction-relevant OSM class, so an exact-category match should score the full 1, not the "wrong category" 0.2 penalty');
});

console.log('\n5g. Fallback transparency data — matchedName and matchedViaEntityTypeDrop correctly reflect broader searches vs. alternative discovery');

await test('matchedName equals the original name when a discovery variant (not a fallback) is what found the result', async () => {
  const fetchImpl = mockQueryAware({
    'Ghoom Railway Station, Ghoom': { nominatimResults: [] },
    'Ghoom Railway Station': { nominatimResults: [] },
    'Ghum Railway Station, Ghoom': { nominatimResults: [rawNominatim({ name: 'Ghum railway station', city: 'Ghoom', country: 'India', osmClass: 'railway', importance: 0.15 })] },
  });
  const { matchedName, matchedViaEntityTypeDrop } = await lookupPlace({ name: 'Ghoom Railway Station', locationName: 'Ghoom' }, { fetchImpl, now: () => 4500000 });
  assert.equal(matchedName, 'Ghoom Railway Station', 'a discovery-variant Nominatim query is a parallel DISCOVERY mechanism on the same attempt, not a fallback to a different/broader name — matchedName should still equal exactly what was typed');
  assert.equal(matchedViaEntityTypeDrop, false, 'nothing was dropped, so this must never be flagged as an entity-type-changing broadening');
});

await test('matchedName reflects the broader fallback name AND matchedViaEntityTypeDrop is true when the dropped word is an entity-type word (Tiger Hill Observatory -> Tiger Hill drops "observatory")', async () => {
  const fetchImpl = mockQueryAware({
    'Tiger Hill Observatory, Darjeeling': { nominatimResults: [] },
    'Tiger Hill Observatory': { nominatimResults: [] },
    'Tiger Hill, Darjeeling': { nominatimResults: [rawNominatim({ name: 'Tiger Hill', city: 'Darjeeling', country: 'India', osmClass: 'natural', importance: 0.4 })] },
  });
  const { matchedName, matchedViaEntityTypeDrop } = await lookupPlace({ name: 'Tiger Hill Observatory', locationName: 'Darjeeling' }, { fetchImpl, now: () => 4600000 });
  assert.equal(matchedName, 'Tiger Hill', 'PlaceLookup.jsx compares this against the originally-typed name to decide whether to show its "broader search" indication');
  assert.equal(matchedViaEntityTypeDrop, true, '"observatory" is an entity-type word (see ENTITY_TYPE_WORDS) — dropping it changes what KIND of place is being asked for, so this must be flagged for a stronger UI caution');
});

await test('matchedViaEntityTypeDrop is FALSE when only a non-entity-type word was dropped ("Tiger Hill Nearby" -> "Tiger Hill" drops only the trailing "nearby")', async () => {
  const fetchImpl = mockQueryAware({
    'Tiger Hill Nearby, Darjeeling': { nominatimResults: [] },
    'Tiger Hill Nearby': { nominatimResults: [] },
    'Tiger Hill, Darjeeling': { nominatimResults: [rawNominatim({ name: 'Tiger Hill', city: 'Darjeeling', country: 'India', osmClass: 'natural', importance: 0.4 })] },
  });
  const { matchedName, matchedViaEntityTypeDrop } = await lookupPlace({ name: 'Tiger Hill Nearby', locationName: 'Darjeeling' }, { fetchImpl, now: () => 4650000 });
  assert.equal(matchedName, 'Tiger Hill');
  assert.equal(matchedViaEntityTypeDrop, false, '"nearby" is an ordinary descriptive word, not an entity-type word — this fallback should NOT get the stronger caution');
});

await test('matchedViaEntityTypeDrop is FALSE for a direct (non-fallback) match — "Tiger Hill" searched directly is completely unaffected', async () => {
  const fetchImpl = mockQueryAware({
    'Tiger Hill, Darjeeling': { nominatimResults: [rawNominatim({ name: 'Tiger Hill', city: 'Darjeeling', country: 'India', osmClass: 'natural', importance: 0.4 })] },
  });
  const { matchedName, matchedViaEntityTypeDrop } = await lookupPlace({ name: 'Tiger Hill', locationName: 'Darjeeling' }, { fetchImpl, now: () => 4700000 });
  assert.equal(matchedName, 'Tiger Hill');
  assert.equal(matchedViaEntityTypeDrop, false);
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

console.log('\n6b. Cache versioning — a stale entry from the OLD (pre-buildConfirmedPlace) City/Area bug cannot resurface');

await test("a raw entry written under the OLD, unversioned cache key is never read back — it's a clean miss, not the stale value", () => {
  const storage = makeMemoryStorage();
  // Simulates what earlier app code actually wrote to a real
  // person's localStorage: the OLD key format (no version segment)
  // holding the OLD buggy shape, where `city` was Nominatim's raw
  // multi-level admin-area concatenation instead of the preserved
  // Dossier City.
  storage.setItem(
    'dossier:placeLookupConfirmed:tiger hill, darjeeling',
    JSON.stringify({ name: 'Tiger Hill', locality: '', city: 'Rangli Rangliot Jorebunglow Sukiapokhri West Bengal', lat: 27.01, lng: 88.26 }),
  );
  const result = getCachedConfirmedResult({ name: 'Tiger Hill', locationName: 'Darjeeling' }, { storage });
  assert.equal(result, null, 'a lookup under the CURRENT versioned key must not find the old-key entry at all — it should behave exactly like an ordinary cache miss');
});

await test('a raw entry that exists under the CURRENT key prefix but lacks a valid/matching version stamp is also rejected, not trusted', () => {
  const storage = makeMemoryStorage();
  // Same current key prefix as a real v2 entry, but the stored value
  // itself carries no matching __cacheVersion — e.g. a value written
  // by some other/older logic that happened to reuse this key, or a
  // future format this version of the code doesn't understand yet.
  storage.setItem(
    'dossier:placeLookupConfirmed:v2:tiger hill, darjeeling',
    JSON.stringify({ name: 'Tiger Hill', city: 'Rangli Rangliot Jorebunglow Sukiapokhri West Bengal' }), // no __cacheVersion at all
  );
  const result = getCachedConfirmedResult({ name: 'Tiger Hill', locationName: 'Darjeeling' }, { storage });
  assert.equal(result, null, 'missing/mismatched version stamp must be treated as untrustworthy, not silently accepted');
});

await test('after a stale-cache miss, the normal lookup path is free to run again and produce a CORRECT result via buildConfirmedPlace', () => {
  const storage = makeMemoryStorage();
  storage.setItem(
    'dossier:placeLookupConfirmed:tiger hill, darjeeling', // old key, ignored entirely by current code
    JSON.stringify({ name: 'Tiger Hill', city: 'Rangli Rangliot Jorebunglow Sukiapokhri West Bengal' }),
  );
  assert.equal(getCachedConfirmedResult({ name: 'Tiger Hill', locationName: 'Darjeeling' }, { storage }), null);
  // Confirms the caller (PlaceLookup.jsx's handleFindPlace) is left to
  // do a real lookupPlace() + buildConfirmedPlace() in this situation,
  // exactly as it does on any other cache miss — no special-casing
  // required elsewhere for this to be safe, and the fix from Part 3
  // (buildConfirmedPlace preserving the known Dossier City) still
  // applies normally afterward.
  const freshResult = buildConfirmedPlace(
    { name: 'Tiger Hill', lat: 27.01, lng: 88.26, raw: { address: { county: 'Rangli Rangliot Jorebunglow Sukiapokhri', state: 'West Bengal' } } },
    'Darjeeling',
  );
  assert.equal(freshResult.city, 'Darjeeling', 'once the stale entry is ignored, a fresh confirmation correctly preserves the known Dossier City');
  assert.equal(freshResult.locality, 'Rangli Rangliot Jorebunglow Sukiapokhri');
});

await test('a NEW confirmation is written under the versioned key and round-trips correctly, including through the exact Tiger Hill scenario', () => {
  const storage = makeMemoryStorage();
  const place = buildConfirmedPlace(
    { name: 'Tiger Hill', lat: 27.01, lng: 88.26, raw: { address: { county: 'Rangli Rangliot Jorebunglow Sukiapokhri', state: 'West Bengal' } } },
    'Darjeeling',
  );
  setCachedConfirmedResult({ name: 'Tiger Hill', locationName: 'Darjeeling' }, place, { storage });
  const cached = getCachedConfirmedResult({ name: 'Tiger Hill', locationName: 'Darjeeling' }, { storage });
  assert.deepEqual(cached, place, 'a correctly-versioned round trip must return exactly what was written, with the version stamp invisible to the caller');
  assert.equal(cached.city, 'Darjeeling');
  assert.notEqual(cached.city, 'Rangli Rangliot Jorebunglow Sukiapokhri West Bengal');
});

await test('an unrelated localStorage key (not this cache at all) is left completely alone by a get/set cycle', () => {
  const storage = makeMemoryStorage();
  storage.setItem('someOtherApp:unrelatedKey', 'do-not-touch');
  setCachedConfirmedResult({ name: 'Ganesh Temple' }, { name: 'Ganesh Temple' }, { storage });
  assert.equal(storage.getItem('someOtherApp:unrelatedKey'), 'do-not-touch', 'this cache must never read, write, or otherwise disturb keys outside its own prefix');
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
