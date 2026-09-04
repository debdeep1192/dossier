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
import { createCostEntry, getCostEntry } from '../stores/costs.js';
import { createIntake, getIntake, updateCandidate, acceptCandidate, rejectCandidate, resetCandidateToPending } from '../stores/intake.js';
import { extractCandidates, extractPriceFromText } from '../extraction.js';
import { buildGoogleMapsUrl } from '../../lib/googleMaps.js';
import { reconstructLines, stripRepeatedPageBoilerplate } from '../../lib/pdfText.js';
import { createAccommodation } from '../stores/accommodations.js';
import { createWeatherNote, normalizeWeatherNote } from '../stores/weatherNotes.js';
import { emptyFeeBand, formatFeeBands } from '../../lib/feeBands.js';
import { formatOpeningHours } from '../../lib/openingHours.js';
import { CORE_CURRENCIES, getCurrencyOptions, addDestinationCurrency, setExchangeRate, getExchangeRate, convertAmount } from '../currency.js';
import { createShoppingItem } from '../stores/shoppingItems.js';
import { createLocation, listLocations, updateLocation, deleteLocation, getLocation } from '../stores/locations.js';
import { createPracticalInfoEntry, listPracticalInfoEntries } from '../stores/practicalInfo.js';

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

await test('a plain narrative paragraph (no bullet) never becomes a candidate, even under a matching heading', () => {
  const text = 'Attractions\nThe guide is explicitly built around a relaxed pace, giving travellers time to enjoy the town without rushing between sights.';
  const candidates = extractCandidates(text);
  assert.equal(candidates.length, 0, 'a narrative paragraph must never become a candidate, regardless of heading');
});

await test('a bulleted line with no heading match is surfaced as unclassified, not guessed or dropped', () => {
  const candidates = extractCandidates('- Some bulleted fact with no heading above it');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].proposedSection, null);
  assert.ok(candidates[0].uncertaintyNote);
});

console.log('\n5a. Extraction false-positive protection (realistic Darjeeling-style document)');
await test('conservative extraction rejects narrative/itinerary/meta content while keeping real bulleted attractions', () => {
  const doc = [
    'Darjeeling Travel Guide',
    '',
    'This guide is explicitly built around a relaxed, family-friendly pace through the hills.',
    '',
    'Day 1',
    '- 08:00–09:30 Breakfast at the hotel',
    '- 10:00 Depart for Tiger Hill',
    '',
    'Attractions',
    '- Tiger Hill',
    '- Batasia Loop',
    '- Japanese Peace Pagoda',
    '- Lloyd\'s Botanical Garden',
    '- Observatory Hill',
    '',
    'Shopping commentary: Darjeeling tea is world famous and makes a wonderful gift for friends and family back home, especially the first-flush variety.',
    '',
    '---',
    '',
    'Closing note from the original document: this itinerary was compiled from multiple sources and may need verification before travel.',
  ].join('\n');

  const candidates = extractCandidates(doc);
  const attractionNames = candidates.filter(c => c.proposedSection === 'attractions').map(c => c.sourceExcerpt);

  assert.deepEqual(
    attractionNames.sort(),
    ['Batasia Loop', 'Japanese Peace Pagoda', "Lloyd's Botanical Garden", 'Observatory Hill', 'Tiger Hill'].sort(),
    'real bulleted attractions should all be recognized'
  );

  // None of the narrative/itinerary/meta lines should appear as a
  // candidate under ANY section, unclassified included.
  const allExcerpts = candidates.map(c => c.sourceExcerpt);
  assert.ok(!allExcerpts.some(t => t.includes('explicitly built around')), 'intro narrative must not become a candidate');
  assert.ok(!allExcerpts.some(t => t.includes('Breakfast at the hotel')), 'itinerary/schedule lines must not become a candidate');
  assert.ok(!allExcerpts.some(t => t.includes('Depart for Tiger Hill')), 'itinerary/schedule lines must not become a candidate');
  assert.ok(!allExcerpts.some(t => t.includes('Shopping commentary')), 'narrative commentary paragraph must not become a candidate');
  assert.ok(!allExcerpts.some(t => t.includes('Closing note from the original document')), 'document meta-commentary must not become a candidate');
  assert.ok(!allExcerpts.some(t => t === '---'), 'separator lines must never become a candidate');
});

await test('extractPriceFromText recognizes free and currency+amount, ignores plain numbers', () => {
  assert.deepEqual(extractPriceFromText('Entry is free'), { amount: 0, currency: '', unit: '', note: 'Free' });
  assert.equal(extractPriceFromText('Costs LKR 1,500 per person').amount, 1500);
  assert.equal(extractPriceFromText('Costs LKR 1,500 per person').currency, 'LKR');
  assert.equal(extractPriceFromText('Room 204, second floor'), null, 'a bare number should not be misread as a price');
});

