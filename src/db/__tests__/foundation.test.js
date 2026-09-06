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
import { createAttraction, listAttractions, updateAttraction, deleteAttraction, getAttraction } from '../stores/attractions.js';
import { createRestaurantEntry, isPlaceBased } from '../stores/restaurants.js';
import { createTransportEntry, listTransportEntries } from '../stores/transport.js';
import { createCostEntry, getCostEntry } from '../stores/costs.js';
import { createIntake, getIntake, updateCandidate, acceptCandidate, rejectCandidate, resetCandidateToPending } from '../stores/intake.js';
import { extractCandidates, extractPriceFromText } from '../extraction.js';
import { buildGoogleMapsUrl } from '../../lib/googleMaps.js';
import { reconstructLines, stripRepeatedPageBoilerplate } from '../../lib/pdfText.js';
import { createAccommodation, getAccommodation } from '../stores/accommodations.js';
import { createWeatherNote, normalizeWeatherNote } from '../stores/weatherNotes.js';
import { emptyFeeBand, formatFeeBands } from '../../lib/feeBands.js';
import { formatOpeningHours } from '../../lib/openingHours.js';
import { CORE_CURRENCIES, getCurrencyOptions, addDestinationCurrency, setExchangeRate, getExchangeRate, convertAmount } from '../currency.js';
import { createShoppingItem } from '../stores/shoppingItems.js';
import { createLocation, listLocations, updateLocation, deleteLocation, getLocation } from '../stores/locations.js';
import { createPracticalInfoEntry, listPracticalInfoEntries } from '../stores/practicalInfo.js';
import { createJourney, listJourneys, updateJourney, deleteJourney, getJourney, listJourneysUsingLocation, retireJourneysUsingLocation, describeJourney } from '../stores/journeys.js';
import { createDish, listDishes, updateDish, deleteDish, getDish, linkDishToRestaurant, unlinkDishFromRestaurant, listDishesForRestaurant } from '../stores/dishes.js';
import { normalizeTransportEntry } from '../stores/transport.js';
import { getDestinationDefaultCurrency, setDestinationDefaultCurrency } from '../currency.js';

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

console.log('\n17. Journeys — travel between two existing cities/locations (Option C: a proper entity, not a synthetic locationId)');
await test('a journey can be created between two different locations', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  const bangkok = await createLocation(dest.id, { name: 'Bangkok' });
  const phuket = await createLocation(dest.id, { name: 'Phuket' });
  const journey = await createJourney(dest.id, { fromLocationId: bangkok.id, toLocationId: phuket.id });
  assert.equal(journey.fromLocationId, bangkok.id);
  assert.equal(journey.toLocationId, phuket.id);
  assert.equal(journey.destinationId, dest.id);
});

await test('a journey with the same city as origin and destination is rejected', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  const bangkok = await createLocation(dest.id, { name: 'Bangkok' });
  await assert.rejects(() => createJourney(dest.id, { fromLocationId: bangkok.id, toLocationId: bangkok.id }));
});

await test('a journey missing either endpoint is rejected', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  const bangkok = await createLocation(dest.id, { name: 'Bangkok' });
  await assert.rejects(() => createJourney(dest.id, { fromLocationId: bangkok.id, toLocationId: null }));
  await assert.rejects(() => createJourney(dest.id, {}));
});

await test('journeys can be listed for a destination', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  const bangkok = await createLocation(dest.id, { name: 'Bangkok' });
  const phuket = await createLocation(dest.id, { name: 'Phuket' });
  const chiangMai = await createLocation(dest.id, { name: 'Chiang Mai' });
  await createJourney(dest.id, { fromLocationId: bangkok.id, toLocationId: phuket.id });
  await createJourney(dest.id, { fromLocationId: bangkok.id, toLocationId: chiangMai.id });
  const journeys = await listJourneys(dest.id);
  assert.equal(journeys.length, 2);
});

await test('renaming a location leaves the journey valid and resolves to the new name', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  const bangkok = await createLocation(dest.id, { name: 'Bangkok' });
  const phuket = await createLocation(dest.id, { name: 'Phuket' });
  const journey = await createJourney(dest.id, { fromLocationId: bangkok.id, toLocationId: phuket.id });

  await updateLocation(phuket.id, { name: 'Phuket Island' });
  const stillValid = await getJourney(journey.id);
  assert.equal(stillValid.toLocationId, phuket.id, 'journey keeps referencing the location by id, unaffected by rename');

  const freshLocations = await listLocations(dest.id);
  assert.equal(describeJourney(stillValid, freshLocations), 'Bangkok → Phuket Island', 'display resolves the CURRENT name at read time');
});

