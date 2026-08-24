// Runtime integration test — real IndexedDB behavior via fake-indexeddb
// (a standard, widely-used polyfill; Node has no native IndexedDB).
// Exercises the actual application code in db/connection.js, db/stores/*,
// and db/extraction.js — not a re-implementation of it.
//
// Run with: npm test

import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { __resetDbForTest } from '../connection.js';
import { createDestination, deleteDestination, getDestination } from '../stores/destinations.js';
import { createAttraction, listAttractions, updateAttraction, deleteAttraction } from '../stores/attractions.js';
import { createRestaurantEntry, isPlaceBased } from '../stores/restaurants.js';
import { createTransportEntry, listTransportEntries } from '../stores/transport.js';
import { createCostEntry } from '../stores/costs.js';
import { createIntake, getIntake, updateCandidate, acceptCandidate, rejectCandidate, resetCandidateToPending } from '../stores/intake.js';
import { extractCandidates, extractPriceFromText } from '../extraction.js';
import { buildGoogleMapsUrl } from '../../lib/googleMaps.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    __resetDbForTest();
    // Each test gets a fresh fake-indexeddb database name so tests don't
    // interfere with each other's data.
    globalThis.indexedDB = new (await import('fake-indexeddb')).IDBFactory();
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${e.stack}`);
  }
}

console.log('\n=== Dossier (new) Runtime Verification ===\n');

console.log('1. Destinations');
await test('create, get, delete a destination', async () => {
  const dest = await createDestination({ name: 'Sri Lanka', overview: 'Island nation' });
  assert.equal(dest.name, 'Sri Lanka');
  const fetched = await getDestination(dest.id);
  assert.equal(fetched.overview, 'Island nation');
  await deleteDestination(dest.id);
  assert.equal(await getDestination(dest.id), null);
});

console.log('\n2. Section stores — manual create/edit/delete');
await test('attraction: create, edit, soft-delete', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const item = await createAttraction(dest.id, {
    place: { name: 'Galle Fort', city: 'Galle' },
    category: 'landmark',
    description: 'Best visited at sunset.',
    price: { amount: 0, currency: 'LKR', note: 'Free entry' },
  });
  assert.equal(item.place.name, 'Galle Fort');
  assert.equal(item.provenance, 'manual');

  const updated = await updateAttraction(item.id, { category: 'fort' });
  assert.equal(updated.category, 'fort');
  assert.equal(updated.place.name, 'Galle Fort', 'unrelated fields preserved on partial update');

  await deleteAttraction(item.id);
  const list = await listAttractions(dest.id);
  assert.equal(list.length, 0, 'soft-deleted item should not appear in list');
});

await test('restaurant: place-based and non-place entries both work', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const placeEntry = await createRestaurantEntry(dest.id, { place: { name: 'Ministry of Crab' }, cuisine: 'Seafood' });
  const dishEntry = await createRestaurantEntry(dest.id, { dishName: 'Hoppers', dietaryNotes: 'Often vegetarian-friendly' });
  assert.equal(isPlaceBased(placeEntry), true);
  assert.equal(isPlaceBased(dishEntry), false);
});

await test('transport: from/to relationship', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const item = await createTransportEntry(dest.id, {
    from: { label: 'Colombo', place: null },
    to: { label: 'Kandy', place: null },
    mode: 'train',
  });
  assert.equal(item.from.label, 'Colombo');
  assert.equal(item.to.label, 'Kandy');
  const list = await listTransportEntries(dest.id);
  assert.equal(list.length, 1);
});

console.log('\n3. Money / currency');
await test('price preserves original currency, no conversion logic touches it', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  const item = await createCostEntry(dest.id, { item: 'SIM card', price: { amount: 300, currency: 'THB' } });
  assert.equal(item.price.currency, 'THB');
  assert.equal(item.price.amount, 300);
});

console.log('\n4. Google Maps link building');
await test('uses stored googleMapsUrl when present', () => {
  const url = buildGoogleMapsUrl({ name: 'Sigiriya', googleMapsUrl: 'https://maps.app.goo.gl/abc123' });
  assert.equal(url, 'https://maps.app.goo.gl/abc123');
});
await test('generates a search URL with the approved format when no stored link', () => {
  const url = buildGoogleMapsUrl({ name: 'Galle Fort', city: 'Galle' }, 'Sri Lanka');
  assert.ok(url.startsWith('https://www.google.com/maps/search/?api=1&query='));
  assert.ok(url.includes(encodeURIComponent('Galle Fort')));
});
await test('returns null when place has no name', () => {
  assert.equal(buildGoogleMapsUrl({ name: '' }), null);
  assert.equal(buildGoogleMapsUrl(null), null);
});

console.log('\n5. Structured extraction (headings, lists, label:value)');
await test('recognizes a heading and classifies subsequent list items', () => {
  const text = 'Attractions\n- Sigiriya: entry LKR 1500\n- Galle Fort\n\nRestaurants\n- Ministry of Crab';
  const candidates = extractCandidates(text);
  const attractionCandidates = candidates.filter(c => c.proposedSection === 'attractions');
  const restaurantCandidates = candidates.filter(c => c.proposedSection === 'restaurants');
  assert.equal(attractionCandidates.length, 2);
  assert.equal(restaurantCandidates.length, 1);
  assert.equal(attractionCandidates[0].proposedFields.placeName, 'Sigiriya');
  assert.equal(attractionCandidates[0].proposedFields.price.amount, 1500);
  assert.equal(attractionCandidates[0].proposedFields.price.currency, 'LKR');
});

await test('text with no heading match leaves candidates unclassified, not guessed', () => {
  const candidates = extractCandidates('Some random travel musings with no clear structure at all here.');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].proposedSection, null);
  assert.ok(candidates[0].uncertaintyNote);
});

await test('extractPriceFromText recognizes free and currency+amount, ignores plain numbers', () => {
  assert.deepEqual(extractPriceFromText('Entry is free'), { amount: 0, currency: '', unit: '', note: 'Free' });
  assert.equal(extractPriceFromText('Costs LKR 1,500 per person').amount, 1500);
  assert.equal(extractPriceFromText('Costs LKR 1,500 per person').currency, 'LKR');
  assert.equal(extractPriceFromText('Room 204, second floor'), null, 'a bare number should not be misread as a price');
});

console.log('\n6. Full intake -> candidate -> review -> record flow');
await test('candidates are never auto-accepted; explicit accept required', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const { intake, candidates } = await createIntake({
    destinationId: dest.id,
    rawText: 'Attractions\n- Sigiriya: entry LKR 1500',
  });
  assert.equal(candidates[0].status, 'pending_review');
  const fetched = await getIntake(intake.id);
  assert.equal(fetched.candidates[0].status, 'pending_review', 'candidate must still be pending after creation — nothing auto-accepted');
  assert.equal(fetched.intake.rawText, 'Attractions\n- Sigiriya: entry LKR 1500', 'original text preserved verbatim');
});

await test('accept writes into the real section store via the same creator manual entry uses', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const { candidates } = await createIntake({ destinationId: dest.id, rawText: 'Attractions\n- Sigiriya' });
  const candidate = candidates[0];

  await assert.rejects(
    () => acceptCandidate(candidate.id, { section: 'attractions', sectionFields: { place: { name: '' } } }),
  );

  const record = await acceptCandidate(candidate.id, {
    section: 'attractions',
    sectionFields: { place: { name: 'Sigiriya' }, category: '', description: '', price: null },
  });
  assert.equal(record.place.name, 'Sigiriya');
  assert.equal(record.provenance, 'imported');
  assert.equal(record.candidateId, candidate.id, 'provenance link preserved');

  const list = await listAttractions(dest.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, record.id);

  const afterAccept = await getIntake((await getIntake(candidate.intakeId))?.intake?.id || candidate.intakeId);
  const updatedCandidate = afterAccept.candidates.find(c => c.id === candidate.id);
  assert.equal(updatedCandidate.status, 'accepted');
  assert.equal(updatedCandidate.resultingRecordId, record.id);
});

await test('reject and undo (reset to pending) work; accepted cannot be reset', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const { candidates } = await createIntake({ destinationId: dest.id, rawText: 'Attractions\n- Sigiriya\n- Galle Fort' });

  await rejectCandidate(candidates[0].id);
  let fetched = await getIntake(candidates[0].intakeId);
  assert.equal(fetched.candidates.find(c => c.id === candidates[0].id).status, 'rejected');

  await resetCandidateToPending(candidates[0].id);
  fetched = await getIntake(candidates[0].intakeId);
  assert.equal(fetched.candidates.find(c => c.id === candidates[0].id).status, 'pending_review');

  const record = await acceptCandidate(candidates[1].id, {
    section: 'attractions',
    sectionFields: { place: { name: 'Galle Fort' }, category: '', description: '', price: null },
  });
  assert.ok(record.id);
  await assert.rejects(() => resetCandidateToPending(candidates[1].id), /already became a research record/);
});

await test('candidate fields can be edited during review before accepting', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const { candidates } = await createIntake({ destinationId: dest.id, rawText: 'Attractions\n- Sigiriya' });
  const updated = await updateCandidate(candidates[0].id, { proposedFields: { placeName: 'Sigiriya Rock Fortress' } });
  assert.equal(updated.proposedFields.placeName, 'Sigiriya Rock Fortress');
});

await test('manually-created and candidate-accepted attractions share the same shape', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const manual = await createAttraction(dest.id, { place: { name: 'Manual Place' } });
  const { candidates } = await createIntake({ destinationId: dest.id, rawText: 'Attractions\n- Imported Place' });
  const accepted = await acceptCandidate(candidates[0].id, {
    section: 'attractions',
    sectionFields: { place: { name: 'Imported Place' }, category: '', description: '', price: null },
  });
  assert.equal(
    Object.keys(manual).sort().join(','),
    Object.keys(accepted).sort().join(','),
    'manually-created and candidate-accepted records must have identical field shapes'
  );
});

console.log('\n7. Persistence across a simulated page reload');
await test('data survives resetting the in-memory db singleton (simulates a page reload) while IndexedDB itself is untouched', async () => {
  // __resetDbForTest() clears only our module-level singleton — exactly
  // what happens to JS state on a real page reload. globalThis.indexedDB
  // (the fake-indexeddb backing store) is deliberately NOT swapped here,
  // matching how a real browser's IndexedDB survives a reload even
  // though all JS state is torn down and rebuilt from scratch.
  const dest = await createDestination({ name: 'Persistence Check', overview: 'Should survive reload' });
  await createAttraction(dest.id, { place: { name: 'Some Fort' } });

  __resetDbForTest(); // simulates reload: new getDb() call reopens the connection from scratch

  const reloaded = await getDestination(dest.id);
  assert.ok(reloaded, 'destination should still be found after simulated reload');
  assert.equal(reloaded.overview, 'Should survive reload');
  const items = await listAttractions(dest.id);
  assert.equal(items.length, 1, 'attraction should still be present after simulated reload');
  assert.equal(items[0].place.name, 'Some Fort');
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);