console.log('\n5b. Extraction regression suite (real Darjeeling-parser failure)');

// Scenario 1: normal bullet attraction list -> individual candidates.
await test('scenario 1: a normal bullet attraction list produces one candidate per attraction', () => {
  const doc = ['Attractions & Activities', '- Tiger Hill', '- Batasia Loop', '- Ghum Monastery'].join('\n');
  const candidates = extractCandidates(doc);
  assert.equal(candidates.length, 3);
  assert.ok(candidates.every(c => c.proposedSection === 'attractions'));
  assert.deepEqual(candidates.map(c => c.sourceExcerpt), ['Tiger Hill', 'Batasia Loop', 'Ghum Monastery']);
});

// Scenario 2: narrative paragraph under an Attractions heading -> zero attraction candidates.
await test('scenario 2: narrative prose under an Attractions heading produces zero candidates', () => {
  const doc = [
    'Attractions & Activities',
    'Darjeeling offers a remarkable range of viewpoints and colonial-era landmarks, each shaped by the town\'s unique history as a hill station retreat and its enduring relationship with the surrounding tea gardens and mountain vistas.',
  ].join('\n');
  const candidates = extractCandidates(doc);
  assert.equal(candidates.length, 0, 'a narrative paragraph must never become a candidate merely for sitting under a matching heading');
});

// Scenario 3: large narrative Food & Restaurants section -> zero restaurant candidates from the history/background prose specifically.
await test('scenario 3: historical/background prose in a Food & Restaurants section produces no candidates from that prose', () => {
  const doc = [
    'Food & Restaurants',
    'HISTORY, MUST-TRY DISHES, AND WHERE TO EAT THEM',
    'History & Evolution of Darjeeling\'s Food',
    'The culinary identity of Darjeeling reflects its Nepali, Tibetan, and Bengali influences, shaped over more than a century by migration and trade along the old Himalayan routes connecting Sikkim, Nepal, and Tibet to the plains of Bengal.',
  ].join('\n');
  const candidates = extractCandidates(doc);
  assert.equal(candidates.length, 0, 'historical/background narrative must produce zero candidates, even under a restaurants heading');
});

// Scenario 4 & Tables: hotel table with multiple rows -> separate accommodation candidates, name/area/rating/price mapped, not one giant candidate.
await test('scenario 4: a hotel table with a header row produces one distinct accommodation candidate per row', () => {
  const doc = [
    'Hotels',
    'Hotel | Area | Rating | Price/Night | Why Consider It',
    'Dekeling Hotel | Near Chowrasta | 9.2/10 | ₹2,800–3,400 | Heritage-style rooms with excellent service and mountain views',
    'Muscatel Stardust | CR Das Road, Chowrasta | 8.9/10 | ₹3,500 | Deluxe rooms with modern amenities',
    'Villa Everest | Close to Chowrasta | 9.0/10 | ₹2,800–3,300 | Quiet property with good breakfast',
    'Hotel Seven Seventeen | Near Chowrasta | 8.5/10 | ₹2,600 | Budget-friendly with basic amenities',
    'Windamere Hotel | Observatory Hill | 9.5/10 | ₹8,500 | Historic colonial-era hotel with old-world charm',
  ].join('\n');
  const candidates = extractCandidates(doc);
  assert.equal(candidates.length, 5, 'the table must produce exactly one candidate per data row, not one giant candidate for the whole table');
  assert.ok(candidates.every(c => c.proposedSection === 'accommodations'));
  const names = candidates.map(c => c.proposedFields.placeName);
  assert.deepEqual(names, ['Dekeling Hotel', 'Muscatel Stardust', 'Villa Everest', 'Hotel Seven Seventeen', 'Windamere Hotel']);
  // A row whose own name happens to contain a column keyword ("Hotel
  // Seven Seventeen" contains "Hotel") must still be extracted as its
  // own row, not misdetected as a second header row and swallowed.
  const sevenSeventeen = candidates.find(c => c.proposedFields.placeName === 'Hotel Seven Seventeen');
  assert.ok(sevenSeventeen, 'a hotel whose name contains a column keyword must not be lost');
  assert.equal(sevenSeventeen.proposedFields.placeArea, 'Near Chowrasta');
  assert.ok(sevenSeventeen.proposedFields.price, 'price should be extracted from the row');
  assert.equal(sevenSeventeen.proposedFields.price.amount, 2600);
  // Rating and the "why consider it" text must be preserved, not
  // discarded, even though there's no dedicated schema field for a
  // star rating — see "do not lose information."
  assert.ok(sevenSeventeen.proposedFields.amenityNotes.includes('8.5/10'));
  assert.ok(sevenSeventeen.proposedFields.amenityNotes.includes('Budget-friendly'));
});

