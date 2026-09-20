// Add-flow routing verification — src/lib/addEntryRouting.js, the pure
// logic backing src/components/AddEntry.jsx's navigation decisions.
//
// This project has no React component test harness (every existing
// test — foundation.test.js, pdf.test.js, placeLookup.test.js — is
// plain Node/data-level), so the pure path-construction logic behind
// the Add flow was extracted into a plain .js file specifically so it
// can be imported and tested directly here, rather than attempting to
// render the .jsx component (which plain Node cannot import at all).
//
// Run with: node src/db/__tests__/addEntry.test.js

import assert from 'node:assert/strict';
import { buildAddDestinationPath, SECTIONS_WITHOUT_AUTO_OPEN, matchCurrentSection, consumeAutoOpenFlag } from '../../lib/addEntryRouting.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failed++;
    console.log(`  \u2717 ${name}\n    ${e.stack}`);
  }
}

console.log('\n1. Add flow - path construction with context inheritance');
await test('a normal section (e.g. attractions) gets new=1 to auto-open its real form', () => {
  const path = buildAddDestinationPath({ key: 'attractions', path: 'attractions' }, 'dest-1', null);
  assert.equal(path, '/destinations/dest-1/attractions?new=1');
});

await test('a known city/location context is carried through as location=', () => {
  const path = buildAddDestinationPath({ key: 'attractions', path: 'attractions' }, 'dest-1', 'loc-1');
  assert.equal(path, '/destinations/dest-1/attractions?new=1&location=loc-1');
});

await test('no location context (destination-wide) omits location entirely, not an empty value', () => {
  const path = buildAddDestinationPath({ key: 'attractions', path: 'attractions' }, 'dest-1', null);
  assert.ok(!path.includes('location='));
});

await test('Practical Info is excluded from auto-open (topic-first UX) but still routes to its page', () => {
  assert.ok(SECTIONS_WITHOUT_AUTO_OPEN.has('practicalInfo'));
  const path = buildAddDestinationPath({ key: 'practicalInfo', path: 'practical-info' }, 'dest-1', null);
  assert.equal(path, '/destinations/dest-1/practical-info', 'no new=1 for a section with a genuinely different add UX');
});

await test('Packing is excluded from auto-open (category-checklist UX) but still routes to its page', () => {
  assert.ok(SECTIONS_WITHOUT_AUTO_OPEN.has('packingNotes'));
  const path = buildAddDestinationPath({ key: 'packingNotes', path: 'packing' }, 'dest-1', null);
  assert.equal(path, '/destinations/dest-1/packing');
});

await test('Practical Info with a location context still omits new=1 but keeps location=', () => {
  const path = buildAddDestinationPath({ key: 'practicalInfo', path: 'practical-info' }, 'dest-1', 'loc-1');
  assert.equal(path, '/destinations/dest-1/practical-info?location=loc-1');
});

await test('the Dishes section routes through its own path, which redirects into Food and Restaurants (DishesPage.jsx handles that, not this function)', () => {
  const path = buildAddDestinationPath({ key: 'dishes', path: 'dishes' }, 'dest-1', null);
  assert.equal(path, '/destinations/dest-1/dishes?new=1');
});

console.log('\n2. Current-section detection (Case A: Destination -> City -> Section -> + Add)');

const TEST_SECTIONS = [
  { key: 'attractions', path: 'attractions' },
  { key: 'restaurants', path: 'restaurants' },
  { key: 'practicalInfo', path: 'practical-info' },
];

await test('a URL already inside a section page matches that section', () => {
  const section = matchCurrentSection('/destinations/dest-1/attractions', 'dest-1', TEST_SECTIONS);
  assert.equal(section?.key, 'attractions');
});

await test('a multi-segment section path (e.g. practical-info) still matches exactly', () => {
  const section = matchCurrentSection('/destinations/dest-1/practical-info', 'dest-1', TEST_SECTIONS);
  assert.equal(section?.key, 'practicalInfo');
});

await test('a trailing slash on the section URL still matches', () => {
  const section = matchCurrentSection('/destinations/dest-1/attractions/', 'dest-1', TEST_SECTIONS);
  assert.equal(section?.key, 'attractions');
});

await test('the destination overview page itself (no section segment) does not match any section', () => {
  const section = matchCurrentSection('/destinations/dest-1', 'dest-1', TEST_SECTIONS);
  assert.equal(section, null);
});

