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
import { buildAddDestinationPath, SECTIONS_WITHOUT_AUTO_OPEN, matchCurrentSection } from '../../lib/addEntryRouting.js';

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

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