// Scenario 5: restaurant table/list -> separate restaurant candidates.
await test('scenario 5: a restaurant list produces separate restaurant candidates', () => {
  const doc = ['Where to Eat', "- Glenary's", "- Keventer's", '- Kunga Restaurant'].join('\n');
  const candidates = extractCandidates(doc);
  assert.equal(candidates.length, 3);
  assert.ok(candidates.every(c => c.proposedSection === 'restaurants'));
});

// Scenario 6: PDF-style line wrapping does not accidentally merge unrelated records.
await test('scenario 6: reconstructed PDF lines keep each record on its own candidate, not merged', () => {
  // Simulates what lib/pdfText.js now hands to the extractor after
  // reconstructing real lines from pdfjs's hasEOL-delimited text items
  // — one attraction name per line, exactly as a real toy-train/hill
  // guide's list would appear once bullets are lost in extraction.
  const doc = ['Attractions & Activities', 'Tiger Hill', 'Batasia Loop', 'Ghum Monastery'].join('\n');
  const candidates = extractCandidates(doc);
  assert.equal(candidates.length, 3, 'each reconstructed line should remain its own candidate, not merge into a giant blob');
  assert.deepEqual(candidates.map(c => c.sourceExcerpt), ['Tiger Hill', 'Batasia Loop', 'Ghum Monastery']);
});

// Scenario 7: repeated PDF page footer removed/ignored.
await test('scenario 7: a repeated page-footer-style line is ignored, not surfaced as a candidate', () => {
  const doc = [
    'Attractions & Activities',
    '- Tiger Hill',
    'Darjeeling - The Complete Guide | 17/33',
    '- Batasia Loop',
    'Page 18 of 33',
    '- Ghum Monastery',
  ].join('\n');
  const candidates = extractCandidates(doc);
  assert.equal(candidates.length, 3, 'page-footer/page-number lines must never become candidates');
  assert.ok(!candidates.some(c => c.sourceExcerpt.includes('Complete Guide')));
  assert.ok(!candidates.some(c => c.sourceExcerpt.includes('Page 18')));
});

// Scenario 8: itinerary schedule is not converted into attraction candidates.
await test('scenario 8: itinerary/schedule entries never become candidates, even when they name a real place', () => {
  const doc = [
    'Day 1',
    '08:00–09:30 Breakfast at the hotel',
    '10:00 Depart for Tiger Hill',
    'Morning: sunrise viewing',
    'Lunch: at a local restaurant',
  ].join('\n');
  const candidates = extractCandidates(doc);
  assert.equal(candidates.length, 0, 'a schedule entry must not become an Attraction simply because it names a place');
});

// Scenario 9: document-level closing notes are not candidates.
await test('scenario 9: document-level closing/meta notes never become candidates', () => {
  const doc = [
    'Closing note from the original document: this itinerary was compiled from multiple sources and may need verification before travel.',
    'Original caveat: prices are indicative and may change seasonally.',
    'Scheduling note: times assume good weather.',
  ].join('\n');
  const candidates = extractCandidates(doc);
  assert.equal(candidates.length, 0);
});