await test('deleting a location explicitly retires journeys that used it, rather than leaving them silently broken', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  const bangkok = await createLocation(dest.id, { name: 'Bangkok' });
  const phuket = await createLocation(dest.id, { name: 'Phuket' });
  const chiangMai = await createLocation(dest.id, { name: 'Chiang Mai' });
  const affectedJourney = await createJourney(dest.id, { fromLocationId: bangkok.id, toLocationId: phuket.id });
  const unaffectedJourney = await createJourney(dest.id, { fromLocationId: bangkok.id, toLocationId: chiangMai.id });

  const using = await listJourneysUsingLocation(dest.id, phuket.id);
  assert.equal(using.length, 1);
  assert.equal(using[0].id, affectedJourney.id);

  const retired = await retireJourneysUsingLocation(dest.id, phuket.id);
  assert.equal(retired.length, 1);
  await deleteLocation(phuket.id);

  assert.equal(await getJourney(affectedJourney.id), null, 'the journey using the deleted location is soft-deleted, not left dangling');
  assert.ok(await getJourney(unaffectedJourney.id), 'a journey NOT using the deleted location is untouched');

  const remainingJourneys = await listJourneys(dest.id);
  assert.equal(remainingJourneys.length, 1);
});

await test('a record can be associated with a journey via its own optional journeyId field, never via locationId', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  const bangkok = await createLocation(dest.id, { name: 'Bangkok' });
  const phuket = await createLocation(dest.id, { name: 'Phuket' });
  const journey = await createJourney(dest.id, { fromLocationId: bangkok.id, toLocationId: phuket.id });

  const attraction = await createAttraction(dest.id, { place: { name: 'Roadside viewpoint' }, journeyId: journey.id });
  assert.equal(attraction.journeyId, journey.id, 'journey association lives in journeyId');
  assert.equal(attraction.locationId, null, 'locationId is untouched by journey association — it never holds a synthetic id');

  const transportEntry = await createTransportEntry(dest.id, { travelType: 'inter_city', from: { label: 'Bangkok' }, to: { label: 'Phuket' }, journeyId: journey.id });
  assert.equal(transportEntry.journeyId, journey.id);
});

await test('an attraction with a real locationId never gets confused with a journey reference', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  const bangkok = await createLocation(dest.id, { name: 'Bangkok' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Grand Palace' }, locationId: bangkok.id });
  assert.equal(attraction.locationId, bangkok.id, 'locationId is a real location id');
  assert.equal(attraction.journeyId, null, 'journeyId defaults to null and is a completely separate field');
});

await test('an attraction saved before journeyId existed is fully backward compatible', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Old Attraction' } });
  // Simulate a genuinely old record: strip journeyId as if it had been
  // saved before this field was introduced.
  delete attraction.journeyId;
  const list = await listAttractions(dest.id);
  assert.equal(list.length, 1, 'an attraction with no journeyId key at all is still listed normally');
});

await test('a journey can be updated (e.g. adding notes) and directly soft-deleted', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  const bangkok = await createLocation(dest.id, { name: 'Bangkok' });
  const phuket = await createLocation(dest.id, { name: 'Phuket' });
  const journey = await createJourney(dest.id, { fromLocationId: bangkok.id, toLocationId: phuket.id });

  const updated = await updateJourney(journey.id, { notes: 'Overnight bus is cheapest' });
  assert.equal(updated.notes, 'Overnight bus is cheapest');

  await deleteJourney(journey.id);
  assert.equal(await getJourney(journey.id), null);
  const remaining = await listJourneys(dest.id);
  assert.equal(remaining.length, 0);
});

await test('updating a journey to have the same from/to location is rejected', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  const bangkok = await createLocation(dest.id, { name: 'Bangkok' });
  const phuket = await createLocation(dest.id, { name: 'Phuket' });
  const journey = await createJourney(dest.id, { fromLocationId: bangkok.id, toLocationId: phuket.id });
  await assert.rejects(() => updateJourney(journey.id, { toLocationId: bangkok.id }));
});