await test('a page for a DIFFERENT destination never matches, even with the same section path', () => {
  const section = matchCurrentSection('/destinations/dest-2/attractions', 'dest-1', TEST_SECTIONS);
  assert.equal(section, null, 'the destinationId in the URL must match the one being checked against');
});

await test('an unrecognized path segment (not any known section) matches nothing', () => {
  const section = matchCurrentSection('/destinations/dest-1/currency', 'dest-1', TEST_SECTIONS);
  assert.equal(section, null);
});

await test('a missing destinationId (e.g. on Home) never matches, regardless of pathname', () => {
  const section = matchCurrentSection('/', undefined, TEST_SECTIONS);
  assert.equal(section, null);
});

console.log('\n3. End-to-end Dossier City context propagation (the actual "+ Add from inside a city-scoped section" runtime chain)');

// These trace the REAL multi-step pipeline a person's tap on "+ Add"
// actually goes through when already on
// /destinations/dest-1/attractions?location=loc-xyz — not any single
// function in isolation, since that's exactly what let the earlier
// "city doesn't auto-fill" bug slip past a matchCurrentSection-only
// test suite. Each step below uses the SAME functions the real app
// uses (buildAddDestinationPath, consumeAutoOpenFlag), chained in the
// same order components/AppShell.jsx's openAdd() and
// hooks/useAutoOpenNewForm.js actually apply them.

const ATTRACTIONS_SECTION = { key: 'attractions', path: 'attractions' };

await test('step 1: openAdd() on a city-scoped section page builds a URL that carries BOTH new=1 and the city', () => {
  // This is what AppShell.jsx's openAdd() computes and calls
  // navigate() with, when currentSection/currentDestinationId/
  // currentLocationId are already known from the current page.
  const path = buildAddDestinationPath(ATTRACTIONS_SECTION, 'dest-1', 'loc-xyz');
  assert.equal(path, '/destinations/dest-1/attractions?new=1&location=loc-xyz');
});

await test('step 2: after the section page mounts and consumes new=1, the city context survives in the URL', () => {
  // Simulates AttractionsPage mounting at the URL from step 1, then
  // useAutoOpenNewForm's effect firing (via consumeAutoOpenFlag, the
  // exact function it calls) to strip `new` once the form has opened.
  const initialUrl = new URL('http://x/destinations/dest-1/attractions?new=1&location=loc-xyz');
  const cleaned = consumeAutoOpenFlag(initialUrl.searchParams);
  assert.equal(cleaned.get('new'), null, 'new=1 should be consumed/removed once the form has opened');
  assert.equal(cleaned.get('location'), 'loc-xyz', 'the Dossier City context must survive the new=1 cleanup untouched — this is the exact value AttractionsPage re-reads as contextLocationId, and what AttractionForm/LocationScopeField ultimately lock the form to');
});

await test('step 3: the full chain end-to-end — the city that goes IN to openAdd() is the exact city that comes OUT for the new form, with no other params lost along the way', () => {
  const path = buildAddDestinationPath(ATTRACTIONS_SECTION, 'dest-1', 'loc-xyz');
  const url = new URL('http://x' + path);
  const afterCleanup = consumeAutoOpenFlag(url.searchParams);
  assert.equal(afterCleanup.get('location'), 'loc-xyz');
  assert.equal(afterCleanup.toString(), 'location=loc-xyz', 'no leftover new=1 and no unexpected extra/missing params');
});

await test('the whole-destination case (no city) still correctly produces no location param anywhere in the chain — never a stray empty string', () => {
  const path = buildAddDestinationPath(ATTRACTIONS_SECTION, 'dest-1', null);
  const url = new URL('http://x' + path);
  const afterCleanup = consumeAutoOpenFlag(url.searchParams);
  assert.equal(afterCleanup.get('location'), null);
});

await test('consumeAutoOpenFlag never touches params it does not know about (defensive: future params added to the URL by other features survive too)', () => {
  const params = new URLSearchParams('new=1&location=loc-xyz&tab=research');
  const cleaned = consumeAutoOpenFlag(params);
  assert.equal(cleaned.get('location'), 'loc-xyz');
  assert.equal(cleaned.get('tab'), 'research');
  assert.equal(cleaned.get('new'), null);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