// Scenario 10 + regression case: the actual realistic Darjeeling
// document structure that caused the original failure — narrative,
// headings, a hotel table, bulleted lists, itinerary, page
// footer, and closing meta-text all in one document. Only genuine
// research records should survive.
await test('scenario 10 (regression): a realistic mixed Darjeeling-style document extracts only real records', () => {
  const doc = [
    'About Darjeeling',
    'HISTORY, GEOGRAPHY, CLIMATE, AND THE PRACTICAL ESSENTIALS',
    'History & Geography',
    'Darjeeling was developed by the British in the mid-19th century as a hill station and sanatorium, chosen for its cool climate and dramatic views of the Kangchenjunga range. The town grew rapidly around its tea gardens, and by the early twentieth century had become one of the most celebrated hill retreats in colonial India, known for its distinctive architecture and toy train.',
    '',
    'Food & Restaurants',
    'HISTORY, MUST-TRY DISHES, AND WHERE TO EAT THEM',
    'History & Evolution of Darjeeling\'s Food',
    'The culinary identity of Darjeeling reflects its Nepali, Tibetan, and Bengali influences, shaped over more than a century by migration and trade along the old Himalayan routes connecting Sikkim, Nepal, and Tibet to the plains of Bengal.',
    'Must-Try Dishes',
    '- Momo',
    '- Thukpa',
    '- Thenthuk',
    '- Gundruk & Sinki',
    '- Tingmo',
    'Where to Eat',
    "- Glenary's",
    "- Keventer's",
    '- Kunga Restaurant',
    '',
    'Hotels',
    'NEAR MALL ROAD/CHOWRASTA UNDER 3,500/NIGHT FOR TWO ADULTS, CHILD STAYS FREE',
    'Hotel | Area | Rating | Price/Night | Why Consider It',
    'Dekeling Hotel | Near Chowrasta | 9.2/10 | ₹2,800–3,400 | Heritage-style rooms with excellent service and mountain views',
    'Muscatel Stardust | CR Das Road, Chowrasta | 8.9/10 | ₹3,500 | Deluxe rooms with modern amenities',
    'Villa Everest | Close to Chowrasta | 9.0/10 | ₹2,800–3,300 | Quiet property with good breakfast',
    'Sumitel Darjeeling | Mall Road | 8.7/10 | ₹4,200 | Central location, good for families',
    'Hotel Seven Seventeen | Near Chowrasta | 8.5/10 | ₹2,600 | Budget-friendly with basic amenities',
    'Windamere Hotel | Observatory Hill | 9.5/10 | ₹8,500 | Historic colonial-era hotel with old-world charm',
    '',
    'Attractions & Activities',
    '- Tiger Hill',
    '- Batasia Loop',
    '- Ghum Monastery',
    '- Japanese Peace Pagoda',
    '- Happy Valley Tea Estate',
    '- Himalayan Mountaineering Institute',
    '',
    'Shopping',
    '- Tibetan Refugee Self Help Centre',
    '- Habeeb Mullick',
    '',
    'Practical Information',
    'Emergency: Darjeeling Police, phone 0354-2254422',
    'Connectivity: Airtel and Jio both work reasonably well in central Darjeeling, though signal can be patchy in outlying areas.',
    '',
    'Day 1',
    '08:00–09:30 Breakfast at the hotel',
    '10:00 Depart for Tiger Hill',
    'Morning: sunrise viewing',
    'Lunch: at a local restaurant',
    '',
    'Darjeeling - The Complete Guide | 17/33',
    '',
    'Closing note from the original document: this itinerary was compiled from multiple sources and may need verification before travel.',
  ].join('\n');

  const candidates = extractCandidates(doc);
  const bySection = (section) => candidates.filter(c => c.proposedSection === section);

  assert.equal(bySection('accommodations').length, 6, 'all 6 hotel table rows should each be their own candidate');
  assert.equal(bySection('attractions').length, 6, 'all 6 bulleted attractions should be extracted');
  assert.equal(bySection('restaurants').length, 8, '5 must-try dishes + 3 named restaurants');
  assert.equal(bySection('shoppingItems').length, 2);
  assert.equal(bySection('practicalInfo').length, 2, 'both practical-info facts should be extracted, not just recognized as a heading');

  const excerpts = candidates.map(c => c.sourceExcerpt);
  assert.ok(!excerpts.some(t => t.includes('mid-19th century')), 'the About Darjeeling history paragraph must not appear');
  assert.ok(!excerpts.some(t => t.includes('culinary identity')), 'the food history paragraph must not appear');
  assert.ok(!excerpts.some(t => t.includes('Breakfast at the hotel')), 'itinerary lines must not appear');
  assert.ok(!excerpts.some(t => t.includes('Complete Guide')), 'the page footer must not appear');
  assert.ok(!excerpts.some(t => t.includes('Closing note')), 'the closing meta-note must not appear');

  // No giant candidate: nothing should be anywhere close to a whole
  // paragraph/page in length — this is the direct regression check for
  // the original bug (a whole page becoming one candidate).
  const longest = Math.max(...candidates.map(c => c.sourceExcerpt.length));
  assert.ok(longest < 200, `no single candidate should be page-length; longest was ${longest} chars`);

  assert.equal(candidates.length, 24, 'total candidate count for this document should be exactly the real records, no more, no less');
});

// Scenario 11: an unclear record is surfaced as Unclassified rather than guessed into the wrong section.
await test('scenario 11: a discrete-looking record with no heading match is Unclassified, not guessed', () => {
  const candidates = extractCandidates('Random Notable Place');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].proposedSection, null);
  assert.ok(candidates[0].uncertaintyNote);
});