console.log('\n18. Dishes — independent food items with a many-to-many Restaurant relationship');
await test('a dish can be created independently, with no restaurant attached', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const dish = await createDish(dest.id, { name: 'Momos' });
  assert.equal(dish.name, 'Momos');
  assert.deepEqual(dish.restaurantIds, []);
});

await test('creating a dish without a name is rejected', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  await assert.rejects(() => createDish(dest.id, { name: '' }));
});

await test('a restaurant can have multiple linked dishes, and a dish can have multiple linked restaurants (many-to-many)', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const kunga = await createRestaurantEntry(dest.id, { place: { name: 'Kunga Restaurant' } });
  const shangriLa = await createRestaurantEntry(dest.id, { place: { name: 'Shangri La' } });

  const momo = await createDish(dest.id, { name: 'Momo' });
  const friedRice = await createDish(dest.id, { name: 'Fried Rice' });
  const chilliChicken = await createDish(dest.id, { name: 'Chilli Chicken' });
  const munchowSoup = await createDish(dest.id, { name: 'Munchow Soup' });

  // Kunga -> Momo, Fried Rice, Chilli Chicken, Munchow Soup
  await linkDishToRestaurant(momo.id, kunga.id);
  await linkDishToRestaurant(friedRice.id, kunga.id);
  await linkDishToRestaurant(chilliChicken.id, kunga.id);
  await linkDishToRestaurant(munchowSoup.id, kunga.id);
  // Munchow Soup -> also Shangri La
  await linkDishToRestaurant(munchowSoup.id, shangriLa.id);

  const kungaDishes = await listDishesForRestaurant(dest.id, kunga.id);
  assert.deepEqual(kungaDishes.map(d => d.name).sort(), ['Chilli Chicken', 'Fried Rice', 'Momo', 'Munchow Soup'], 'opening Kunga shows all four linked dishes');

  const munchowSoupAfter = await getDish(munchowSoup.id);
  assert.deepEqual(munchowSoupAfter.restaurantIds.sort(), [kunga.id, shangriLa.id].sort(), 'opening Munchow Soup shows both linked restaurants');

  const shangriLaDishes = await listDishesForRestaurant(dest.id, shangriLa.id);
  assert.equal(shangriLaDishes.length, 1);
  assert.equal(shangriLaDishes[0].id, munchowSoup.id);
});

await test('linking the same dish to the same restaurant twice does not create a duplicate', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const kunga = await createRestaurantEntry(dest.id, { place: { name: 'Kunga Restaurant' } });
  const momo = await createDish(dest.id, { name: 'Momo' });
  await linkDishToRestaurant(momo.id, kunga.id);
  await linkDishToRestaurant(momo.id, kunga.id);
  const after = await getDish(momo.id);
  assert.equal(after.restaurantIds.length, 1, 'linking twice is idempotent, not duplicated');
});

await test('unlinking a dish from a restaurant removes just that association', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const kunga = await createRestaurantEntry(dest.id, { place: { name: 'Kunga Restaurant' } });
  const shangriLa = await createRestaurantEntry(dest.id, { place: { name: 'Shangri La' } });
  const munchowSoup = await createDish(dest.id, { name: 'Munchow Soup' });
  await linkDishToRestaurant(munchowSoup.id, kunga.id);
  await linkDishToRestaurant(munchowSoup.id, shangriLa.id);

  await unlinkDishFromRestaurant(munchowSoup.id, kunga.id);
  const after = await getDish(munchowSoup.id);
  assert.deepEqual(after.restaurantIds, [shangriLa.id]);
});

await test('a dish can be updated and soft-deleted', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const dish = await createDish(dest.id, { name: 'Momo' });
  const updated = await updateDish(dish.id, { cuisine: 'Tibetan' });
  assert.equal(updated.cuisine, 'Tibetan');
  await deleteDish(dish.id);
  const list = await listDishes(dest.id);
  assert.equal(list.length, 0);
});

