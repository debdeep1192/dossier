// Tour Planning, Phase 3 — Research <-> Planning integration.
//
// Real IndexedDB behavior via fake-indexeddb, exercising the actual
// application code (db/stores/*, lib/researchSummary.js,
// lib/researchNavigation.js, lib/researchReferences.js) — same harness
// style as foundation.test.js. The React components are thin views
// over these pure/derived functions (this project has no React test
// harness by design), so the behaviour that matters — what a summary
// shows, what a picker row previews and selects, which Plannings a
// Research entry is used in and whether it is in the current
// itinerary — is tested here at that level.
//
// Run with: npm run test:research-planning

import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { __resetDbForTest, getDb, getOne, put } from '../connection.js';
import { createDestination } from '../stores/destinations.js';
import { createAttraction, listAttractions, deleteAttraction } from '../stores/attractions.js';
import { createRestaurantEntry, listRestaurantEntries } from '../stores/restaurants.js';
import { createAccommodation } from '../stores/accommodations.js';
import { createTransportEntry } from '../stores/transport.js';
import { createPlanning, updatePlanning, deletePlanning, listPlanningDays } from '../stores/plannings.js';
import { createTimelineItem, listTimelineItems, updateTimelineItem, deleteTimelineItem } from '../stores/timelineItems.js';
import { createOptionGroup, selectOption, deleteOptionGroup, listOptionGroupsForPlanning } from '../stores/planningOptionGroups.js';
import { createItemAlternative, deleteItemAlternative, listAlternativesForItem, updateItemAlternative } from '../stores/itemAlternatives.js';
import { listReviewFlagsForPlanning } from '../stores/planningReviewFlags.js';
import { emptyFeeBand } from '../../lib/feeBands.js';
import { emptyOpeningHours } from '../../lib/openingHours.js';
import {
  buildResearchSummary, buildResearchPreview, buildPickerSections, filterPickerSections, pickerSelectionFor,
  describeResearchRecord, formatDurationRange, safeMapsUrl,
} from '../../lib/researchSummary.js';
import { buildResearchEntryPath, consumeOpenParam, findRecordToOpen } from '../../lib/researchNavigation.js';
import { loadPlanningReferenceData, deriveResearchReferences } from '../../lib/researchReferences.js';
import { auditMustSeeAttractions, buildNeedsAttention, summarizeNeedsAttention } from '../../lib/planningAwareness.js';
import { isAlternativeCurrentlyIncluded, calculatePlanningCostBreakdown } from '../../lib/planningCosts.js';
import { checkItemOverlap } from '../../lib/planningValidation.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    __resetDbForTest();
    globalThis.indexedDB = new (await import('fake-indexeddb')).IDBFactory();
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${e.stack}`);
  }
}

// Every day-long fixture window used below.
const TRIP = { startDate: '2026-12-20', endDate: '2026-12-24' };

async function refsFor(destinationId, researchRefType, researchRefId) {
  const planningData = await loadPlanningReferenceData(destinationId);
  return deriveResearchReferences({ researchRefType, researchRefId, planningData });
}

console.log('\n=== Phase 3: Research <-> Planning integration ===\n');

// ---------------------------------------------------------------------------
console.log('A. Open Research from Planning');

await test('A1. a valid reference resolves to the correct record and its summary shows the essentials', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const feeBand = { ...emptyFeeBand('INR'), status: 'paid', amount: '100' };
  const hours = emptyOpeningHours();
  hours[0].ranges = [{ start: '04:00', end: '06:30' }];
  const tigerHill = await createAttraction(dest.id, {
    place: { name: 'Tiger Hill', locality: 'Ghoom', city: 'Darjeeling', address: 'Tiger Hill Rd, Ghoom', googleMapsUrl: 'https://maps.app.goo.gl/abc123' },
    category: 'Viewpoint', visitPriority: 'must_see', feeBands: [feeBand], openingHours: hours,
    typicalDurationMin: 90, typicalDurationMax: 120,
  });
  await createAttraction(dest.id, { place: { name: 'Batasia Loop' } });

  const planning = await createPlanning(dest.id, { name: 'December Trip', ...TRIP });
  await createTimelineItem(planning.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: tigerHill.id, startTime: '04:00' });
  const item = (await listTimelineItems(planning.id))[0];

  // Resolve exactly the way PlanningDetailPage does: by id, from the
  // destination's active records.
  const byId = Object.fromEntries((await listAttractions(dest.id)).map(r => [r.id, r]));
  const record = byId[item.researchRefId];
  assert.equal(record.id, tigerHill.id);

  const summary = buildResearchSummary(item.researchRefType, record, { destinationName: 'Darjeeling' });
  assert.equal(summary.name, 'Tiger Hill');
  assert.equal(summary.typeLabel, 'Attraction');
  assert.equal(summary.subtitle, 'Viewpoint');
  assert.equal(summary.location, 'Tiger Hill Rd, Ghoom');
  assert.deepEqual(summary.badges, [{ kind: 'visitPriority', value: 'must_see', label: 'Must see' }]);
  const facts = Object.fromEntries(summary.facts.map(f => [f.label, f.value]));
  assert.equal(facts['Typical duration'], '1 h 30 min–2 h');
  assert.ok(facts['Opening hours'].includes('04:00–06:30'));
  assert.ok(facts['Entry'].includes('100'));
});

await test('A2. the Planning item stores only a reference; inspecting Research never copies the record into Planning', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Tiger Hill' }, visitPriority: 'must_see', category: 'Viewpoint' });
  const planning = await createPlanning(dest.id, { name: 'Trip', ...TRIP });
  const created = await createTimelineItem(planning.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id });
  buildResearchSummary('attractions', attraction, { destinationName: 'Darjeeling' });
  const reread = (await listTimelineItems(planning.id))[0];
  assert.equal(reread.researchRefId, attraction.id);
  assert.equal(reread.title, '', 'no Research name copied onto the item');
  assert.deepEqual(reread, created, 'building a summary changes nothing on the item');
  for (const key of ['place', 'category', 'visitPriority', 'feeBands', 'openingHours']) {
    assert.equal(key in reread, false, `Research field "${key}" must not be duplicated onto the timeline item`);
  }
});

await test('A3. the full-entry link targets that record\'s own section page with the record id, for every referenceable type', async () => {
  assert.equal(buildResearchEntryPath('d1', 'attractions', 'a1'), '/destinations/d1/attractions?open=a1');
  assert.equal(buildResearchEntryPath('d1', 'restaurants', 'r1'), '/destinations/d1/restaurants?open=r1');
  assert.equal(buildResearchEntryPath('d1', 'accommodations', 'h1'), '/destinations/d1/accommodations?open=h1');
  assert.equal(buildResearchEntryPath('d1', 'transport', 't1'), '/destinations/d1/transport?open=t1');
  assert.ok(buildResearchEntryPath('d1', 'attractions', 'a b&c').endsWith('?open=a+b%26c'), 'ids are URL-encoded');
  assert.equal(buildResearchEntryPath('d1', 'weatherNotes', 'w1'), null, 'a non-referenceable section yields no link');
  assert.equal(buildResearchEntryPath('d1', 'attractions', null), null);
  assert.equal(buildResearchEntryPath(null, 'attractions', 'a1'), null);
});

await test('A4. the open flag finds exactly the requested record, and consuming it keeps location/tab params', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const a = await createAttraction(dest.id, { place: { name: 'Tiger Hill' } });
  const b = await createAttraction(dest.id, { place: { name: 'Tiger Hill' } }); // same name, different record
  const records = await listAttractions(dest.id);
  assert.equal(findRecordToOpen(records, b.id).id, b.id, 'exact id match — never the same-named sibling');
  assert.equal(findRecordToOpen(records, a.id).id, a.id);

  const next = consumeOpenParam('?open=abc&location=loc1&tab=dishes');
  assert.equal(next.get('open'), null);
  assert.equal(next.get('location'), 'loc1');
  assert.equal(next.get('tab'), 'dishes');
});

await test('A5. a soft-deleted or unknown Research entry opens nothing — no fallback to another record, no crash', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const gone = await createAttraction(dest.id, { place: { name: 'Old Monastery' } });
  const other = await createAttraction(dest.id, { place: { name: 'Zoo' } });
  await deleteAttraction(gone.id);
  const records = await listAttractions(dest.id);
  assert.equal(findRecordToOpen(records, gone.id), null);
  assert.equal(findRecordToOpen(records, 'no-such-id'), null);
  assert.equal(findRecordToOpen(undefined, gone.id), null, 'records not loaded yet is not an error');
  assert.equal(findRecordToOpen(records, other.id).id, other.id);

  // The summary of a record that no longer resolves is null (the UI shows
  // its own "no longer available" state) rather than a guess.
  assert.equal(buildResearchSummary('attractions', undefined, {}), null);
  assert.equal(buildResearchSummary('attractions', null, {}), null);
  assert.equal(buildResearchPreview('attractions', undefined).parts.length, 0);
});

await test('A6. the Planning item stays fully usable after its Research entry is soft-deleted', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const gone = await createAttraction(dest.id, { place: { name: 'Old Monastery' } });
  const planning = await createPlanning(dest.id, { name: 'Trip', ...TRIP });
  const item = await createTimelineItem(planning.id, 2, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: gone.id, startTime: '10:00', plannedDuration: 60 });
  await deleteAttraction(gone.id);

  const byId = Object.fromEntries((await listAttractions(dest.id)).map(r => [r.id, r]));
  assert.equal(byId[item.researchRefId], undefined, 'resolves to nothing — never to a different record');

  const updated = await updateTimelineItem(item.id, { notes: 'still editable', startTime: '11:00' });
  assert.equal(updated.notes, 'still editable');
  assert.equal(updated.researchRefId, gone.id, 'the reference itself is left exactly as stored');
  assert.equal(updated.dayNumber, 2);
  const [reread] = await listTimelineItems(planning.id);
  assert.equal(reread.id, item.id);
});

await test('A7. Google Maps: stored link wins; otherwise a generated search link; unsafe/invalid stored values never become the href', async () => {
  const stored = { name: 'Tiger Hill', googleMapsUrl: 'https://maps.app.goo.gl/abc123' };
  assert.equal(safeMapsUrl(stored, 'Darjeeling'), 'https://maps.app.goo.gl/abc123');

  const generated = safeMapsUrl({ name: 'Tiger Hill', locality: 'Ghoom' }, 'Darjeeling');
  assert.equal(generated, 'https://www.google.com/maps/search/?api=1&query=Tiger%20Hill%2C%20Ghoom');

  const unsafe = safeMapsUrl({ name: 'Tiger Hill', googleMapsUrl: 'javascript:alert(1)' }, 'Darjeeling');
  assert.ok(unsafe.startsWith('https://www.google.com/maps/search/'), 'a non-http(s) stored value falls back to the generated search link');
  const junk = safeMapsUrl({ name: 'Tiger Hill', googleMapsUrl: 'not a url' }, 'Darjeeling');
  assert.ok(junk.startsWith('https://www.google.com/maps/search/'));

  assert.equal(safeMapsUrl({ name: '' }, 'Darjeeling'), null, 'no name and no link -> no map action');
  assert.equal(safeMapsUrl(null, 'Darjeeling'), null);
});

await test('A8. missing map/location data is handled gracefully: no link, no location, no crash', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  // A legacy dish-only restaurant record has no place at all.
  const legacy = await createRestaurantEntry(dest.id, { place: null, dishName: 'Momos', cuisine: 'Tibetan' });
  const summary = buildResearchSummary('restaurants', legacy, { destinationName: 'Darjeeling' });
  assert.equal(summary.name, 'Momos');
  assert.equal(summary.location, '');
  assert.deepEqual(summary.mapLinks, []);

  // Inter-city transport with bare city labels only: nothing is a valid map location.
  const bus = await createTransportEntry(dest.id, { from: { label: 'Siliguri', place: null }, to: { label: 'Darjeeling', place: null }, mode: 'Bus' });
  const busSummary = buildResearchSummary('transport', bus, { destinationName: 'Darjeeling' });
  assert.equal(busSummary.name, 'Siliguri → Darjeeling');
  assert.deepEqual(busSummary.mapLinks, []);

  // Local transport has no endpoints to link.
  const local = await createTransportEntry(dest.id, { travelType: 'local', mode: 'Taxi' });
  assert.deepEqual(buildResearchSummary('transport', local, {}).mapLinks, []);

  // Transport endpoints WITH stored place details do get links.
  const train = await createTransportEntry(dest.id, {
    from: { label: 'NJP', place: { name: 'New Jalpaiguri Junction', googleMapsUrl: 'https://maps.app.goo.gl/njp' } },
    to: { label: 'Darjeeling', place: { name: 'Darjeeling Station' } },
    mode: 'Train',
  });
  const trainLinks = buildResearchSummary('transport', train, { destinationName: 'Darjeeling' }).mapLinks;
  assert.equal(trainLinks.length, 2);
  assert.equal(trainLinks[0].url, 'https://maps.app.goo.gl/njp');
  assert.ok(trainLinks[1].url.includes('Darjeeling%20Station'));
});

await test('A9. a record missing nearly every optional field produces a clean, minimal summary — nothing invented', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const bare = await createAttraction(dest.id, { place: { name: 'Mystery Spot' } });
  const summary = buildResearchSummary('attractions', bare, { destinationName: 'Darjeeling' });
  assert.equal(summary.name, 'Mystery Spot');
  assert.equal(summary.subtitle, '');
  assert.deepEqual(summary.badges, []);
  assert.deepEqual(summary.facts, [], 'no "Unknown"/"Not set" filler facts');

  // A legacy attraction (string openingHours, old single price) still summarizes.
  const legacy = { id: 'x', place: { name: 'Old Fort' }, openingHours: '9-5', price: { amount: '50', currency: 'INR' }, typicalDurationMinutes: 45 };
  const legacySummary = buildResearchSummary('attractions', legacy, {});
  assert.equal(legacySummary.name, 'Old Fort');
  assert.ok(legacySummary.facts.some(f => f.label === 'Typical duration' && f.value === '45 minutes'));
});

await test('A10. the summary is category-specific and shows only relevant essentials for each Research type', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const restaurant = await createRestaurantEntry(dest.id, {
    place: { name: 'Keventers', locality: 'Nehru Road', city: 'Darjeeling' }, cuisine: 'Cafe', priceTier: 'regular',
    price: { amount: '600', currency: 'INR', unit: 'For 2 persons', note: '' }, typicalDurationMin: 45, typicalDurationMax: 45,
  });
  const rs = buildResearchSummary('restaurants', restaurant, { destinationName: 'Darjeeling' });
  assert.equal(rs.subtitle, 'Cafe');
  assert.deepEqual(rs.badges, [{ kind: 'priceTier', value: 'regular', label: 'Regular' }]);
  assert.equal(rs.location, 'Nehru Road, Darjeeling');
  assert.deepEqual(rs.facts.map(f => f.label), ['Typical price', 'Typical meal duration']);
  assert.equal(rs.facts[0].value, 'INR 600 · For 2 persons');
  assert.equal(rs.facts[1].value, '45 min');

  const hotel = await createAccommodation(dest.id, {
    place: { name: 'Mayfair Hill Resort', city: 'Darjeeling' }, accommodationType: 'Hotel / Resort',
    price: { amount: '5500', currency: 'INR', unit: 'Per room per night', note: '' },
  });
  const hs = buildResearchSummary('accommodations', hotel, { destinationName: 'Darjeeling' });
  assert.equal(hs.subtitle, 'Hotel / Resort');
  assert.deepEqual(hs.facts, [{ label: 'Price', value: 'INR 5500 · Per room per night' }]);
  assert.equal(hs.mapLinks.length, 1);

  const train = await createTransportEntry(dest.id, {
    from: { label: 'NJP' }, to: { label: 'Darjeeling' }, mode: 'Other', modeOther: 'Toy train',
    duration: 'about 7 hours', price: { amount: '1200', currency: 'INR', unit: 'Per person', note: '' },
  });
  const ts = buildResearchSummary('transport', train, {});
  assert.equal(ts.subtitle, 'Toy train', '"Other" shows the person\'s own description');
  assert.deepEqual(ts.facts, [{ label: 'Duration', value: 'about 7 hours' }, { label: 'Price', value: 'INR 1200 · Per person' }]);
});

// ---------------------------------------------------------------------------
console.log('\nB. Research picker');

await test('B1. search still filters by name (case-insensitive substring), and an empty query lists everything', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  await createAttraction(dest.id, { place: { name: 'Tiger Hill' } });
  await createAttraction(dest.id, { place: { name: 'Batasia Loop' } });
  await createRestaurantEntry(dest.id, { place: { name: 'Tiger Cafe' } });
  const sections = buildPickerSections([
    { type: 'attractions', label: 'Attractions', items: await listAttractions(dest.id) },
    { type: 'restaurants', label: 'Restaurants', items: await listRestaurantEntries(dest.id) },
    { type: 'accommodations', label: 'Accommodation', items: [] },
  ]);

  const all = filterPickerSections(sections, '');
  assert.deepEqual(all.map(s => s.type), ['attractions', 'restaurants'], 'empty sections are dropped');
  assert.equal(all[0].rows.length, 2);

  const tiger = filterPickerSections(sections, '  TIGER ');
  assert.deepEqual(tiger.map(s => [s.type, s.rows.map(r => r.label)]), [['attractions', ['Tiger Hill']], ['restaurants', ['Tiger Cafe']]]);
  assert.deepEqual(filterPickerSections(sections, 'zzz'), []);
  // Search is by name only: a category/preview word does not match.
  assert.deepEqual(filterPickerSections(sections, 'viewpoint'), []);
});

await test('B2. selecting a row yields the same {researchRefType, researchRefId, label} reference as before, distinguishing same-named entries by id', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const a = await createAttraction(dest.id, { place: { name: 'Tea Estate' }, category: 'Tea garden', typicalDurationMin: 60 });
  const b = await createAttraction(dest.id, { place: { name: 'Tea Estate' }, category: 'Factory tour', typicalDurationMin: 30 });
  const sections = buildPickerSections([{ type: 'attractions', label: 'Attractions', items: await listAttractions(dest.id) }]);
  const rows = sections[0].rows;
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].preview.parts.join('|'), rows[1].preview.parts.join('|'), 'similar entries are distinguishable from their previews');

  const pickedB = pickerSelectionFor('attractions', rows.find(r => r.item.id === b.id));
  assert.deepEqual(pickedB, { researchRefType: 'attractions', researchRefId: b.id, label: 'Tea Estate' });

  const planning = await createPlanning(dest.id, { name: 'Trip', ...TRIP });
  const item = await createTimelineItem(planning.id, 1, { itemType: 'attraction', researchRefType: pickedB.researchRefType, researchRefId: pickedB.researchRefId });
  assert.equal(item.researchRefId, b.id);
  assert.notEqual(item.researchRefId, a.id);
});

await test('B3. previews are category-specific and built only from existing fields', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const hours = emptyOpeningHours();
  hours[0].days = ['daily'];
  hours[0].ranges = [{ start: '09:00', end: '17:00' }];
  const attraction = await createAttraction(dest.id, { place: { name: 'Zoo' }, category: 'Zoo', visitPriority: 'must_see', typicalDurationMin: 120, typicalDurationMax: 180, openingHours: hours });
  const ap = buildResearchPreview('attractions', attraction);
  assert.deepEqual(ap.badge, { kind: 'visitPriority', value: 'must_see', label: 'Must see' });
  assert.deepEqual(ap.parts, ['Zoo', '2 h–3 h', 'Daily: 09:00–17:00']);

  const restaurant = await createRestaurantEntry(dest.id, {
    place: { name: 'Glenary\'s', locality: 'Mall Road', city: 'Darjeeling' }, cuisine: 'Bakery', priceTier: 'budget',
    price: { amount: '400', currency: 'INR', unit: 'For 2 persons', note: '' },
  });
  const rp = buildResearchPreview('restaurants', restaurant);
  assert.deepEqual(rp.badge, { kind: 'priceTier', value: 'budget', label: 'Budget-friendly' });
  assert.deepEqual(rp.parts, ['Bakery', 'INR 400 · For 2 persons', 'Mall Road, Darjeeling']);

  const hotel = await createAccommodation(dest.id, { place: { name: 'Windamere', locality: 'Observatory Hill', city: 'Darjeeling' }, accommodationType: 'Hotel / Resort', price: { amount: '9000', currency: 'INR', unit: 'Per room per night', note: '' } });
  assert.deepEqual(buildResearchPreview('accommodations', hotel).parts, ['Hotel / Resort', 'Observatory Hill, Darjeeling', 'INR 9000 · Per room per night']);
  assert.equal(buildResearchPreview('accommodations', hotel).badge, null);

  const taxi = await createTransportEntry(dest.id, { from: { label: 'Darjeeling' }, to: { label: 'Ghoom' }, mode: 'Shared cab', typicalDurationMin: 30, price: { amount: '80', currency: 'INR', unit: 'Per person', note: '' } });
  assert.deepEqual(buildResearchPreview('transport', taxi).parts, ['Shared cab', '30 min', 'INR 80 · Per person']);

  // Not every category shows the same fields.
  assert.ok(!rp.parts.some(p => p.includes('09:00')), 'a restaurant preview does not borrow attraction-style fields');
});

await test('B4. missing optional fields never throw and produce an empty (not filler) preview', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const bareAttraction = await createAttraction(dest.id, { place: { name: 'Mystery Spot' } });
  const bareRestaurant = await createRestaurantEntry(dest.id, { place: { name: 'Nameless Diner' } });
  const bareHotel = await createAccommodation(dest.id, { place: { name: 'Plain Inn' } });
  const bareTransport = await createTransportEntry(dest.id, { from: { label: 'A' }, to: { label: 'B' } });
  for (const [type, record] of [['attractions', bareAttraction], ['restaurants', bareRestaurant], ['accommodations', bareHotel], ['transport', bareTransport]]) {
    const preview = buildResearchPreview(type, record);
    assert.deepEqual(preview, { badge: null, parts: [] }, `${type}: empty preview, no crash`);
  }
  assert.deepEqual(buildResearchPreview('unknown-type', { id: 'x' }), { badge: null, parts: [] });
  assert.equal(formatDurationRange('', null), null);
  assert.equal(formatDurationRange('abc', -5), null);
  assert.equal(formatDurationRange(0, 0), null);
  // Records that predate structured fields (no typicalDuration* keys at all).
  assert.deepEqual(buildResearchPreview('attractions', { id: 'old', place: { name: 'Old' } }).parts, []);
});

await test('B5. building previews reads only the records already loaded: no database access and no mutation of the records', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Zoo' }, category: 'Zoo', typicalDurationMin: 60 });
  const restaurant = await createRestaurantEntry(dest.id, { place: { name: 'Cafe' }, cuisine: 'Cafe' });
  const items = await listAttractions(dest.id);
  const snapshot = JSON.stringify([items, restaurant]);

  const realIndexedDb = globalThis.indexedDB;
  globalThis.indexedDB = undefined; // any DB access from here on would throw
  try {
    const sections = buildPickerSections([{ type: 'attractions', label: 'Attractions', items }, { type: 'restaurants', label: 'Restaurants', items: [restaurant] }]);
    filterPickerSections(sections, 'zoo');
    buildResearchSummary('attractions', attraction, { destinationName: 'Darjeeling' });
  } finally {
    globalThis.indexedDB = realIndexedDb;
  }
  assert.equal(JSON.stringify([items, restaurant]), snapshot, 'records are not mutated by previews/summaries');
});

await test('B6. picking for an Option item or an item alternative keeps the existing option/alternative semantics', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const tigerHill = await createAttraction(dest.id, { place: { name: 'Tiger Hill' } });
  const zoo = await createAttraction(dest.id, { place: { name: 'Zoo' } });
  const sections = buildPickerSections([{ type: 'attractions', label: 'Attractions', items: await listAttractions(dest.id) }]);
  const pick = name => pickerSelectionFor('attractions', sections[0].rows.find(r => r.label === name));

  const planning = await createPlanning(dest.id, { name: 'Trip', ...TRIP });
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  const optionItem = await createTimelineItem(planning.id, 1, { itemType: 'attraction', ...pick('Tiger Hill'), optionGroupId: group.id, optionLabel: 'A', partLabel: 'Morning' });
  assert.equal(optionItem.optionLabel, 'A');
  assert.equal(group.selectedOptionLabel, null, 'picking never auto-selects an Option');

  const alt = await createItemAlternative(optionItem.id, { ...pick('Zoo') });
  assert.equal(alt.researchRefId, zoo.id);
  assert.equal(alt.selected, false, 'picking never auto-selects an alternative');
  assert.equal(isAlternativeCurrentlyIncluded(alt, optionItem, { [group.id]: group }), false);
  assert.equal(optionItem.researchRefId, tigerHill.id);
});

// ---------------------------------------------------------------------------
console.log('\nC. Reverse references');

await test('C1. an entry used by one Planning lists that Planning, in the current itinerary', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Tiger Hill' } });
  const planning = await createPlanning(dest.id, { name: 'Darjeeling December Trip', ...TRIP });
  await createTimelineItem(planning.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id });

  const refs = await refsFor(dest.id, 'attractions', attraction.id);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].planning.id, planning.id);
  assert.equal(refs[0].planning.name, 'Darjeeling December Trip');
  assert.equal(refs[0].status, 'included');
  assert.deepEqual(refs[0].reasons, []);
});

await test('C2. an entry used by several independent Plannings lists each once; unrelated Plannings are excluded', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const tigerHill = await createAttraction(dest.id, { place: { name: 'Tiger Hill' } });
  const zoo = await createAttraction(dest.id, { place: { name: 'Zoo' } });
  const december = await createPlanning(dest.id, { name: 'Darjeeling December Trip', startDate: '2026-12-20', endDate: '2026-12-24' });
  const family = await createPlanning(dest.id, { name: 'Darjeeling Family Trip', startDate: '2027-05-01', endDate: '2027-05-04' });
  const other = await createPlanning(dest.id, { name: 'Zoo only', startDate: '2027-06-01', endDate: '2027-06-02' });
  await createTimelineItem(december.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: tigerHill.id });
  await createTimelineItem(family.id, 2, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: tigerHill.id });
  await createTimelineItem(other.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: zoo.id });

  const refs = await refsFor(dest.id, 'attractions', tigerHill.id);
  assert.deepEqual(refs.map(r => r.planning.name), ['Darjeeling Family Trip', 'Darjeeling December Trip'], 'each Planning once, most recent first');
  assert.ok(refs.every(r => r.status === 'included'));
});

await test('C3. several references inside one Planning (items + alternative) still list that Planning exactly once', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Tiger Hill' } });
  const other = await createAttraction(dest.id, { place: { name: 'Zoo' } });
  const planning = await createPlanning(dest.id, { name: 'Trip', ...TRIP });
  await createTimelineItem(planning.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id });
  await createTimelineItem(planning.id, 3, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id });
  const host = await createTimelineItem(planning.id, 2, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: other.id });
  await createItemAlternative(host.id, { researchRefType: 'attractions', researchRefId: attraction.id });

  const refs = await refsFor(dest.id, 'attractions', attraction.id);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].referenceCount, 3);
});

await test('C4. soft-deleted timeline items and soft-deleted alternatives create no active reference', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Tiger Hill' } });
  const host = await createAttraction(dest.id, { place: { name: 'Zoo' } });
  const planning = await createPlanning(dest.id, { name: 'Trip', ...TRIP });
  const directItem = await createTimelineItem(planning.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id });
  const hostItem = await createTimelineItem(planning.id, 2, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: host.id });
  const alt = await createItemAlternative(hostItem.id, { researchRefType: 'attractions', researchRefId: attraction.id });
  assert.equal((await refsFor(dest.id, 'attractions', attraction.id)).length, 1, 'sanity: referenced before deletion');

  await deleteTimelineItem(directItem.id);
  assert.equal((await refsFor(dest.id, 'attractions', attraction.id)).length, 1, 'the alternative still references it');
  await deleteItemAlternative(alt.id);
  assert.deepEqual(await refsFor(dest.id, 'attractions', attraction.id), [], 'no false active reference remains');
});

await test('C5. alternatives under a soft-deleted parent item are not active references', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Tiger Hill' } });
  const planning = await createPlanning(dest.id, { name: 'Trip', ...TRIP });
  const parent = await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'Morning slot' });
  await createItemAlternative(parent.id, { researchRefType: 'attractions', researchRefId: attraction.id, selected: true });
  assert.equal((await refsFor(dest.id, 'attractions', attraction.id)).length, 1);
  await deleteTimelineItem(parent.id);
  assert.deepEqual(await refsFor(dest.id, 'attractions', attraction.id), []);
});

await test('C6. an item inside an unselected or pending Option is "referenced", NOT in the current itinerary; selecting its Option makes it included', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const tigerHill = await createAttraction(dest.id, { place: { name: 'Tiger Hill' } });
  const zoo = await createAttraction(dest.id, { place: { name: 'Zoo' } });
  const planning = await createPlanning(dest.id, { name: 'Trip', ...TRIP });
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  await createTimelineItem(planning.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: tigerHill.id, optionGroupId: group.id, optionLabel: 'A', partLabel: 'Morning' });
  await createTimelineItem(planning.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: zoo.id, optionGroupId: group.id, optionLabel: 'B', partLabel: 'Morning' });

  // Selection pending: neither Option is current.
  let refs = await refsFor(dest.id, 'attractions', tigerHill.id);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].status, 'referenced');
  assert.deepEqual(refs[0].reasons, ['option_not_selected']);

  await selectOption(group.id, 'B');
  refs = await refsFor(dest.id, 'attractions', tigerHill.id);
  assert.equal(refs[0].status, 'referenced', 'Option A is explicitly not the selected one');
  assert.equal((await refsFor(dest.id, 'attractions', zoo.id))[0].status, 'included');

  await selectOption(group.id, 'A');
  assert.equal((await refsFor(dest.id, 'attractions', tigerHill.id))[0].status, 'included');
  assert.equal((await refsFor(dest.id, 'attractions', zoo.id))[0].status, 'referenced');

  await selectOption(group.id, null); // deselect -> reopens pending
  assert.equal((await refsFor(dest.id, 'attractions', tigerHill.id))[0].status, 'referenced');
});

await test('C7. item alternatives: a non-selected alternative is referenced-only; selected under an included parent is included; selected under an unselected Option is not', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const lunchA = await createRestaurantEntry(dest.id, { place: { name: 'Lunch A' } });
  const lunchB = await createRestaurantEntry(dest.id, { place: { name: 'Lunch B' } });
  const planning = await createPlanning(dest.id, { name: 'Trip', ...TRIP });
  const lunch = await createTimelineItem(planning.id, 1, { itemType: 'meal', researchRefType: 'restaurants', researchRefId: lunchA.id });
  const altB = await createItemAlternative(lunch.id, { researchRefType: 'restaurants', researchRefId: lunchB.id });

  let refs = await refsFor(dest.id, 'restaurants', lunchB.id);
  assert.equal(refs[0].status, 'referenced');
  assert.deepEqual(refs[0].reasons, ['alternative_not_selected']);

  await updateItemAlternative(altB.id, { selected: true });
  refs = await refsFor(dest.id, 'restaurants', lunchB.id);
  assert.equal(refs[0].status, 'included');

  // Now the parent moves into an unselected Option: the selected alternative no longer counts.
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Midday' });
  await updateTimelineItem(lunch.id, { optionGroupId: group.id, optionLabel: 'A', partLabel: 'Midday' });
  refs = await refsFor(dest.id, 'restaurants', lunchB.id);
  assert.equal(refs[0].status, 'referenced');
  assert.deepEqual(refs[0].reasons, ['option_not_selected']);
  await selectOption(group.id, 'A');
  assert.equal((await refsFor(dest.id, 'restaurants', lunchB.id))[0].status, 'included');
});

await test('C8. soft-deleted Plannings never appear', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Tiger Hill' } });
  const keep = await createPlanning(dest.id, { name: 'Keep', ...TRIP });
  const drop = await createPlanning(dest.id, { name: 'Drop', ...TRIP });
  await createTimelineItem(keep.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id });
  await createTimelineItem(drop.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id });
  assert.equal((await refsFor(dest.id, 'attractions', attraction.id)).length, 2);
  await deletePlanning(drop.id);
  const refs = await refsFor(dest.id, 'attractions', attraction.id);
  assert.deepEqual(refs.map(r => r.planning.name), ['Keep']);
});

await test('C9. deleting an Option group keeps its items as ordinary items, so their Research references stay (now as current-itinerary inclusion); legacy orphans read the same way', async () => {
  // Phase 4 changed this on purpose. Phase 3 skipped items orphaned by a
  // deleted group because the Planning page could not show them; the page now
  // shows them as the ordinary items they revert to, so they ARE references.
  const dest = await createDestination({ name: 'Darjeeling' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Tiger Hill' } });
  const planning = await createPlanning(dest.id, { name: 'Trip', ...TRIP });
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  await createTimelineItem(planning.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id, optionGroupId: group.id, optionLabel: 'A', partLabel: 'Morning' });
  assert.equal((await refsFor(dest.id, 'attractions', attraction.id))[0].status, 'referenced', 'pending group: not in the current itinerary yet');
  await deleteOptionGroup(group.id);
  const after = await refsFor(dest.id, 'attractions', attraction.id);
  assert.equal(after.length, 1);
  assert.equal(after[0].status, 'included');

  // A record orphaned by the OLD deletion (group row deleted, item still pointing at it).
  const legacyGroup = await createOptionGroup(planning.id, { dayNumber: 2, partLabel: 'Evening' });
  const legacyItem = await createTimelineItem(planning.id, 2, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id, optionGroupId: legacyGroup.id, optionLabel: 'A', partLabel: 'Evening' });
  await put('planningOptionGroups', { ...(await getOne('planningOptionGroups', legacyGroup.id)), deletedAt: new Date().toISOString() });
  const legacy = await refsFor(dest.id, 'attractions', attraction.id);
  assert.equal(legacy.length, 1, 'still one row for the Planning');
  assert.equal(legacy[0].referenceCount, 2, 'the orphan now counts as a visible reference');
  assert.equal((await getOne('timelineItems', legacyItem.id)).optionGroupId, legacyGroup.id, 'read-only: the stored orphan is not rewritten');
});

await test('C10. an entry with no references (and an entry nobody used) gives a clean empty result', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const unused = await createAttraction(dest.id, { place: { name: 'Unused' } });
  assert.deepEqual(await refsFor(dest.id, 'attractions', unused.id), [], 'no Plannings at all');
  const planning = await createPlanning(dest.id, { name: 'Empty trip', ...TRIP });
  assert.ok(planning.id);
  assert.deepEqual(await refsFor(dest.id, 'attractions', unused.id), [], 'a Planning with no items');
  assert.deepEqual(deriveResearchReferences({ researchRefType: 'attractions', researchRefId: unused.id, planningData: undefined }), []);
  assert.deepEqual(deriveResearchReferences({ researchRefType: null, researchRefId: null, planningData: [] }), []);
});

await test('C11. references are matched by type AND id, and only same-destination Plannings are considered', async () => {
  const darjeeling = await createDestination({ name: 'Darjeeling' });
  const sikkim = await createDestination({ name: 'Sikkim' });
  const attraction = await createAttraction(darjeeling.id, { place: { name: 'Tiger Hill' } });
  const dPlanning = await createPlanning(darjeeling.id, { name: 'D trip', ...TRIP });
  const sPlanning = await createPlanning(sikkim.id, { name: 'S trip', ...TRIP });
  await createTimelineItem(dPlanning.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id });
  await createTimelineItem(sPlanning.id, 1, { itemType: 'custom', title: 'Unrelated' });

  assert.deepEqual((await refsFor(darjeeling.id, 'attractions', attraction.id)).map(r => r.planning.name), ['D trip']);
  assert.deepEqual(await refsFor(darjeeling.id, 'restaurants', attraction.id), [], 'same id under a different Research type is not a match');
  assert.deepEqual(await refsFor(sikkim.id, 'attractions', attraction.id), []);
});

await test('C12. included Plannings sort before referenced-only ones; referenced-only carry a reason', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Tiger Hill' } });
  const early = await createPlanning(dest.id, { name: 'Early (option only)', startDate: '2030-01-01', endDate: '2030-01-03' });
  const late = await createPlanning(dest.id, { name: 'Late (in itinerary)', startDate: '2026-01-01', endDate: '2026-01-03' });
  const group = await createOptionGroup(early.id, { dayNumber: 1, partLabel: 'Morning' });
  await createTimelineItem(early.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id, optionGroupId: group.id, optionLabel: 'A', partLabel: 'Morning' });
  await createTimelineItem(late.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id });
  const refs = await refsFor(dest.id, 'attractions', attraction.id);
  assert.deepEqual(refs.map(r => [r.planning.name, r.status]), [['Late (in itinerary)', 'included'], ['Early (option only)', 'referenced']]);
});

await test('C13. "included" agrees with the Phase 2 Must-see audit for the same Planning state', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const mustSee = await createAttraction(dest.id, { place: { name: 'Tiger Hill' }, visitPriority: 'must_see' });
  const planning = await createPlanning(dest.id, { name: 'Trip', ...TRIP });
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  await createTimelineItem(planning.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: mustSee.id, optionGroupId: group.id, optionLabel: 'A', partLabel: 'Morning' });

  async function auditStatus() {
    const timelineItems = await listTimelineItems(planning.id);
    const optionGroups = await listOptionGroupsForPlanning(planning.id);
    const alternativesByItemId = {};
    for (const item of timelineItems) alternativesByItemId[item.id] = await listAlternativesForItem(item.id);
    return auditMustSeeAttractions({
      attractions: await listAttractions(dest.id), timelineItems, alternativesByItemId,
      optionGroupsById: Object.fromEntries(optionGroups.map(g => [g.id, g])), reviewFlags: await listReviewFlagsForPlanning(planning.id),
    })[0].status;
  }

  for (const selection of [null, 'B', 'A']) {
    await selectOption(group.id, selection);
    const refs = await refsFor(dest.id, 'attractions', mustSee.id);
    const auditIncluded = (await auditStatus()) === 'included';
    assert.equal(refs[0].status === 'included', auditIncluded, `selection=${selection}: references and audit agree on current inclusion`);
  }
});

await test('C14. deriving references is read-only and needs no schema change (database version and store list unchanged)', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Tiger Hill' } });
  const planning = await createPlanning(dest.id, { name: 'Trip', ...TRIP });
  await createTimelineItem(planning.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id });
  const before = JSON.stringify(await listTimelineItems(planning.id));
  await refsFor(dest.id, 'attractions', attraction.id);
  assert.equal(JSON.stringify(await listTimelineItems(planning.id)), before);

  const db = await getDb();
  assert.equal(db.version, 10, 'database version is still 10 — Phase 3 added no migration');
  assert.deepEqual([...db.objectStoreNames].sort(), [
    'accommodations', 'appSettings', 'attractions', 'candidates', 'costs', 'destinations', 'dishes', 'exchangeRates',
    'generalNotes', 'intakeDocuments', 'itemAlternatives', 'journeys', 'locations', 'packingNotes', 'people',
    'planningOptionGroups', 'planningReviewFlags', 'plannings', 'practicalInfo', 'restaurants', 'shoppingItems',
    'shops', 'sources', 'timelineItems', 'transport', 'weatherNotes',
  ], 'no new store (in particular, no reverse-reference store)');
});

// ---------------------------------------------------------------------------
console.log('\nD. Regression — Phase 1/2 behaviour alongside the new integration');

await test('D1. Must-see audit and Needs Attention still work for a Planning that uses the new reference features', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const mustSee = await createAttraction(dest.id, { place: { name: 'Tiger Hill' }, visitPriority: 'must_see' });
  const planning = await createPlanning(dest.id, { name: 'Trip', ...TRIP });
  await createOptionGroup(planning.id, { dayNumber: 2, partLabel: 'Afternoon' });
  const timelineItems = await listTimelineItems(planning.id);
  const optionGroups = await listOptionGroupsForPlanning(planning.id);
  const attractions = await listAttractions(dest.id);

  await refsFor(dest.id, 'attractions', mustSee.id); // exercising reverse references must not disturb anything

  const audit = auditMustSeeAttractions({ attractions, timelineItems, alternativesByItemId: {}, optionGroupsById: {}, reviewFlags: [] });
  assert.equal(audit[0].status, 'unresolved');
  const attention = buildNeedsAttention({ timelineItems, optionGroups, alternativesByItemId: {}, attractions, reviewFlags: [], currentDayCount: 5 });
  const summary = summarizeNeedsAttention(attention);
  assert.equal(summary.pendingOptions, 1);
  assert.equal(summary.mustSeeUnresolved, 1);

  await createTimelineItem(planning.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: mustSee.id, startTime: '04:30' });
  const after = auditMustSeeAttractions({ attractions, timelineItems: await listTimelineItems(planning.id), alternativesByItemId: {}, optionGroupsById: {}, reviewFlags: [] });
  assert.equal(after[0].status, 'included');
});

await test('D2. Planning cost calculation is unaffected', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const band = { ...emptyFeeBand('INR'), status: 'paid', amount: '250' };
  const attraction = await createAttraction(dest.id, { place: { name: 'Zoo' }, feeBands: [band] });
  const planning = await createPlanning(dest.id, { name: 'Trip', ...TRIP });
  const item = await createTimelineItem(planning.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id, costSelections: { selectedFeeBandIds: [band.id] } });
  const custom = await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'Souvenirs', costSelections: { estimateOverride: { amount: '500', currency: 'INR' } } });
  await refsFor(dest.id, 'attractions', attraction.id);
  const records = { [attraction.id]: attraction };
  const breakdown = calculatePlanningCostBreakdown({
    items: [item, custom], alternatives: [], optionGroupsById: {}, travellerAges: [30], // one adult: a fee band is charged per qualifying traveller
    getRecordForItem: (i) => (i.researchRefId ? records[i.researchRefId] : null),
  });
  assert.equal(breakdown.categoryTotals.attractions.INR, 250);
  assert.equal(breakdown.categoryTotals.other.INR, 500);
});

await test('D3. date shifts keep every item on its day number, and references do not change', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Tiger Hill' } });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-12-20', endDate: '2026-12-24' });
  await createTimelineItem(planning.id, 3, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id });
  const before = await refsFor(dest.id, 'attractions', attraction.id);

  const shifted = await updatePlanning(planning.id, { startDate: '2027-01-10', endDate: '2027-01-14' });
  assert.equal(listPlanningDays(shifted).find(d => d.dayNumber === 3).date, '2027-01-12');
  assert.equal((await listTimelineItems(planning.id))[0].dayNumber, 3, 'still Day 3');
  const after = await refsFor(dest.id, 'attractions', attraction.id);
  assert.deepEqual(after.map(r => [r.planning.id, r.status]), before.map(r => [r.planning.id, r.status]));
});

await test('D4. shortening a trip deletes nothing from later days, and their references still count', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Tiger Hill' } });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-12-20', endDate: '2026-12-26' });
  await createTimelineItem(planning.id, 6, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id });
  await updatePlanning(planning.id, { endDate: '2026-12-22' }); // now only 3 days
  const items = await listTimelineItems(planning.id);
  assert.equal(items.length, 1);
  assert.equal(items[0].dayNumber, 6);
  assert.equal((await refsFor(dest.id, 'attractions', attraction.id)).length, 1);
});

await test('D5. schedule conflict detection still works', async () => {
  const a = { startTime: '09:00', plannedDuration: 90, buffer: 0 };
  const b = { startTime: '10:00', plannedDuration: 30, buffer: 0 };
  const c = { startTime: '11:00', plannedDuration: 30, buffer: 0 };
  assert.ok(checkItemOverlap(a, b), 'overlapping items are flagged');
  assert.equal(checkItemOverlap(a, c), null, 'back-to-back without overlap is not');
});

await test('D6. describeResearchRecord keeps the existing per-section display-name rules', async () => {
  assert.equal(describeResearchRecord('attractions', { place: { name: 'Tiger Hill' } }), 'Tiger Hill');
  assert.equal(describeResearchRecord('attractions', { place: null }), 'Untitled');
  assert.equal(describeResearchRecord('restaurants', { place: null, dishName: 'Momos' }), 'Momos');
  assert.equal(describeResearchRecord('restaurants', { place: null }), 'Food note');
  assert.equal(describeResearchRecord('transport', { travelType: 'local', mode: 'Taxi' }), 'Local transport — Taxi');
  assert.equal(describeResearchRecord('transport', { from: { label: 'A' }, to: { label: 'B' } }), 'A → B');
  assert.equal(describeResearchRecord('transport', {}), '? → ?');
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