console.log('\n5c. PDF line-reconstruction and page-boilerplate stripping (lib/pdfText.js)');
await test('reconstructLines rebuilds real lines from hasEOL-delimited text items', () => {
  const items = [
    { str: 'Hotels', hasEOL: true },
    { str: 'Dekeling Hotel ', hasEOL: false },
    { str: 'Near Chowrasta', hasEOL: true },
    { str: 'Muscatel Stardust', hasEOL: false },
  ];
  const lines = reconstructLines(items);
  assert.deepEqual(lines, ['Hotels', 'Dekeling Hotel Near Chowrasta', 'Muscatel Stardust']);
});

await test('stripRepeatedPageBoilerplate removes a running header/footer across pages, keeps unique content', () => {
  const pageLines = [
    ['Darjeeling - The Complete Guide | 1/3', 'Tiger Hill', 'Batasia Loop'],
    ['Darjeeling - The Complete Guide | 2/3', 'Ghum Monastery'],
    ['Darjeeling - The Complete Guide | 3/3', 'Japanese Peace Pagoda'],
  ];
  const cleaned = stripRepeatedPageBoilerplate(pageLines);
  assert.ok(!cleaned[0].some(l => l.includes('Complete Guide')));
  assert.ok(!cleaned[1].some(l => l.includes('Complete Guide')));
  assert.ok(!cleaned[2].some(l => l.includes('Complete Guide')));
  assert.deepEqual(cleaned[0], ['Tiger Hill', 'Batasia Loop']);
  assert.deepEqual(cleaned[1], ['Ghum Monastery']);
});