await test('legacy restaurant records (place: null, dishName set) remain fully readable and unaffected by the Dishes split', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  // Simulate an entry saved under the OLD dual-mode restaurants.js
  // shape, before Dishes existed as its own entity.
  const legacyDishNote = await createRestaurantEntry(dest.id, { place: null, dishName: 'Thukpa (no restaurant known yet)' });
  assert.equal(isPlaceBased(legacyDishNote), false, 'a legacy dish-only record is still recognized as such');
  assert.equal(legacyDishNote.dishName, 'Thukpa (no restaurant known yet)');
  assert.equal(legacyDishNote.place, null, 'the reverted place:null default is confirmed in effect for new restaurant records with no place given');
});

await test('a brand-new restaurant record defaults to place: null (the approved, reverted default) when no place is given', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const entry = await createRestaurantEntry(dest.id, { dishName: 'General food note' });
  assert.equal(entry.place, null, 'emptyRestaurantEntry() defaults place to null, not emptyPlace() — the unapproved change was reverted');
});

console.log('\n18b. Import pipeline: Costs cannot be produced; Dishes can complete the full path');
await test('extracting candidates from realistic cost-flavoured text never proposes the costs section (Costs is not in SECTION_KEYWORDS)', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const { candidates } = await createIntake({
    destinationId: dest.id,
    rawText: 'Costs & Money\n- SIM card: LKR 1500\n- Local bus fare: LKR 50\n- Hotel deposit: USD 20',
  });
  for (const c of candidates) {
    assert.notEqual(c.proposedSection, 'costs', `a candidate must never be auto-classified as costs (got: ${JSON.stringify(c)})`);
  }
});

await test('even if a caller tried to force section: "costs", acceptCandidate refuses because costs is not in CREATORS', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const { candidates } = await createIntake({ destinationId: dest.id, rawText: 'Practical Info\n- Visa: on arrival, USD 50' });
  const candidate = candidates[0];
  await assert.rejects(
    () => acceptCandidate(candidate.id, { section: 'costs', sectionFields: { item: 'Visa', price: { amount: 50, currency: 'USD' } } }),
    /Choose a valid section/,
    'acceptCandidate must reject "costs" as a section even if something tried to pass it directly, not just rely on the UI never offering it',
  );
});

await test('a Dishes candidate can travel the full import -> review -> accept path and produces a real Dish record', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const { candidates } = await createIntake({ destinationId: dest.id, rawText: 'Restaurants & Food\n- Momos are a local specialty' });
  const candidate = candidates[0];
  assert.ok(candidate, 'extraction produced at least one candidate to reassign');

  // Simulate what ReviewPage.jsx does: the person reassigns this
  // candidate's section to Dishes and edits the fields via the
  // case 'dishes' editor (name + notes, per REST_FIELD_BY_SECTION).
  await updateCandidate(candidate.id, { proposedSection: 'dishes' });
  const record = await acceptCandidate(candidate.id, {
    section: 'dishes',
    sectionFields: { name: 'Momos', notes: 'A local specialty' },
  });

  assert.ok(record.id, 'acceptCandidate successfully created a real Dish record');
  assert.equal(record.name, 'Momos');
  assert.equal(record.provenance, 'imported');
  assert.equal(record.candidateId, candidate.id, 'the created dish links back to the candidate it came from');

  const dishes = await listDishes(dest.id);
  assert.equal(dishes.length, 1);
  assert.equal(dishes[0].id, record.id);
});

console.log('\n19. Currency — destination default currency (INR fallback, explicit choice, changing later)');
await test('a destination created with no explicit currency defaults to INR', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  assert.equal(getDestinationDefaultCurrency(dest), 'INR');
});

await test('a destination can be created with an explicit default currency, e.g. KGS for Kyrgyzstan', async () => {
  const dest = await createDestination({ name: 'Kyrgyzstan', defaultCurrency: 'KGS' });
  assert.equal(dest.defaultCurrency, 'KGS');
  assert.equal(getDestinationDefaultCurrency(dest), 'KGS');
});

await test('setDestinationDefaultCurrency changes the default and makes it available as an option', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  await setDestinationDefaultCurrency(dest.id, 'USD');
  const after = await getDestination(dest.id);
  assert.equal(getDestinationDefaultCurrency(after), 'USD');
  assert.ok(getCurrencyOptions(after).includes('USD'));
});