await test('stripRepeatedPageBoilerplate leaves short documents (fewer than 3 pages) untouched', () => {
  const pageLines = [['Tiger Hill'], ['Batasia Loop']];
  const cleaned = stripRepeatedPageBoilerplate(pageLines);
  assert.deepEqual(cleaned, pageLines);
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
    sectionFields: { place: { name: 'Sigiriya' }, category: '', description: '', feeBands: [], cameraCharge: null, videographyCharge: null, openingHours: [], typicallySpent: '', bestTimeOfDay: { option: '', note: '' } },
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
    sectionFields: { place: { name: 'Galle Fort' }, category: '', description: '', feeBands: [], cameraCharge: null, videographyCharge: null, openingHours: [], typicallySpent: '', bestTimeOfDay: { option: '', note: '' } },
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
    sectionFields: { place: { name: 'Imported Place' }, category: '', description: '', feeBands: [], cameraCharge: null, videographyCharge: null, openingHours: [], typicallySpent: '', bestTimeOfDay: { option: '', note: '' } },
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

console.log('\n8. Multi-band attraction fees');
await test('multiple fee bands with different age ranges and statuses are preserved distinctly', async () => {
  await __resetDbForTest();
  globalThis.indexedDB = new (await import('fake-indexeddb')).IDBFactory();
  const dest = await createDestination({ name: 'Test' });
  const feeBands = [
    { ...emptyFeeBand(), label: 'Adult', minAge: 13, maxAge: '', status: 'paid', amount: 100, currency: 'INR' },
    { ...emptyFeeBand(), label: 'Child', minAge: 5, maxAge: 12, status: 'paid', amount: 50, currency: 'INR' },
    { ...emptyFeeBand(), label: 'Young child', minAge: 0, maxAge: 4, status: 'free', amount: '', currency: '' },
  ];
  const item = await createAttraction(dest.id, { place: { name: 'Test Fort' }, feeBands });
  assert.equal(item.feeBands.length, 3);
  assert.equal(item.feeBands[0].label, 'Adult');
  assert.equal(item.feeBands[0].amount, 100);
  assert.equal(item.feeBands[1].maxAge, 12);
  assert.equal(item.feeBands[2].status, 'free');

  const formatted = formatFeeBands(item.feeBands);
  assert.ok(formatted.includes('Adult'));
  assert.ok(formatted.includes('Child'));
  assert.ok(formatted.includes('Free') || formatted.includes('Young child'));
});

await test('a single simple fee (no bands needed) stays simple', async () => {
  const dest = await createDestination({ name: 'Test' });
  const item = await createAttraction(dest.id, { place: { name: 'Free Park' }, feeBands: [{ ...emptyFeeBand(), status: 'free' }] });
  assert.equal(formatFeeBands(item.feeBands), 'Free');
});

console.log('\n9. Camera / videography charges');
await test('camera and videography charges are separate optional Money fields', async () => {
  const dest = await createDestination({ name: 'Test' });
  const item = await createAttraction(dest.id, {
    place: { name: 'Museum' },
    cameraCharge: { amount: 50, currency: 'INR', unit: 'per camera', note: '' },
    videographyCharge: { amount: 100, currency: 'INR', unit: '', note: '' },
  });
  assert.equal(item.cameraCharge.amount, 50);
  assert.equal(item.videographyCharge.amount, 100);
  assert.equal(item.cameraCharge.unit, 'per camera');
});

console.log('\n10. Opening-hour periods');
await test('split hours and per-day groups are represented distinctly', async () => {
  const dest = await createDestination({ name: 'Test' });
  const openingHours = [
    { id: 'g1', days: ['daily'], ranges: [{ start: '06:00', end: '12:00' }, { start: '17:00', end: '21:00' }] },
  ];
  const item = await createAttraction(dest.id, { place: { name: 'Temple' }, openingHours });
  assert.equal(item.openingHours[0].ranges.length, 2, 'split hours (two ranges in one day-group) should be preserved');
  const formatted = formatOpeningHours(item.openingHours);
  assert.ok(formatted.includes('06:00'));
  assert.ok(formatted.includes('17:00'));
});

await test('different hours on different days are supported via multiple groups', async () => {
  const openingHours = [
    { id: 'g1', days: ['mon', 'tue', 'wed', 'thu', 'fri'], ranges: [{ start: '09:00', end: '17:00' }] },
    { id: 'g2', days: ['sat', 'sun'], ranges: [{ start: '10:00', end: '14:00' }] },
  ];
  const formatted = formatOpeningHours(openingHours);
  assert.ok(formatted.includes('|'), 'multiple day-groups should both appear in the formatted output');
});

console.log('\n11. Transport and accommodation pricing units');
await test('transport supports per-vehicle pricing for a private hired cab', async () => {
  const dest = await createDestination({ name: 'Test' });
  const item = await createTransportEntry(dest.id, {
    from: { label: 'Kolkata', place: null },
    to: { label: 'Darjeeling', place: null },
    mode: 'Private hired cab',
    price: { amount: 8000, currency: 'INR', unit: 'Per vehicle', note: '' },
  });
  assert.equal(item.price.unit, 'Per vehicle');
  assert.equal(item.price.amount, 8000);
});

await test('accommodation price basis distinguishes per-room vs per-person', async () => {
  const dest = await createDestination({ name: 'Test' });
  const item = await createAccommodation(dest.id, {
    place: { name: 'Hotel X' },
    accommodationType: 'Hotel / Resort',
    price: { amount: 3000, currency: 'INR', unit: 'Per room per night', note: '' },
  });
  assert.equal(item.price.unit, 'Per room per night');
});

console.log('\n12. Weather structured selections');
await test('temperature range, rain, snow, and recommendation are structured and independent', async () => {
  const dest = await createDestination({ name: 'Test' });
  const item = await createWeatherNote(dest.id, {
    period: 'December–February',
    temperatureMin: 8, temperatureMax: 18, temperatureUnit: 'C',
    rain: 'Rare', snow: 'Moderate', recommendation: 'excellent', recommendationNotes: 'Clear skies, great visibility',
  });
  assert.equal(item.temperatureMin, 8);
  assert.equal(item.temperatureMax, 18);
  assert.equal(item.snow, 'Moderate');
  assert.equal(item.recommendation, 'excellent');
});

await test('legacy free-text recommendation is normalized into recommendationNotes without data loss', () => {
  const legacyRecord = { period: 'June', recommendation: 'Great time to visit, dry and clear' };
  const normalized = normalizeWeatherNote(legacyRecord);
  assert.equal(normalized.recommendation, '', 'non-enum legacy value should be cleared from the structured field');
  assert.equal(normalized.recommendationNotes, 'Great time to visit, dry and clear', 'legacy text should be preserved, not discarded');
});

console.log('\n13. Currency system — original values, INR/USD always available, exchange rates');
await test('INR and USD are always in the currency options regardless of what a destination has stored', () => {
  assert.deepEqual(getCurrencyOptions({ currencies: [] }), CORE_CURRENCIES);
  assert.deepEqual(getCurrencyOptions(null), CORE_CURRENCIES);
  const withExtra = getCurrencyOptions({ currencies: ['THB'] });
  assert.ok(withExtra.includes('INR') && withExtra.includes('USD') && withExtra.includes('THB'));
});

await test('adding a destination currency persists and is idempotent for core currencies', async () => {
  const dest = await createDestination({ name: 'Thailand Trip' });
  const updated = await addDestinationCurrency(dest.id, 'thb');
  assert.deepEqual(updated.currencies, ['THB'], 'currency code should be normalized to uppercase');
  const again = await addDestinationCurrency(dest.id, 'INR'); // core currency, should be a no-op
  assert.deepEqual(again.currencies, ['THB'], 'adding a core currency should not duplicate it into the stored list');
});

await test('exchange rate changes never modify an already-saved research record\'s original amount/currency', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  const item = await createCostEntry(dest.id, { item: 'Hotel deposit', price: { amount: 1200, currency: 'THB', unit: '', note: '' } });

  await setExchangeRate('THB', 'INR', 2.65);
  const rate1 = await getExchangeRate('THB', 'INR');
  assert.equal(rate1, 2.65);
  const converted1 = await convertAmount(item.price.amount, 'THB', 'INR');
  assert.ok(Math.abs(converted1 - 3180) < 0.01);

  // Change the rate — the ORIGINAL research record must be untouched.
  await setExchangeRate('THB', 'INR', 3.0);
  const itemAfterRateChange = await getCostEntry(item.id);
  assert.equal(itemAfterRateChange.price.amount, 1200, 'original amount must never change when an exchange rate changes');
  assert.equal(itemAfterRateChange.price.currency, 'THB', 'original currency must never change when an exchange rate changes');

  const converted2 = await convertAmount(item.price.amount, 'THB', 'INR');
  assert.ok(Math.abs(converted2 - 3600) < 0.01, 'the DISPLAYED conversion should reflect the new rate');
});

await test('an inverse rate can be derived when only one direction was recorded', async () => {
  await setExchangeRate('USD', 'INR', 84);
  const inverse = await getExchangeRate('INR', 'USD');
  assert.ok(Math.abs(inverse - (1 / 84)) < 0.0001);
});

await test('convertAmount returns null (never a guess) when no rate is on file', async () => {
  const result = await convertAmount(100, 'VND', 'USD');
  assert.equal(result, null);
});

console.log('\n14. Database version upgrade (v1 -> v2) preserves existing data');
await test('opening a v1 database with v2 code adds new stores without touching existing data', async () => {
  // Simulate a v1 database: open directly at version 1 with only the
  // original stores, seed a real destination, then close it. (The
  // test() wrapper has already given us a fresh globalThis.indexedDB
  // for this test — reuse it, don't replace it.)
  const v1Db = await new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open('dossier', 1);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const name of ['destinations', 'sources', 'attractions', 'restaurants', 'accommodations', 'transport', 'costs', 'practicalInfo', 'weatherNotes', 'packingNotes', 'generalNotes', 'intakeDocuments', 'candidates']) {
        const store = db.createObjectStore(name, { keyPath: 'id' });
        if (name !== 'destinations') store.createIndex('destinationId', 'destinationId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const tx = v1Db.transaction('destinations', 'readwrite');
    tx.objectStore('destinations').put({ id: 'existing-dest-1', name: 'Pre-existing Destination', currencies: [] });
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
  v1Db.close();

  // Now open with the real application code (getDb -> v2), simulating
  // the app being reloaded after this update ships. Only the app's
  // internal connection singleton is reset here — globalThis.indexedDB
  // must stay the SAME factory instance, or we'd be opening a brand
  // new, empty database instead of upgrading the one just seeded.
  __resetDbForTest();
  const destination = await getDestination('existing-dest-1');
  assert.ok(destination, 'pre-existing v1 data must survive the v1->v2 upgrade');
  assert.equal(destination.name, 'Pre-existing Destination');

  // New v2-only functionality (Shopping, exchange rates) must now work
  // against this upgraded database.
  const shoppingItem = await createShoppingItem('existing-dest-1', { name: 'Tea' });
  assert.ok(shoppingItem.id);
  await setExchangeRate('THB', 'INR', 2.6);
  assert.equal(await getExchangeRate('THB', 'INR'), 2.6);
});

console.log('\n15. Locations — flexible sub-destinations, additive to existing records');
await test('a location can be created, listed, edited, and soft-deleted', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  const loc = await createLocation(dest.id, { name: 'Bangkok' });
  assert.equal(loc.name, 'Bangkok');
  assert.equal(loc.destinationId, dest.id);

  const list1 = await listLocations(dest.id);
  assert.equal(list1.length, 1);

  const updated = await updateLocation(loc.id, { name: 'Bangkok (renamed)' });
  assert.equal(updated.name, 'Bangkok (renamed)');

  await deleteLocation(loc.id);
  const list2 = await listLocations(dest.id);
  assert.equal(list2.length, 0, 'soft-deleted location should not appear in list');
  assert.equal(await getLocation(loc.id), null);
});

await test('creating a location without a name is rejected', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  await assert.rejects(() => createLocation(dest.id, { name: '' }));
  await assert.rejects(() => createLocation(dest.id, {}));
});

await test('a destination can have multiple locations, listed alphabetically', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  await createLocation(dest.id, { name: 'Phuket' });
  await createLocation(dest.id, { name: 'Bangkok' });
  await createLocation(dest.id, { name: 'Chiang Mai' });
  const list = await listLocations(dest.id);
  assert.deepEqual(list.map(l => l.name), ['Bangkok', 'Chiang Mai', 'Phuket']);
});

await test('a new research record defaults to locationId: null (destination-wide)', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  const item = await createAttraction(dest.id, { place: { name: 'Grand Palace' } });
  assert.equal(item.locationId, null, 'a record created with no locationId should default to destination-wide');
});

await test('a research record can be scoped to a specific location', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  const bangkok = await createLocation(dest.id, { name: 'Bangkok' });
  const item = await createAttraction(dest.id, { place: { name: 'Grand Palace' }, locationId: bangkok.id });
  assert.equal(item.locationId, bangkok.id);

  const dishEntry = await createRestaurantEntry(dest.id, { dishName: 'Pad Thai', locationId: bangkok.id });
  assert.equal(dishEntry.locationId, bangkok.id);
});

await test('destination-wide and location-specific records coexist for the same destination', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  const bangkok = await createLocation(dest.id, { name: 'Bangkok' });
  await createPracticalInfoEntry(dest.id, { topic: 'Visa' }); // destination-wide (no locationId given)
  await createAttraction(dest.id, { place: { name: 'Grand Palace' }, locationId: bangkok.id }); // location-specific

  const allAttractions = await listAttractions(dest.id);
  const allPracticalInfo = await listPracticalInfoEntries(dest.id);
  assert.equal(allAttractions.length, 1);
  assert.equal(allAttractions[0].locationId, bangkok.id);
  assert.equal(allPracticalInfo.length, 1);
  assert.equal(allPracticalInfo[0].locationId, null, 'visa info with no location chosen should be destination-wide');
});