await test('changing the destination default currency never rewrites an existing research record\'s stored amount/currency', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' }); // starts as INR
  const hotel = await createAccommodation(dest.id, { place: { name: 'Hotel' }, price: { amount: 8000, currency: 'INR', unit: 'per night', note: '' } });
  const attraction = await createAttraction(dest.id, {
    place: { name: 'Temple' },
    feeBands: [{ id: crypto.randomUUID(), label: '', minAge: '', maxAge: '', status: 'paid', amount: 3000, currency: 'LKR' }],
  });

  await setDestinationDefaultCurrency(dest.id, 'USD');

  const hotelAfter = await getAccommodation(hotel.id);
  assert.equal(hotelAfter.price.amount, 8000);
  assert.equal(hotelAfter.price.currency, 'INR', 'the existing hotel price keeps its original INR currency after the destination default changes to USD');

  const attractionAfter = await getAttraction(attraction.id);
  assert.equal(attractionAfter.feeBands[0].amount, 3000);
  assert.equal(attractionAfter.feeBands[0].currency, 'LKR', 'the existing attraction fee keeps its original LKR currency after the destination default changes');
});

await test('INR and USD remain available as currency options regardless of the destination default', async () => {
  const dest = await createDestination({ name: 'Kyrgyzstan', defaultCurrency: 'KGS' });
  const options = getCurrencyOptions(dest);
  assert.ok(options.includes('INR'));
  assert.ok(options.includes('USD'));
  assert.ok(options.includes('KGS'));
});

await test('a destination created before defaultCurrency existed is treated as INR without any migration', async () => {
  // Simulate a genuinely old destination record: no defaultCurrency key.
  const oldStyleDestination = { id: 'old-dest', name: 'Old Destination', currencies: [] };
  assert.equal(getDestinationDefaultCurrency(oldStyleDestination), 'INR');
});

await test('the USD-base exchange-rate model supports multiple currencies pegged to USD, edited independently, never touching stored research values', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  await setExchangeRate('USD', 'INR', 83);
  await setExchangeRate('USD', 'LKR', 300);
  await setExchangeRate('USD', 'KGS', 89);

  assert.equal(await getExchangeRate('USD', 'INR'), 83);
  assert.equal(await getExchangeRate('USD', 'LKR'), 300);
  assert.equal(await getExchangeRate('USD', 'KGS'), 89);

  // Editing one rate later doesn't disturb the others or any stored record.
  await setExchangeRate('USD', 'INR', 84);
  assert.equal(await getExchangeRate('USD', 'INR'), 84);
  assert.equal(await getExchangeRate('USD', 'LKR'), 300, 'updating the USD/INR rate does not affect the independently-set USD/LKR rate');

  const attraction = await createAttraction(dest.id, {
    place: { name: 'Temple' },
    feeBands: [{ id: crypto.randomUUID(), label: '', minAge: '', maxAge: '', status: 'paid', amount: 3000, currency: 'LKR' }],
  });
  const reloaded = await getAttraction(attraction.id);
  assert.equal(reloaded.feeBands[0].amount, 3000, 'the stored fee amount is untouched by any exchange-rate edits');
  assert.equal(reloaded.feeBands[0].currency, 'LKR');
});

console.log('\n20. Transport — local vs. inter-city travel');
await test('local transport can be created without any From/To, associated with a location instead', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  const phuket = await createLocation(dest.id, { name: 'Phuket' });
  const local = await createTransportEntry(dest.id, { travelType: 'local', locationId: phuket.id, mode: 'Tuk-tuk', bookingNotes: 'Flag down on the street' });
  assert.equal(local.travelType, 'local');
  assert.equal(local.locationId, phuket.id);
  assert.equal(local.from.label, '', 'local transport has no meaningful From label');
  assert.equal(local.to.label, '', 'local transport has no meaningful To label');
});

await test('local transport can also be destination-wide (no specific location)', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  const local = await createTransportEntry(dest.id, { travelType: 'local', mode: 'Grab app' });
  assert.equal(local.travelType, 'local');
  assert.equal(local.locationId, null);
});

await test('inter-city transport still requires both From and To', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  assert.throws(() => createTransportEntry(dest.id, { travelType: 'inter_city', from: { label: 'Bangkok' }, to: { label: '' } }));
  const valid = await createTransportEntry(dest.id, { travelType: 'inter_city', from: { label: 'Bangkok' }, to: { label: 'Phuket' } });
  assert.equal(valid.from.label, 'Bangkok');
  assert.equal(valid.to.label, 'Phuket');
});