await test('a destination with no locations continues to work exactly as before', async () => {
  const dest = await createDestination({ name: 'Sri Lanka (single-place trip)' });
  const locations = await listLocations(dest.id);
  assert.equal(locations.length, 0);
  const item = await createAttraction(dest.id, { place: { name: 'Sigiriya' } });
  assert.equal(item.locationId, null);
  const list = await listAttractions(dest.id);
  assert.equal(list.length, 1, 'attraction should be listed normally even though the destination has no locations');
});

console.log('\n16. Database version upgrade (v2 -> v3) preserves existing data, including records with no locationId');
await test('opening a v2 database with v3 code adds the locations store without touching existing data', async () => {
  // Simulate a v2 database (all stores through exchangeRates, but no
  // `locations` store and no `locationId` on any existing record —
  // exactly what a real user's pre-Phase-1 database looks like).
  const v2StoreNames = [
    'destinations', 'sources', 'attractions', 'restaurants', 'accommodations', 'transport',
    'costs', 'practicalInfo', 'weatherNotes', 'packingNotes', 'generalNotes',
    'shoppingItems', 'shops', 'exchangeRates', 'intakeDocuments', 'candidates',
  ];
  const v2Db = await new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open('dossier', 2);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const name of v2StoreNames) {
        const store = db.createObjectStore(name, { keyPath: 'id' });
        if (name !== 'destinations' && name !== 'exchangeRates') store.createIndex('destinationId', 'destinationId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const tx = v2Db.transaction(['destinations', 'attractions'], 'readwrite');
    tx.objectStore('destinations').put({ id: 'existing-dest-2', name: 'Pre-Phase-1 Destination', currencies: [] });
    // A real pre-Phase-1 attraction record: no `locationId` key at all.
    tx.objectStore('attractions').put({
      id: 'existing-attraction-1', destinationId: 'existing-dest-2',
      place: { name: 'Old Record Place' }, provenance: 'manual', deletedAt: null,
    });
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
  v2Db.close();

  // Reopen with the real application code (getDb -> v3).
  __resetDbForTest();
  const destination = await getDestination('existing-dest-2');
  assert.ok(destination, 'pre-existing v2 data must survive the v2->v3 upgrade');
  assert.equal(destination.name, 'Pre-Phase-1 Destination');

  const oldAttractions = await listAttractions('existing-dest-2');
  assert.equal(oldAttractions.length, 1, 'pre-existing attraction (no locationId field) must still be listed');
  assert.equal(oldAttractions[0].locationId, undefined, 'an old record is never rewritten to add a locationId key');

  // New v3-only functionality (Locations) must now work against this
  // upgraded database, and coexist with the untouched old record.
  const location = await createLocation('existing-dest-2', { name: 'Kandy' });
  assert.ok(location.id);
  const locations = await listLocations('existing-dest-2');
  assert.equal(locations.length, 1);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);