await test('a transport record saved before travelType existed is treated as inter_city and remains fully compatible', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const old = await createTransportEntry(dest.id, { from: { label: 'Colombo' }, to: { label: 'Kandy' } });
  delete old.travelType; // simulate a genuinely pre-existing record with no travelType key
  const normalized = normalizeTransportEntry(old);
  assert.equal(normalized.travelType, 'inter_city');
  assert.equal(normalized.from.label, 'Colombo');
});

await test('a new transport price defaults to the destination\'s currency default; an existing price keeps its own currency', async () => {
  const dest = await createDestination({ name: 'Kyrgyzstan', defaultCurrency: 'KGS' });
  assert.equal(getDestinationDefaultCurrency(dest), 'KGS');
  const entry = await createTransportEntry(dest.id, { from: { label: 'Bishkek' }, to: { label: 'Osh' }, price: { amount: 1200, currency: 'INR', unit: 'per person', note: '' } });
  assert.equal(entry.price.currency, 'INR', 'a price explicitly entered with its own currency is stored exactly as given, regardless of the destination default');
});

console.log('\n20b. "Other" fields — a chosen "Other" value is preserved with its own explanation, across every control that actually offers Other');
await test('an accommodation type of "Other" preserves its free-text explanation separately', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const acc = await createAccommodation(dest.id, { place: { name: 'A treehouse' }, accommodationType: 'Other', accommodationTypeOther: 'Treehouse stay' });
  assert.equal(acc.accommodationType, 'Other');
  assert.equal(acc.accommodationTypeOther, 'Treehouse stay');
});

await test('a transport mode of "Other" preserves its free-text explanation separately', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const entry = await createTransportEntry(dest.id, { from: { label: 'Colombo' }, to: { label: 'Galle' }, mode: 'Other', modeOther: 'Chartered boat' });
  assert.equal(entry.mode, 'Other');
  assert.equal(entry.modeOther, 'Chartered boat');
});

await test('a practical-info topic of "Other" preserves its free-text explanation separately', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const entry = await createPracticalInfoEntry(dest.id, { topic: 'Other', topicOther: 'Tuk-tuk haggling norms', details: 'Always agree a price before getting in.' });
  assert.equal(entry.topic, 'Other');
  assert.equal(entry.topicOther, 'Tuk-tuk haggling norms');
});

await test('legacy accommodation/transport/practicalInfo records with an "Other" value but no *Other explanation field remain readable', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  // Simulate records saved before the *Other fields existed.
  const acc = await createAccommodation(dest.id, { place: { name: 'Old Place' }, accommodationType: 'Other' });
  delete acc.accommodationTypeOther;
  assert.equal(acc.accommodationType, 'Other', 'reading an old record with no accommodationTypeOther key at all does not throw or corrupt the record');
});

await test('accommodation supports locationId scoping the same way attractions/transport/dishes do (consistency fix)', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  const bangkok = await createLocation(dest.id, { name: 'Bangkok' });
  const hotel = await createAccommodation(dest.id, { place: { name: 'Riverside Hotel' }, locationId: bangkok.id });
  assert.equal(hotel.locationId, bangkok.id);
  const wholeDestHotel = await createAccommodation(dest.id, { place: { name: 'Chain option, TBD city' } });
  assert.equal(wholeDestHotel.locationId, null);
});

console.log('\n21. Database version upgrade to v5 (journeys + dishes) preserves data through the full chain');
await test('upgrading a v4 database (dishes exists, journeys does not) to v5 adds journeys without touching existing data', async () => {
  const v4StoreNames = [
    'destinations', 'locations', 'sources', 'attractions', 'restaurants', 'dishes', 'accommodations', 'transport',
    'costs', 'practicalInfo', 'weatherNotes', 'packingNotes', 'generalNotes',
    'shoppingItems', 'shops', 'exchangeRates', 'intakeDocuments', 'candidates',
  ];
  const v4Db = await new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open('dossier', 4);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const name of v4StoreNames) {
        const store = db.createObjectStore(name, { keyPath: 'id' });
        if (!['destinations', 'exchangeRates'].includes(name)) store.createIndex('destinationId', 'destinationId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const tx = v4Db.transaction(['destinations', 'locations', 'restaurants', 'dishes'], 'readwrite');
    tx.objectStore('destinations').put({ id: 'v4-dest', name: 'Pre-Journeys Destination', currencies: [] }); // no defaultCurrency key either
    tx.objectStore('locations').put({ id: 'v4-loc-1', destinationId: 'v4-dest', name: 'Old City', deletedAt: null });
    tx.objectStore('restaurants').put({ id: 'v4-restaurant-1', destinationId: 'v4-dest', place: { name: 'Old Restaurant' }, deletedAt: null });
    tx.objectStore('dishes').put({ id: 'v4-dish-1', destinationId: 'v4-dest', name: 'Old Dish', restaurantIds: ['v4-restaurant-1'], deletedAt: null });
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
  v4Db.close();

  __resetDbForTest();
  const destination = await getDestination('v4-dest');
  assert.ok(destination, 'pre-existing v4 destination survives the v4->v5 upgrade');
  assert.equal(getDestinationDefaultCurrency(destination), 'INR', 'a destination with no defaultCurrency key defaults to INR after upgrade');

  const locations = await listLocations('v4-dest');
  assert.equal(locations.length, 1);
  assert.equal(locations[0].name, 'Old City');

  const dishes = await listDishes('v4-dest');
  assert.equal(dishes.length, 1);
  assert.equal(dishes[0].name, 'Old Dish');
  assert.deepEqual(dishes[0].restaurantIds, ['v4-restaurant-1'], 'pre-existing dish-restaurant links survive the upgrade untouched');

  // journeys must now work against this upgraded database.
  const loc2 = await createLocation('v4-dest', { name: 'New City' });
  const journey = await createJourney('v4-dest', { fromLocationId: locations[0].id, toLocationId: loc2.id });
  assert.ok(journey.id);
  const journeyList = await listJourneys('v4-dest');
  assert.equal(journeyList.length, 1);
});

await test('a full v1 -> v5 upgrade chain preserves an original Phase-0-era destination and its attraction', async () => {
  // The oldest possible real-world shape: only the stores that existed
  // at v1 (before Shopping/currency/locations/dishes/journeys).
  const v1StoreNames = ['destinations', 'sources', 'attractions', 'restaurants', 'accommodations', 'transport', 'costs', 'practicalInfo', 'weatherNotes', 'packingNotes', 'generalNotes', 'intakeDocuments', 'candidates'];
  const v1Db = await new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open('dossier', 1);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const name of v1StoreNames) {
        const store = db.createObjectStore(name, { keyPath: 'id' });
        if (name !== 'destinations') store.createIndex('destinationId', 'destinationId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const tx = v1Db.transaction(['destinations', 'attractions'], 'readwrite');
    tx.objectStore('destinations').put({ id: 'v1-dest', name: 'Original Darjeeling Research', overview: 'The very first destination' });
    tx.objectStore('attractions').put({ id: 'v1-attraction', destinationId: 'v1-dest', place: { name: 'Batasia Loop' }, provenance: 'manual', deletedAt: null });
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
  v1Db.close();

  __resetDbForTest();
  const destination = await getDestination('v1-dest');
  assert.ok(destination, 'the original v1 destination survives the full upgrade chain to v5');
  assert.equal(destination.name, 'Original Darjeeling Research');
  assert.equal(getDestinationDefaultCurrency(destination), 'INR');

  const attractions = await listAttractions('v1-dest');
  assert.equal(attractions.length, 1);
  assert.equal(attractions[0].place.name, 'Batasia Loop');
  assert.equal(attractions[0].locationId, undefined);
  assert.equal(attractions[0].journeyId, undefined, 'a genuinely v1 record has neither locationId nor journeyId keys — both are read as absent/null everywhere they matter');

  // Every store introduced since v1 must now be usable.
  const location = await createLocation('v1-dest', { name: 'Darjeeling Town' });
  assert.ok(location.id);
  const dish = await createDish('v1-dest', { name: 'Momos' });
  assert.ok(dish.id);
  const loc2 = await createLocation('v1-dest', { name: 'Ghoom' });
  const journey = await createJourney('v1-dest', { fromLocationId: location.id, toLocationId: loc2.id });
  assert.ok(journey.id);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);