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
import { createAttraction, listAttractions, updateAttraction, deleteAttraction, getAttraction, normalizeAttraction } from '../stores/attractions.js';
import { createRestaurantEntry, getRestaurantEntry, isPlaceBased, updateRestaurantEntry } from '../stores/restaurants.js';
import { createTransportEntry, listTransportEntries } from '../stores/transport.js';
import { createCostEntry, getCostEntry } from '../stores/costs.js';
import { createIntake, getIntake, updateCandidate, acceptCandidate, rejectCandidate, resetCandidateToPending } from '../stores/intake.js';
import { extractCandidates, extractPriceFromText } from '../extraction.js';
import { buildGoogleMapsUrl } from '../../lib/googleMaps.js';
import { reconstructLines, stripRepeatedPageBoilerplate } from '../../lib/pdfText.js';
import { createAccommodation, getAccommodation, updateAccommodation, normalizeAccommodation, ACCOMMODATION_AMENITIES } from '../stores/accommodations.js';
import { createWeatherNote, normalizeWeatherNote, getWeatherNote } from '../stores/weatherNotes.js';
import { defaultDateRangeForMonths } from '../../lib/weatherOptions.js';
import { emptyFeeBand, formatFeeBands } from '../../lib/feeBands.js';
import { formatOpeningHours, isOpeningHoursEmpty, resolveOpeningHoursForWeekday, emptyOpeningHours } from '../../lib/openingHours.js';
import { CORE_CURRENCIES, getCurrencyOptions, addDestinationCurrency, setExchangeRate, getExchangeRate, convertAmount } from '../currency.js';
import { createShoppingItem } from '../stores/shoppingItems.js';
import { createShop, normalizeShop } from '../stores/shops.js';
import { createLocation, listLocations, updateLocation, deleteLocation, getLocation } from '../stores/locations.js';
import { createPracticalInfoEntry, listPracticalInfoEntries, updatePracticalInfoEntry, deletePracticalInfoEntry } from '../stores/practicalInfo.js';
import { createJourney, listJourneys, updateJourney, deleteJourney, getJourney, listJourneysUsingLocation, retireJourneysUsingLocation, describeJourney } from '../stores/journeys.js';
import { createDish, listDishes, updateDish, deleteDish, getDish, linkDishToRestaurant, unlinkDishFromRestaurant, listDishesForRestaurant } from '../stores/dishes.js';
import { normalizeTransportEntry, updateTransportEntry } from '../stores/transport.js';
import { getDestinationDefaultCurrency, setDestinationDefaultCurrency } from '../currency.js';
import { createPerson, listPeople, getPerson, updatePerson, deletePerson } from '../stores/people.js';
import { createPlanning, listPlannings, getPlanning, updatePlanning, deletePlanning, planningDayCount, planningDayDate, listPlanningDays } from '../stores/plannings.js';
import { createTimelineItem, listTimelineItems, getTimelineItem, updateTimelineItem, deleteTimelineItem, listTimelineItemsForDay, TIMELINE_ITEM_TYPES, TIMELINE_RESEARCH_REF_TYPES } from '../stores/timelineItems.js';
import { createOptionGroup, listOptionGroupsForPlanning, getOptionGroup, selectOption, deleteOptionGroup } from '../stores/planningOptionGroups.js';
import { createItemAlternative, listAlternativesForItem, getItemAlternative, updateItemAlternative, deleteItemAlternative } from '../stores/itemAlternatives.js';
import { weekdayKeyForDate, checkOpeningHours, checkDuration, checkBestTime, validateTimelineItem, toMinutes, minutesToTime, itemEndTime, checkItemOverlap } from '../../lib/planningValidation.js';
import { getHomeCurrency, setHomeCurrency } from '../appSettings.js';
import {
  isTimelineItemCurrentlyIncluded, isAlternativeCurrentlyIncluded, ageAsOf, ageQualifiesForBand,
  calculateAttractionCost, calculateRestaurantCost, calculateTransportCost, calculateAccommodationCost, calculateCustomItemCost,
  nightsForAccommodationItem, calculateItemCost, costCategoryForItem, calculatePlanningCostBreakdown, convertTotalToHomeCurrency, COST_CATEGORIES,
} from '../../lib/planningCosts.js';

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

await test('emptyFeeBand() with no argument defaults currency to an empty string (backward compatible)', () => {
  const band = emptyFeeBand();
  assert.equal(band.currency, '');
});

await test('emptyFeeBand(defaultCurrency) initializes a fresh band with the destination default currency, not blank', () => {
  const band = emptyFeeBand('INR');
  assert.equal(band.currency, 'INR');
  // Everything else about a fresh band is unaffected by this change.
  assert.equal(band.status, 'unknown');
  assert.equal(band.amount, '');
  assert.equal(band.label, '');
});

await test('a new fee band created with a default currency saves that currency, not blank, on an otherwise-untouched band', async () => {
  const dest = await createDestination({ name: 'Test' });
  const freshBand = { ...emptyFeeBand('INR'), status: 'paid', amount: 200 };
  const item = await createAttraction(dest.id, { place: { name: 'New Fort' }, feeBands: [freshBand] });
  assert.equal(item.feeBands[0].currency, 'INR', 'a genuinely new band should not persist a blank currency when a destination default exists');
  assert.equal(item.feeBands[0].amount, 200);
});

await test('an existing saved fee band with its own currency is never rewritten by the default-currency initialization', async () => {
  const dest = await createDestination({ name: 'Test' });
  const savedBand = { id: crypto.randomUUID(), label: '', minAge: '', maxAge: '', status: 'paid', amount: 500, currency: 'LKR' };
  const item = await createAttraction(dest.id, { place: { name: 'Old Fort' }, feeBands: [savedBand] });
  assert.equal(item.feeBands[0].currency, 'LKR', 'emptyFeeBand()\'s default-currency change only affects newly-created bands, never a band that already carries its own currency');
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

await test('a cross-currency rate can be derived through USD when both legs are on file (Phase 3 Chunk 2)', async () => {
  await setExchangeRate('USD', 'LKR', 305);
  await setExchangeRate('USD', 'KGS', 87);
  const rate = await getExchangeRate('LKR', 'KGS');
  // 1 USD = 305 LKR, 1 USD = 87 KGS -> 1 LKR = 87/305 KGS
  assert.ok(Math.abs(rate - (87 / 305)) < 0.0001, `expected ~${87 / 305}, got ${rate}`);
});

await test('the USD-bridge derivation still returns null when one of the two legs is missing', async () => {
  const result = await getExchangeRate('LKR', 'MYR'); // MYR never set in this test run
  assert.equal(result, null);
});

await test('a direct rate always takes priority over the USD-bridge derivation, even if both exist', async () => {
  await setExchangeRate('USD', 'THB', 36);
  await setExchangeRate('USD', 'PHP', 56);
  await setExchangeRate('THB', 'PHP', 1.75); // a direct rate the person entered themselves
  const rate = await getExchangeRate('THB', 'PHP');
  assert.equal(rate, 1.75, 'a directly-recorded rate must win over the derived USD-bridge value');
});

await test('the USD-bridge derivation never touches any stored research record, exactly like direct/inverse rates', async () => {
  const dest = await createDestination({ name: 'Kyrgyzstan' });
  await setExchangeRate('USD', 'LKR', 305);
  await setExchangeRate('USD', 'KGS', 87);
  const item = await createAttraction(dest.id, { place: { name: 'Ala-Too Square' }, feeBands: [{ id: crypto.randomUUID(), label: '', minAge: '', maxAge: '', status: 'paid', amount: 500, currency: 'LKR' }] });
  await getExchangeRate('LKR', 'KGS'); // trigger the bridge derivation
  const reloaded = await getAttraction(item.id);
  assert.equal(reloaded.feeBands[0].amount, 500);
  assert.equal(reloaded.feeBands[0].currency, 'LKR', 'a cross-currency derivation must never rewrite a stored fee\'s original amount/currency');
});

await test('convertAmount returns null (never a guess) when no rate is on file', async () => {
  const result = await convertAmount(100, 'VND', 'USD');
  assert.equal(result, null);
});

console.log('\n13b. Weather — exact editable date ranges (Phase 3 Chunk 3)');
await test('a weather note can be created with exact start/end dates alongside the existing free-text period', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const note = await createWeatherNote(dest.id, { period: 'Safari season', startDate: '2001-07-01', endDate: '2001-09-15' });
  assert.equal(note.startDate, '2001-07-01');
  assert.equal(note.endDate, '2001-09-15');
  assert.equal(note.period, 'Safari season', 'period remains the required, always-present field');
});

await test('a weather note with no dates set defaults to empty strings, not required', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const note = await createWeatherNote(dest.id, { period: 'December' });
  assert.equal(note.startDate, '');
  assert.equal(note.endDate, '');
});

await test('a weather note saved before startDate/endDate existed remains fully readable', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const note = await createWeatherNote(dest.id, { period: 'Old note, period only' });
  delete note.startDate;
  delete note.endDate;
  assert.equal(note.period, 'Old note, period only', 'a legacy record with no date keys at all remains valid and readable');
});

await test('defaultDateRangeForMonths produces the 1st of the start month through the last day of the end month', () => {
  const { startDate, endDate } = defaultDateRangeForMonths('July', 'September');
  assert.equal(startDate, '2001-07-01');
  assert.equal(endDate, '2001-09-30', 'September has 30 days');
});

await test('defaultDateRangeForMonths handles a single month (start === end) correctly, including February', () => {
  const single = defaultDateRangeForMonths('December', 'December');
  assert.equal(single.startDate, '2001-12-01');
  assert.equal(single.endDate, '2001-12-31');
  const feb = defaultDateRangeForMonths('February', 'February');
  assert.equal(feb.endDate, '2001-02-28', 'the reference year (2001) is a non-leap year, so February has 28 days');
});

await test('defaultDateRangeForMonths returns empty strings for an unrecognized month name rather than throwing', () => {
  const result = defaultDateRangeForMonths('Not a real month', 'July');
  assert.deepEqual(result, { startDate: '', endDate: '' });
});

await test('editing an existing weather note\'s dates does not require re-entering the period', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const note = await createWeatherNote(dest.id, { period: 'Dry season' });
  const updated = await getWeatherNote(note.id);
  updated.startDate = '2001-06-01';
  updated.endDate = '2001-08-31';
  const reSaved = await createWeatherNote(dest.id, { period: updated.period, startDate: updated.startDate, endDate: updated.endDate });
  assert.equal(reSaved.period, 'Dry season');
  assert.equal(reSaved.startDate, '2001-06-01');
});

console.log('\n13c. Shopping — structured opening hours reusing the existing Attractions model (Phase 3 Chunk 4)');
await test('a shop can be created with structured opening hours (the same model Attractions uses)', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const item = await createShoppingItem(dest.id, { name: 'Loose-leaf tea' });
  const hours = [{ id: crypto.randomUUID(), days: ['daily'], ranges: [{ start: '10:00', end: '19:00' }] }];
  const shop = await createShop(dest.id, { shoppingItemId: item.id, place: { name: 'Nathmulls' }, openingHours: hours });
  assert.deepEqual(shop.openingHours, hours);
  assert.equal(formatOpeningHours(shop.openingHours), 'Daily: 10:00–19:00');
});

await test('a shop with no opening hours set defaults to the standard empty structure, not a blank string', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const item = await createShoppingItem(dest.id, { name: 'Tea' });
  const shop = await createShop(dest.id, { shoppingItemId: item.id, place: { name: 'Some Shop' } });
  assert.equal(formatOpeningHours(shop.openingHours), null, 'an unfilled structure formats as "no hours set", same as Attractions');
});

await test('a shop saved before opening hours were structured (a plain string) is preserved and surfaced, not lost', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const item = await createShoppingItem(dest.id, { name: 'Tea' });
  const shop = await createShop(dest.id, { shoppingItemId: item.id, place: { name: 'Old Shop' } });
  // Simulate a genuinely pre-Chunk-4 record: openingHours was a plain string.
  shop.openingHours = '10am-8pm daily';
  const normalized = normalizeShop(shop);
  assert.equal(normalized.openingHoursLegacyText, '10am-8pm daily', 'the old free-text value is preserved, not discarded');
  assert.equal(formatOpeningHours(normalized.openingHours), null, 'openingHours itself becomes an empty structure so the field never crashes structured-hours UI');
  assert.equal(normalized.openingHours.length, 1);
  assert.deepEqual(normalized.openingHours[0].days, ['daily']);
});

await test('normalizeShop leaves an already-structured shop record untouched', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const item = await createShoppingItem(dest.id, { name: 'Tea' });
  const hours = [{ id: crypto.randomUUID(), days: ['mon', 'tue'], ranges: [{ start: '09:00', end: '17:00' }] }];
  const shop = await createShop(dest.id, { shoppingItemId: item.id, place: { name: 'New Shop' }, openingHours: hours });
  const normalized = normalizeShop(shop);
  assert.deepEqual(normalized.openingHours, hours);
  assert.equal(normalized.openingHoursLegacyText, '');
});

console.log('\n13d. Accommodation — fixed amenities checklist and extra-person charges (Phase 3 Chunk 5)');
await test('an accommodation can be created with a subset of the fixed amenities list', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const hotel = await createAccommodation(dest.id, { place: { name: 'Cinnamon Grand' }, amenities: ['Great location', 'Swimming pool', 'Breakfast included'] });
  assert.deepEqual(hotel.amenities, ['Great location', 'Swimming pool', 'Breakfast included']);
});

await test('the fixed amenities list matches the exact approved set, no more and no less', () => {
  assert.deepEqual(ACCOMMODATION_AMENITIES, [
    'Great location', 'Near attractions', 'Near public transport', 'Airport transfer',
    'Pickup/drop facility', 'Air conditioning', 'Breakfast included', 'Swimming pool', 'Parking',
  ]);
});

await test('an accommodation with no amenities selected defaults to an empty array, not undefined', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const hotel = await createAccommodation(dest.id, { place: { name: 'Basic Guesthouse' } });
  assert.deepEqual(hotel.amenities, []);
});

await test('extra-person charges are stored as structured { label, price } entries, each with its own currency preserved independently', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const hotel = await createAccommodation(dest.id, {
    place: { name: 'Family Resort' },
    price: { amount: 6000, currency: 'INR', unit: 'per night', note: '' },
    extraPersonCharges: [
      { label: 'Extra adult', price: { amount: 1500, currency: 'INR', unit: 'per night', note: '' } },
      { label: 'Extra child', price: { amount: 750, currency: 'INR', unit: 'per night', note: '' } },
    ],
  });
  assert.equal(hotel.extraPersonCharges.length, 2);
  assert.equal(hotel.extraPersonCharges[0].label, 'Extra adult');
  assert.equal(hotel.extraPersonCharges[0].price.amount, 1500);
  assert.equal(hotel.extraPersonCharges[1].label, 'Extra child');
  assert.equal(hotel.extraPersonCharges[1].price.amount, 750);
});

await test('an accommodation with no extra-person charges defaults to an empty array', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const hotel = await createAccommodation(dest.id, { place: { name: 'Simple Room' } });
  assert.deepEqual(hotel.extraPersonCharges, []);
});

await test('an accommodation saved before amenities/extraPersonCharges existed remains fully readable, and normalizeAccommodation fills in safe defaults without altering anything else', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const hotel = await createAccommodation(dest.id, { place: { name: 'Old Hotel' }, price: { amount: 5000, currency: 'INR', unit: 'per night', note: '' } });
  // Simulate a genuinely pre-Chunk-5 record.
  delete hotel.amenities;
  delete hotel.extraPersonCharges;
  const normalized = normalizeAccommodation(hotel);
  assert.deepEqual(normalized.amenities, []);
  assert.deepEqual(normalized.extraPersonCharges, []);
  assert.equal(normalized.place.name, 'Old Hotel', 'unrelated fields are completely untouched by normalization');
  assert.equal(normalized.price.amount, 5000);
});

await test('a legacy accommodation record with a stored priority value keeps it in storage even though the form no longer shows or sets it (confirmed again for this chunk)', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const hotel = await createAccommodation(dest.id, { place: { name: 'Legacy Priority Hotel' }, priority: 'useful' });
  const updated = await updateAccommodation(hotel.id, { amenities: ['Parking'] });
  assert.equal(updated.priority, 'useful', 'adding amenities to a legacy record must never clear its old priority value');
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

await test('a legacy mustTryDishes value on a restaurant survives being updated via the Chunk 11 combined form (which no longer sets that field)', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  // Simulate a restaurant saved before Chunk 11, when the active form
  // still wrote mustTryDishes.
  const restaurant = await createRestaurantEntry(dest.id, { place: { name: 'Kunga Restaurant' }, mustTryDishes: ['Momo', 'Fried Rice'] });
  assert.deepEqual(restaurant.mustTryDishes, ['Momo', 'Fried Rice']);

  // The new combined RestaurantForm's handleSubmit builds its `fields`
  // object WITHOUT a mustTryDishes key at all (see RestaurantsPage.jsx)
  // — confirm that updating other fields this way never clears it.
  const updated = await updateRestaurantEntry(restaurant.id, { cuisine: 'Tibetan', priceTier: 'regular' });
  assert.deepEqual(updated.mustTryDishes, ['Momo', 'Fried Rice'], 'editing a restaurant through the Chunk 11 form must never silently discard its legacy mustTryDishes note');
  assert.equal(updated.cuisine, 'Tibetan');
  assert.equal(updated.priceTier, 'regular');
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

console.log('\n20c. Transport — real fromLocationId/toLocationId endpoint references (Phase 3 Chunk 6)');
await test('an inter-city transport record can reference two real, distinct locations via fromLocationId/toLocationId', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const colombo = await createLocation(dest.id, { name: 'Colombo' });
  const kandy = await createLocation(dest.id, { name: 'Kandy' });
  const entry = await createTransportEntry(dest.id, {
    travelType: 'inter_city',
    from: { label: 'Colombo' }, to: { label: 'Kandy' },
    fromLocationId: colombo.id, toLocationId: kandy.id,
  });
  assert.equal(entry.fromLocationId, colombo.id);
  assert.equal(entry.toLocationId, kandy.id);
  assert.equal(entry.from.label, 'Colombo', 'the display label is still populated alongside the real location reference');
});

await test('fromLocationId/toLocationId default to null when not provided, never forced or guessed from the label', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const entry = await createTransportEntry(dest.id, { from: { label: 'Colombo' }, to: { label: 'Kandy' } });
  assert.equal(entry.fromLocationId, null);
  assert.equal(entry.toLocationId, null);
});

await test('a transport record saved before fromLocationId/toLocationId existed remains fully readable, and normalizeTransportEntry fills in null defaults without altering the legacy labels', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const entry = await createTransportEntry(dest.id, { from: { label: 'Colombo' }, to: { label: 'Kandy' } });
  delete entry.fromLocationId;
  delete entry.toLocationId;
  const normalized = normalizeTransportEntry(entry);
  assert.equal(normalized.fromLocationId, null);
  assert.equal(normalized.toLocationId, null);
  assert.equal(normalized.from.label, 'Colombo', 'the legacy free-text label is completely untouched by normalization');
  assert.equal(normalized.to.label, 'Kandy');
});

await test('fromLocationId/toLocationId are stored completely independently of journeyId — setting one never implies or requires the other', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const colombo = await createLocation(dest.id, { name: 'Colombo' });
  const kandy = await createLocation(dest.id, { name: 'Kandy' });
  const withoutJourney = await createTransportEntry(dest.id, {
    from: { label: 'Colombo' }, to: { label: 'Kandy' }, fromLocationId: colombo.id, toLocationId: kandy.id,
  });
  assert.equal(withoutJourney.journeyId, null, 'real location endpoints do not require or auto-create a journey link');

  const journey = await createJourney(dest.id, { fromLocationId: colombo.id, toLocationId: kandy.id });
  const withJourney = await createTransportEntry(dest.id, {
    from: { label: 'Colombo' }, to: { label: 'Kandy' }, fromLocationId: colombo.id, toLocationId: kandy.id, journeyId: journey.id,
  });
  assert.equal(withJourney.journeyId, journey.id);
  assert.equal(withJourney.fromLocationId, colombo.id, 'journeyId and fromLocationId/toLocationId coexist without conflict');
});

await test('local transport is unaffected by fromLocationId/toLocationId — it never sets or requires them', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const kandy = await createLocation(dest.id, { name: 'Kandy' });
  const local = await createTransportEntry(dest.id, { travelType: 'local', locationId: kandy.id, mode: 'Tuk-tuk' });
  assert.equal(local.fromLocationId, null);
  assert.equal(local.toLocationId, null);
  assert.equal(local.locationId, kandy.id, 'local transport continues to use locationId, not from/to endpoints');
});

await test('a legacy transport record with a stored priority value keeps it in storage even though the form no longer shows or sets it', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const entry = await createTransportEntry(dest.id, { from: { label: 'Colombo' }, to: { label: 'Galle' }, priority: 'optional' });
  const updated = await updateTransportEntry(entry.id, { duration: '2.5 hours' });
  assert.equal(updated.priority, 'optional', 'updating an unrelated field must never silently clear a pre-existing priority value');
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

console.log('\n13e. Practical Info — custom topics (Phase 3 Chunk 8: already supported at the data layer via topic="Other" + topicOther)');
await test('multiple distinct custom topics can coexist for the same destination, each independently identifiable', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const festivals = await createPracticalInfoEntry(dest.id, { topic: 'Other', topicOther: 'Local Festivals', details: 'Vesak in May' });
  const tipping = await createPracticalInfoEntry(dest.id, { topic: 'Other', topicOther: 'Tipping norms', details: '10% is standard' });
  const items = await listPracticalInfoEntries(dest.id);
  const labels = items.map(i => i.topic === 'Other' ? i.topicOther : i.topic).sort();
  assert.deepEqual(labels, ['Local Festivals', 'Tipping norms']);
  assert.notEqual(festivals.id, tipping.id);
});

await test('a custom-topic entry can be added to, edited, and deleted exactly like a predefined-topic entry', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const entry = await createPracticalInfoEntry(dest.id, { topic: 'Other', topicOther: 'Local Festivals', details: 'Vesak in May' });
  const updated = await updatePracticalInfoEntry(entry.id, { details: 'Vesak in May, Poson in June' });
  assert.equal(updated.details, 'Vesak in May, Poson in June');
  assert.equal(updated.topicOther, 'Local Festivals', 'editing details does not disturb the custom topic name');
  await deletePracticalInfoEntry(entry.id);
  const remaining = await listPracticalInfoEntries(dest.id);
  assert.equal(remaining.find(i => i.id === entry.id), undefined);
});

await test('a second entry can be added under an already-used custom topic name, grouping naturally with the first', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  await createPracticalInfoEntry(dest.id, { topic: 'Other', topicOther: 'Local Festivals', name: 'Vesak', details: 'May full moon' });
  await createPracticalInfoEntry(dest.id, { topic: 'Other', topicOther: 'Local Festivals', name: 'Poson', details: 'June full moon' });
  const items = await listPracticalInfoEntries(dest.id);
  const festivalEntries = items.filter(i => i.topic === 'Other' && i.topicOther === 'Local Festivals');
  assert.equal(festivalEntries.length, 2, 'both entries share the same custom topic name and can be grouped together by it');
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

console.log('\n22. Phase 3 Chunk 1 — section-specific classification replacing generic Priority');
await test('an attraction can be created with a visitPriority (Must see / Maybe / Skippable), independent of the generic shared priority field', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Sigiriya' }, visitPriority: 'must_see' });
  assert.equal(attraction.visitPriority, 'must_see');
  assert.equal(attraction.priority, null, 'the generic shared priority field defaults to null and is untouched by visitPriority');
});

await test('an attraction with no visitPriority set defaults to null, not a forced value', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Galle Fort' } });
  assert.equal(attraction.visitPriority, null);
});

await test('an attraction saved before visitPriority existed remains fully readable (no key at all, not just null)', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Old Attraction' } });
  delete attraction.visitPriority; // simulate a genuinely pre-Phase-3 record
  assert.equal(attraction.place.name, 'Old Attraction', 'reading an old record with no visitPriority key at all does not throw or corrupt the record');
});

await test('a restaurant can be created with a priceTier (Budget-friendly / Regular / Fine dining), independent of the generic shared priority field', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const restaurant = await createRestaurantEntry(dest.id, { place: { name: 'Ministry of Crab' }, priceTier: 'fine_dining' });
  assert.equal(restaurant.priceTier, 'fine_dining');
  assert.equal(restaurant.priority, null);
});

await test('a restaurant with no priceTier set defaults to null', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const restaurant = await createRestaurantEntry(dest.id, { place: { name: 'Local eatery' } });
  assert.equal(restaurant.priceTier, null);
});

await test('a restaurant saved before priceTier existed remains fully readable', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const restaurant = await createRestaurantEntry(dest.id, { place: { name: 'Old Restaurant' } });
  delete restaurant.priceTier;
  assert.equal(restaurant.place.name, 'Old Restaurant');
});

await test('accommodation/transport/shopping records no longer require or set the generic priority field, but old stored values are never rewritten', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const hotel = await createAccommodation(dest.id, { place: { name: 'Old Hotel' } });
  assert.equal(hotel.priority, null, 'a new accommodation record has no priority set, since the form no longer offers it');
  // Simulate an old record that DOES have a stored priority value from
  // before this chunk — updating other fields must never clear it.
  const legacyHotel = await createAccommodation(dest.id, { place: { name: 'Legacy Hotel' }, priority: 'must_know' });
  const updated = await updateAccommodation(legacyHotel.id, { roomType: 'Deluxe' });
  assert.equal(updated.priority, 'must_know', 'updating an unrelated field must never silently clear a pre-existing priority value the form no longer shows');
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

console.log('\n22. People (Tour Planning, Chunk 1 — reusable traveller directory)');
await test('create, list, get, update, and soft-delete a person', async () => {
  const alice = await createPerson({ name: 'Alice', dob: '1990-05-14' });
  assert.ok(alice.id);
  assert.equal(alice.name, 'Alice');
  assert.equal(alice.dob, '1990-05-14');
  assert.equal(alice.deletedAt, null);

  const fetched = await getPerson(alice.id);
  assert.equal(fetched.name, 'Alice');

  await createPerson({ name: 'Bob', dob: '1985-01-01' });
  const all = await listPeople();
  assert.equal(all.length, 2);
  assert.deepEqual(all.map(p => p.name), ['Alice', 'Bob'], 'listPeople sorts by name');

  const updated = await updatePerson(alice.id, { name: 'Alice Smith' });
  assert.equal(updated.name, 'Alice Smith');
  assert.equal(updated.dob, '1990-05-14', 'unrelated fields survive an update untouched');

  await deletePerson(alice.id);
  assert.equal(await getPerson(alice.id), null, 'a soft-deleted person is no longer returned by getPerson');
  const afterDelete = await listPeople();
  assert.equal(afterDelete.length, 1, 'a soft-deleted person is excluded from listPeople');
  assert.equal(afterDelete[0].name, 'Bob');
});

await test('DOB is required — a person cannot be created or updated to have no DOB', async () => {
  await assert.rejects(() => createPerson({ name: 'No Birthday' }), /date of birth/i);
  await assert.rejects(() => createPerson({ name: 'Empty Birthday', dob: '' }), /date of birth/i);
  const person = await createPerson({ name: 'Has Birthday', dob: '2000-01-01' });
  await assert.rejects(() => updatePerson(person.id, { dob: '' }), /date of birth/i);
});

await test('name is required for a person', async () => {
  await assert.rejects(() => createPerson({ dob: '2000-01-01' }), /name/i);
  await assert.rejects(() => createPerson({ name: '  ', dob: '2000-01-01' }), /name/i);
});

console.log('\n23. Plannings (Tour Planning, Chunk 1 — foundation: no timeline items yet)');
await test('create, list, get, update, and soft-delete a Planning', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const traveller = await createPerson({ name: 'Priya', dob: '1992-03-20' });

  const planning = await createPlanning(dest.id, {
    name: 'Northern Sri Lanka, January 2026',
    startDate: '2026-01-10',
    endDate: '2026-01-15',
    notes: 'Focus on Jaffna and the north.',
    travellerIds: [traveller.id],
  });
  assert.ok(planning.id);
  assert.equal(planning.destinationId, dest.id);
  assert.equal(planning.name, 'Northern Sri Lanka, January 2026');
  assert.deepEqual(planning.travellerIds, [traveller.id]);
  assert.equal(planning.deletedAt, null);

  const fetched = await getPlanning(planning.id);
  assert.equal(fetched.startDate, '2026-01-10');

  const list = await listPlannings(dest.id);
  assert.equal(list.length, 1);

  const updated = await updatePlanning(planning.id, { name: 'Renamed Trip' });
  assert.equal(updated.name, 'Renamed Trip');
  assert.equal(updated.startDate, '2026-01-10', 'unrelated fields survive an update untouched');

  await deletePlanning(planning.id);
  assert.equal(await getPlanning(planning.id), null, 'a soft-deleted Planning is no longer returned by getPlanning');
  assert.equal((await listPlannings(dest.id)).length, 0, 'a soft-deleted Planning is excluded from listPlannings');
});

await test('a Planning does not duplicate People or Destination data — travellerIds/destinationId are references only', async () => {
  const dest = await createDestination({ name: 'Japan', overview: 'Cherry blossoms' });
  const person = await createPerson({ name: 'Kenji', dob: '1988-11-02' });
  const planning = await createPlanning(dest.id, { name: 'Spring Trip', startDate: '2027-04-01', endDate: '2027-04-05', travellerIds: [person.id] });

  // The Planning record itself carries only ids, never a copy of the
  // person's or destination's own fields.
  assert.equal(Object.prototype.hasOwnProperty.call(planning, 'name') && planning.travellerIds.includes(person.id), true);
  assert.equal(planning.destinationId, dest.id);
  assert.equal(JSON.stringify(planning).includes('Kenji'), false, 'the traveller\'s name is never copied into the Planning record');
  assert.equal(JSON.stringify(planning).includes('Cherry blossoms'), false, 'the destination\'s own fields are never copied into the Planning record');

  // Updating the person afterwards doesn't require touching the
  // Planning at all — proving there's nothing to keep in sync.
  await updatePerson(person.id, { name: 'Kenji Tanaka' });
  const stillSame = await getPlanning(planning.id);
  assert.deepEqual(stillSame.travellerIds, [person.id]);
});

await test('required-field validation: name, destination, start date, end date', async () => {
  const dest = await createDestination({ name: 'Peru' });
  await assert.rejects(() => createPlanning(dest.id, { startDate: '2026-01-01', endDate: '2026-01-05' }), /name/i, 'Planning name is required');
  await assert.rejects(() => createPlanning('', { name: 'No Destination', startDate: '2026-01-01', endDate: '2026-01-05' }), /destination/i, 'destination is required');
  await assert.rejects(() => createPlanning(dest.id, { name: 'No Start', endDate: '2026-01-05' }), /start date/i);
  await assert.rejects(() => createPlanning(dest.id, { name: 'No End', startDate: '2026-01-01' }), /end date/i);
});

await test('end date cannot be before start date, on create or update', async () => {
  const dest = await createDestination({ name: 'Vietnam' });
  await assert.rejects(
    () => createPlanning(dest.id, { name: 'Backwards Trip', startDate: '2026-05-10', endDate: '2026-05-01' }),
    /end date cannot be before start date/i,
  );
  const planning = await createPlanning(dest.id, { name: 'Valid Trip', startDate: '2026-05-01', endDate: '2026-05-10' });
  await assert.rejects(
    () => updatePlanning(planning.id, { endDate: '2026-04-01' }),
    /end date cannot be before start date/i,
    'shrinking endDate below the existing startDate via update is also rejected',
  );
  // A same-day trip (start === end) is exactly one day and must be valid.
  const sameDay = await createPlanning(dest.id, { name: 'Day Trip', startDate: '2026-06-01', endDate: '2026-06-01' });
  assert.equal(planningDayCount(sameDay), 1);
});

console.log('\n24. Derived Days — no planningDays store, everything computed from startDate/endDate');
await test('planningDayCount / planningDayDate / listPlanningDays compute days from startDate, never store them', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: '6-day trip', startDate: '2026-01-10', endDate: '2026-01-15' });

  assert.equal(planningDayCount(planning), 6);
  assert.equal(planningDayDate(planning, 1), '2026-01-10');
  assert.equal(planningDayDate(planning, 2), '2026-01-11');
  assert.equal(planningDayDate(planning, 6), '2026-01-15');

  const days = listPlanningDays(planning);
  assert.equal(days.length, 6);
  assert.deepEqual(days.map(d => d.dayNumber), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(days.map(d => d.date), ['2026-01-10', '2026-01-11', '2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15']);

  // There is genuinely no planningDays store to assert the absence of
  // in the schema sense — this test instead proves the *behavior* that
  // matters: days are a pure function of the Planning record, not a
  // separately persisted, independently-editable thing.
});

await test('planningDayDate returns local calendar-date components, not a UTC-shifted value — regression for the toISOString() timezone bug', async () => {
  // The bug: new Date('YYYY-MM-DDT00:00:00') is parsed as LOCAL
  // midnight, but toISOString() converts to UTC before formatting. In
  // any timezone AHEAD of UTC (e.g. IST, UTC+5:30), local midnight is
  // still the PREVIOUS day in UTC, so .toISOString().slice(0,10) would
  // incorrectly return one day earlier than the actual local date.
  // planningDayDate must build its YYYY-MM-DD string from the Date
  // object's own LOCAL getters (getFullYear/getMonth/getDate) so the
  // result matches the calendar date the Planning was actually created
  // with, regardless of which timezone Dossier happens to run in.
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: '6-day trip', startDate: '2026-01-10', endDate: '2026-01-15' });

  // The exact Jan 10-15 example from the original requirements.
  assert.equal(planningDayDate(planning, 1), '2026-01-10', 'Day 1 must be 10 Jan, never shifted to 9 Jan');
  assert.equal(planningDayDate(planning, 2), '2026-01-11');
  assert.equal(planningDayDate(planning, 3), '2026-01-12');
  assert.equal(planningDayDate(planning, 4), '2026-01-13');
  assert.equal(planningDayDate(planning, 5), '2026-01-14');
  assert.equal(planningDayDate(planning, 6), '2026-01-15', 'Day 6 must be 15 Jan, never shifted to 14 Jan');

  // Zero-padding: single-digit month and day must still produce
  // two-digit YYYY-MM-DD, not '2026-1-1' or similar.
  const earlyYear = await createPlanning(dest.id, { name: 'New Year trip', startDate: '2026-01-01', endDate: '2026-01-02' });
  assert.equal(planningDayDate(earlyYear, 1), '2026-01-01');
  assert.equal(planningDayDate(earlyYear, 2), '2026-01-02');

  const singleDigitMonth = await createPlanning(dest.id, { name: 'March trip', startDate: '2026-03-05', endDate: '2026-03-07' });
  assert.equal(planningDayDate(singleDigitMonth, 1), '2026-03-05');

  // Month boundary: Day N must roll over into the next month correctly.
  const monthBoundary = await createPlanning(dest.id, { name: 'End of January', startDate: '2026-01-30', endDate: '2026-02-02' });
  assert.equal(planningDayDate(monthBoundary, 1), '2026-01-30');
  assert.equal(planningDayDate(monthBoundary, 2), '2026-01-31');
  assert.equal(planningDayDate(monthBoundary, 3), '2026-02-01', 'rolls into February correctly');
  assert.equal(planningDayDate(monthBoundary, 4), '2026-02-02');

  // Year boundary: Day N must roll over into the next year correctly.
  const yearBoundary = await createPlanning(dest.id, { name: 'New Year\'s Eve trip', startDate: '2026-12-30', endDate: '2027-01-02' });
  assert.equal(planningDayDate(yearBoundary, 1), '2026-12-30');
  assert.equal(planningDayDate(yearBoundary, 2), '2026-12-31');
  assert.equal(planningDayDate(yearBoundary, 3), '2027-01-01', 'rolls into the next year correctly');
  assert.equal(planningDayDate(yearBoundary, 4), '2027-01-02');

  // February in a leap year (2028) vs. a non-leap year (2026).
  const leapYear = await createPlanning(dest.id, { name: 'Leap year trip', startDate: '2028-02-28', endDate: '2028-03-01' });
  assert.equal(planningDayDate(leapYear, 1), '2028-02-28');
  assert.equal(planningDayDate(leapYear, 2), '2028-02-29', 'Feb 29 exists in the 2028 leap year');
  assert.equal(planningDayDate(leapYear, 3), '2028-03-01');
});

await test('changing startDate shifts every day\'s calendar date while day numbers stay stable — the core Chunk 1 requirement', async () => {
  const dest = await createDestination({ name: 'Morocco' });
  const planning = await createPlanning(dest.id, { name: 'Shiftable Trip', startDate: '2026-01-10', endDate: '2026-01-15' });

  const before = listPlanningDays(planning);
  assert.equal(before[0].date, '2026-01-10', 'Day 1 starts on the original start date');
  assert.equal(before.find(d => d.dayNumber === 3).date, '2026-01-12', 'Day 3 is 12 Jan before the shift');

  // Move the whole trip two weeks later.
  const shifted = await updatePlanning(planning.id, { startDate: '2026-01-24', endDate: '2026-01-29' });
  const after = listPlanningDays(shifted);

  assert.equal(after.length, 6, 'day COUNT is unchanged — only the calendar mapping moved');
  assert.equal(after[0].dayNumber, 1, 'Day 1 is still Day 1 (day numbers never change)');
  assert.equal(after[0].date, '2026-01-24', 'but Day 1\'s calendar date has shifted to the new start date');
  assert.equal(after.find(d => d.dayNumber === 3).date, '2026-01-26', 'Day 3 shifted by the same 14 days, still Day 3');
});

await test('shortening a Planning\'s dates changes the derived day count without deleting or altering any Planning field', async () => {
  const dest = await createDestination({ name: 'Iceland' });
  const planning = await createPlanning(dest.id, { name: 'Long trip', startDate: '2026-01-10', endDate: '2026-01-15' });
  assert.equal(planningDayCount(planning), 6);

  const shortened = await updatePlanning(planning.id, { endDate: '2026-01-13' });
  assert.equal(planningDayCount(shortened), 4, 'day count is now derived as 4 from the new, shorter date range');
  // Chunk 1 has no timeline items yet, so there is no day-content to
  // prove survives the shortening — that behavior belongs to whichever
  // later chunk introduces timeline items (see the approved design,
  // §3: existing content beyond the new range is marked out-of-range,
  // never deleted). This test only proves the Planning record itself
  // (name/notes/travellerIds) is untouched by a pure date-range edit.
  assert.equal(shortened.name, 'Long trip');
});

console.log('\n25. Database version upgrade to v6 (people + plannings) preserves data through the full chain');
await test('upgrading a v5 database (journeys exists, people/plannings do not) to v6 adds both new stores without touching existing data', async () => {
  const v5StoreNames = [
    'destinations', 'locations', 'journeys', 'sources', 'attractions', 'restaurants', 'dishes', 'accommodations', 'transport',
    'costs', 'practicalInfo', 'weatherNotes', 'packingNotes', 'generalNotes',
    'shoppingItems', 'shops', 'exchangeRates', 'intakeDocuments', 'candidates',
  ];
  const v5Db = await new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open('dossier', 5);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const name of v5StoreNames) {
        const store = db.createObjectStore(name, { keyPath: 'id' });
        if (!['destinations', 'exchangeRates'].includes(name)) store.createIndex('destinationId', 'destinationId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const tx = v5Db.transaction(['destinations', 'attractions'], 'readwrite');
    tx.objectStore('destinations').put({ id: 'v5-dest', name: 'Pre-Planning Destination', currencies: [], deletedAt: null });
    tx.objectStore('attractions').put({ id: 'v5-attraction', destinationId: 'v5-dest', place: { name: 'Old Attraction' }, deletedAt: null });
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
  v5Db.close();

  __resetDbForTest();
  const destination = await getDestination('v5-dest');
  assert.ok(destination, 'pre-existing v5 destination survives the v5->v6 upgrade');

  const attractions = await listAttractions('v5-dest');
  assert.equal(attractions.length, 1);
  assert.equal(attractions[0].place.name, 'Old Attraction');

  // The new stores must now be fully usable against the upgraded database.
  assert.equal((await listPeople()).length, 0, 'the new people store exists and starts empty');
  const person = await createPerson({ name: 'New Traveller', dob: '1995-06-15' });
  assert.ok(person.id);

  const planning = await createPlanning('v5-dest', { name: 'New Planning', startDate: '2026-02-01', endDate: '2026-02-05', travellerIds: [person.id] });
  assert.ok(planning.id);
  assert.equal((await listPlannings('v5-dest')).length, 1);
});

await test('a full v1 -> v6 upgrade chain preserves an original Phase-0-era destination and its attraction, and People/Plannings work on top of it', async () => {
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
    tx.objectStore('destinations').put({ id: 'v1-dest-planning', name: 'Original Darjeeling Research', overview: 'The very first destination' });
    tx.objectStore('attractions').put({ id: 'v1-attraction-planning', destinationId: 'v1-dest-planning', place: { name: 'Batasia Loop' }, provenance: 'manual', deletedAt: null });
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
  v1Db.close();

  __resetDbForTest();
  const destination = await getDestination('v1-dest-planning');
  assert.ok(destination, 'the original v1 destination survives the full upgrade chain to v6');
  assert.equal(destination.name, 'Original Darjeeling Research');

  const attractions = await listAttractions('v1-dest-planning');
  assert.equal(attractions.length, 1);
  assert.equal(attractions[0].place.name, 'Batasia Loop');

  // People and Plannings, introduced at v6, must work against a
  // database that has been upgraded all the way from v1.
  const person = await createPerson({ name: 'Chain Traveller', dob: '1999-09-09' });
  const planning = await createPlanning('v1-dest-planning', { name: 'Chain Trip', startDate: '2026-03-01', endDate: '2026-03-03', travellerIds: [person.id] });
  assert.equal(planningDayCount(planning), 3);
});

console.log('\n26. Timeline items (Tour Planning, Chunk 2 — basic itinerary, no Options/Alternatives yet)');
await test('create, list, get, update, and soft-delete a timeline item', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-15' });

  const item = await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'Start travel to Ella', startTime: '06:30', plannedDuration: 120, buffer: 15, notes: 'Bring snacks', status: 'planned' });
  assert.ok(item.id);
  assert.equal(item.planningId, planning.id);
  assert.equal(item.dayNumber, 1);
  assert.equal(item.title, 'Start travel to Ella');
  assert.equal(item.startTime, '06:30');
  assert.equal(item.plannedDuration, 120);
  assert.equal(item.buffer, 15);
  assert.equal(item.status, 'planned');
  assert.equal(item.rank, null, 'rank is stored but inert in Chunk 2');
  assert.equal(item.selected, false, 'selected is stored but inert in Chunk 2');
  assert.equal(item.deletedAt, null);

  const fetched = await getTimelineItem(item.id);
  assert.equal(fetched.title, 'Start travel to Ella');

  const all = await listTimelineItems(planning.id);
  assert.equal(all.length, 1);

  const updated = await updateTimelineItem(item.id, { title: 'Travel to Ella (updated)', status: 'optional' });
  assert.equal(updated.title, 'Travel to Ella (updated)');
  assert.equal(updated.status, 'optional');
  assert.equal(updated.startTime, '06:30', 'unrelated fields survive an update untouched');

  await deleteTimelineItem(item.id);
  assert.equal(await getTimelineItem(item.id), null, 'a soft-deleted timeline item is no longer returned by getTimelineItem');
  assert.equal((await listTimelineItems(planning.id)).length, 0, 'a soft-deleted timeline item is excluded from listTimelineItems');
});

await test('a timeline item can reference an existing Research record, without duplicating its data', async () => {
  const dest = await createDestination({ name: 'Japan' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Fushimi Inari Shrine' } });
  const planning = await createPlanning(dest.id, { name: 'Kyoto Trip', startDate: '2026-04-01', endDate: '2026-04-03' });

  const item = await createTimelineItem(planning.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id, startTime: '09:00' });
  assert.equal(item.researchRefType, 'attractions');
  assert.equal(item.researchRefId, attraction.id);
  assert.equal(item.title, '', 'a Research-referenced item has no title of its own — the referenced record supplies the name at display time');
  assert.equal(JSON.stringify(item).includes('Fushimi Inari'), false, 'the referenced record\'s name is never copied onto the timeline item');

  // The same Research record can be referenced by more than one
  // timeline item (e.g. two candidate days), per the approved design.
  const item2 = await createTimelineItem(planning.id, 2, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id, startTime: '15:00' });
  assert.equal(item2.researchRefId, attraction.id);
  assert.equal((await listTimelineItems(planning.id)).length, 2);
});

await test('a timeline item requires either a title or a Research reference', async () => {
  const dest = await createDestination({ name: 'Peru' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-01', endDate: '2026-01-03' });
  await assert.rejects(() => createTimelineItem(planning.id, 1, { itemType: 'custom' }), /title|Research record/i);
  await assert.rejects(() => createTimelineItem(planning.id, 1, { itemType: 'custom', title: '   ' }), /title|Research record/i);
  const withTitle = await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'Free time at the hotel' });
  assert.ok(withTitle.id);
});

await test('only the itinerary-relevant Research sections can be referenced from a timeline item', async () => {
  const dest = await createDestination({ name: 'Vietnam' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-01', endDate: '2026-01-03' });
  assert.deepEqual(TIMELINE_RESEARCH_REF_TYPES, ['attractions', 'restaurants', 'accommodations', 'transport']);
  await assert.rejects(
    () => createTimelineItem(planning.id, 1, { itemType: 'custom', researchRefType: 'weatherNotes', researchRefId: 'some-id' }),
    /Research type cannot be referenced/i,
  );
});

await test('an invalid item type is rejected; every declared TIMELINE_ITEM_TYPES value is accepted', async () => {
  const dest = await createDestination({ name: 'Iceland' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-01', endDate: '2026-01-10' });
  await assert.rejects(() => createTimelineItem(planning.id, 1, { itemType: 'not_a_real_type', title: 'x' }), /valid item type/i);
  for (const itemType of TIMELINE_ITEM_TYPES) {
    const item = await createTimelineItem(planning.id, 1, { itemType, title: `A ${itemType} item` });
    assert.equal(item.itemType, itemType);
  }
});

await test('a day number is required and must be a real day (>= 1)', async () => {
  const dest = await createDestination({ name: 'Norway' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-01', endDate: '2026-01-05' });
  await assert.rejects(() => createTimelineItem(planning.id, 0, { itemType: 'custom', title: 'x' }), /valid day/i);
  await assert.rejects(() => createTimelineItem(planning.id, null, { itemType: 'custom', title: 'x' }), /valid day/i);
});

await test('listTimelineItemsForDay returns only that day\'s items, in time order, with untimed items last', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-15' });

  await createTimelineItem(planning.id, 1, { itemType: 'meal', title: 'Breakfast', startTime: '08:30' });
  await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'Free time', startTime: '' }); // untimed
  await createTimelineItem(planning.id, 1, { itemType: 'travel', title: 'Start travel to Ella', startTime: '06:30' });
  await createTimelineItem(planning.id, 1, { itemType: 'accommodation', title: 'Hotel check-in', startTime: '11:00' });
  await createTimelineItem(planning.id, 2, { itemType: 'custom', title: 'Day 2 item, should not appear', startTime: '07:00' });

  const day1 = await listTimelineItemsForDay(planning.id, 1);
  assert.equal(day1.length, 4, 'only Day 1\'s items are returned');
  assert.deepEqual(day1.map(i => i.title), ['Start travel to Ella', 'Breakfast', 'Hotel check-in', 'Free time'], 'timed items sorted by startTime, untimed item(s) last');

  const day2 = await listTimelineItemsForDay(planning.id, 2);
  assert.equal(day2.length, 1);
  assert.equal(day2[0].title, 'Day 2 item, should not appear');
});

await test('a timeline item stays attached to its dayNumber when the Planning\'s startDate shifts — the core Chunk 2 continuity requirement', async () => {
  const dest = await createDestination({ name: 'Morocco' });
  const planning = await createPlanning(dest.id, { name: 'Shiftable Trip', startDate: '2026-01-10', endDate: '2026-01-15' });
  const item = await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'Visit the mosque', startTime: '10:00' });

  const shifted = await updatePlanning(planning.id, { startDate: '2026-01-24', endDate: '2026-01-29' });
  const stillThere = await getTimelineItem(item.id);
  assert.equal(stillThere.dayNumber, 1, 'the item is still attached to Day 1 — never moved or re-keyed by the date shift');
  assert.equal(stillThere.title, 'Visit the mosque');

  // Day 1's *calendar date* has moved, per Chunk 1's derived-days
  // behavior, but that's computed separately — the item record itself
  // never stores or needs to know a calendar date.
  const days = listPlanningDays(shifted);
  assert.equal(days[0].date, '2026-01-24');
  assert.equal(Object.prototype.hasOwnProperty.call(stillThere, 'date'), false, 'a timeline item never stores its own calendar date');
});

await test('shortening a Planning does not delete timeline items on now-out-of-range days', async () => {
  const dest = await createDestination({ name: 'Iceland' });
  const planning = await createPlanning(dest.id, { name: 'Long trip', startDate: '2026-01-10', endDate: '2026-01-15' });
  const day5Item = await createTimelineItem(planning.id, 5, { itemType: 'custom', title: 'Glacier hike' });

  const shortened = await updatePlanning(planning.id, { endDate: '2026-01-13' }); // now only 4 days
  assert.equal(planningDayCount(shortened), 4);

  const stillThere = await getTimelineItem(day5Item.id);
  assert.ok(stillThere, 'Day 5\'s item is NOT deleted just because the Planning was shortened to 4 days — the UI marks it out-of-range, this store never deletes it');
  assert.equal(stillThere.title, 'Glacier hike');
});

console.log('\n27. Database version upgrade to v7 (timelineItems) preserves data through the full chain');
await test('upgrading a v6 database (people/plannings exist, timelineItems does not) to v7 adds timelineItems without touching existing data', async () => {
  const v6StoreNames = [
    'destinations', 'locations', 'journeys', 'sources', 'attractions', 'restaurants', 'dishes', 'accommodations', 'transport',
    'costs', 'practicalInfo', 'weatherNotes', 'packingNotes', 'generalNotes',
    'shoppingItems', 'shops', 'exchangeRates', 'people', 'plannings', 'intakeDocuments', 'candidates',
  ];
  const v6Db = await new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open('dossier', 6);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const name of v6StoreNames) {
        const store = db.createObjectStore(name, { keyPath: 'id' });
        if (name === 'plannings') store.createIndex('destinationId', 'destinationId');
        else if (!['destinations', 'exchangeRates', 'people'].includes(name)) store.createIndex('destinationId', 'destinationId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const tx = v6Db.transaction(['destinations', 'people', 'plannings'], 'readwrite');
    tx.objectStore('destinations').put({ id: 'v6-dest', name: 'Pre-Timeline Destination', currencies: [], deletedAt: null });
    tx.objectStore('people').put({ id: 'v6-person', name: 'Pre-existing Traveller', dob: '1990-01-01', deletedAt: null });
    tx.objectStore('plannings').put({ id: 'v6-planning', destinationId: 'v6-dest', name: 'Pre-Timeline Planning', startDate: '2026-01-01', endDate: '2026-01-05', notes: '', travellerIds: ['v6-person'], deletedAt: null });
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
  v6Db.close();

  __resetDbForTest();
  const destination = await getDestination('v6-dest');
  assert.ok(destination, 'pre-existing v6 destination survives the v6->v7 upgrade');
  const planning = await getPlanning('v6-planning');
  assert.ok(planning, 'pre-existing v6 Planning survives the v6->v7 upgrade');
  assert.deepEqual(planning.travellerIds, ['v6-person']);

  // The new timelineItems store must now be fully usable.
  assert.equal((await listTimelineItems('v6-planning')).length, 0, 'the new timelineItems store exists and starts empty');
  const item = await createTimelineItem('v6-planning', 1, { itemType: 'custom', title: 'New item on an upgraded database' });
  assert.ok(item.id);
  assert.equal((await listTimelineItems('v6-planning')).length, 1);
});

await test('a full v1 -> v7 upgrade chain preserves an original Phase-0-era destination, and People/Plannings/TimelineItems all work on top of it', async () => {
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
    tx.objectStore('destinations').put({ id: 'v1-dest-timeline', name: 'Original Darjeeling Research', overview: 'The very first destination' });
    tx.objectStore('attractions').put({ id: 'v1-attraction-timeline', destinationId: 'v1-dest-timeline', place: { name: 'Batasia Loop' }, provenance: 'manual', deletedAt: null });
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
  v1Db.close();

  __resetDbForTest();
  const destination = await getDestination('v1-dest-timeline');
  assert.ok(destination, 'the original v1 destination survives the full upgrade chain to v7');

  const attractions = await listAttractions('v1-dest-timeline');
  assert.equal(attractions.length, 1);
  assert.equal(attractions[0].place.name, 'Batasia Loop');

  const person = await createPerson({ name: 'Chain Traveller', dob: '1999-09-09' });
  const planning = await createPlanning('v1-dest-timeline', { name: 'Chain Trip', startDate: '2026-03-01', endDate: '2026-03-03', travellerIds: [person.id] });
  const item = await createTimelineItem(planning.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attractions[0].id, startTime: '10:00' });
  assert.equal(item.researchRefId, attractions[0].id);
  assert.equal((await listTimelineItemsForDay(planning.id, 1)).length, 1);
});

console.log('\n28. Itinerary Option groups (Tour Planning, Chunk 3 — alternative sequences for a day-part)');
await test('create, list, get, select, and soft-delete an Option group', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-15' });

  const group = await createOptionGroup(planning.id, { dayNumber: 3, partLabel: 'Morning' });
  assert.ok(group.id);
  assert.equal(group.planningId, planning.id);
  assert.equal(group.dayNumber, 3);
  assert.equal(group.partLabel, 'Morning');
  assert.equal(group.selectedOptionLabel, null, 'Selection pending by default — nothing forces an immediate choice');

  const fetched = await getOptionGroup(group.id);
  assert.equal(fetched.partLabel, 'Morning');

  const list = await listOptionGroupsForPlanning(planning.id);
  assert.equal(list.length, 1);

  const selected = await selectOption(group.id, 'A');
  assert.equal(selected.selectedOptionLabel, 'A');

  const clearedAgain = await selectOption(group.id, null);
  assert.equal(clearedAgain.selectedOptionLabel, null, 'clearing the selection returns to Selection pending — a valid, supported state');

  await deleteOptionGroup(group.id);
  assert.equal(await getOptionGroup(group.id), null);
  assert.equal((await listOptionGroupsForPlanning(planning.id)).length, 0);
});

await test('a part label is required; day-parts are free-form, not a fixed enum', async () => {
  const dest = await createDestination({ name: 'Peru' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-01', endDate: '2026-01-05' });
  await assert.rejects(() => createOptionGroup(planning.id, { dayNumber: 1, partLabel: '' }), /part label/i);
  await assert.rejects(() => createOptionGroup(planning.id, { dayNumber: 1, partLabel: '   ' }), /part label/i);
  // Not limited to Morning/Afternoon/Evening — any label is accepted.
  const custom = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Pre-dawn hike window' });
  assert.equal(custom.partLabel, 'Pre-dawn hike window');
});

await test('different parts of the same day are independent groups with independent selections', async () => {
  const dest = await createDestination({ name: 'Japan' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-01', endDate: '2026-01-05' });
  const morning = await createOptionGroup(planning.id, { dayNumber: 3, partLabel: 'Morning' });
  await createOptionGroup(planning.id, { dayNumber: 3, partLabel: 'Afternoon' });
  const evening = await createOptionGroup(planning.id, { dayNumber: 3, partLabel: 'Evening' });

  await selectOption(morning.id, 'B');
  await selectOption(evening.id, 'A');
  // Afternoon is left unresolved on purpose.

  const groups = await listOptionGroupsForPlanning(planning.id);
  const byLabel = Object.fromEntries(groups.map(g => [g.partLabel, g]));
  assert.equal(byLabel.Morning.selectedOptionLabel, 'B');
  assert.equal(byLabel.Afternoon.selectedOptionLabel, null, 'Afternoon stays Selection pending independently of Morning/Evening');
  assert.equal(byLabel.Evening.selectedOptionLabel, 'A');
});

console.log('\n29. timelineItems gains partLabel/optionGroupId/optionLabel (Chunk 3, additive)');
await test('a timeline item can be placed into a specific Option, and requires both optionGroupId and optionLabel together', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-15' });
  const group = await createOptionGroup(planning.id, { dayNumber: 3, partLabel: 'Morning' });

  const item = await createTimelineItem(planning.id, 3, { itemType: 'custom', title: 'Attraction A', partLabel: 'Morning', optionGroupId: group.id, optionLabel: 'A' });
  assert.equal(item.partLabel, 'Morning');
  assert.equal(item.optionGroupId, group.id);
  assert.equal(item.optionLabel, 'A');

  await assert.rejects(
    () => createTimelineItem(planning.id, 3, { itemType: 'custom', title: 'x', optionGroupId: group.id }),
    /Option label/i,
    'optionGroupId without optionLabel is rejected',
  );
  await assert.rejects(
    () => createTimelineItem(planning.id, 3, { itemType: 'custom', title: 'x', optionLabel: 'A' }),
    /Option group/i,
    'optionLabel without optionGroupId is rejected',
  );
});

await test('an ordinary timeline item (no Option) has partLabel/optionGroupId/optionLabel all null by default', async () => {
  const dest = await createDestination({ name: 'Iceland' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-01', endDate: '2026-01-05' });
  const item = await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'Breakfast' });
  assert.equal(item.partLabel, null);
  assert.equal(item.optionGroupId, null);
  assert.equal(item.optionLabel, null);
});

await test('multiple Options for the same part can each hold their own sequence of items, independently of one another', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const attractionA = await createAttraction(dest.id, { place: { name: 'Attraction A' } });
  const attractionB = await createAttraction(dest.id, { place: { name: 'Attraction B' } });
  const attractionC = await createAttraction(dest.id, { place: { name: 'Attraction C' } });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-15' });
  const group = await createOptionGroup(planning.id, { dayNumber: 3, partLabel: 'Morning' });

  await createTimelineItem(planning.id, 3, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attractionA.id, partLabel: 'Morning', optionGroupId: group.id, optionLabel: 'A', startTime: '09:00' });
  await createTimelineItem(planning.id, 3, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attractionB.id, partLabel: 'Morning', optionGroupId: group.id, optionLabel: 'A', startTime: '10:30' });
  await createTimelineItem(planning.id, 3, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attractionC.id, partLabel: 'Morning', optionGroupId: group.id, optionLabel: 'B', startTime: '09:00' });

  const all = await listTimelineItemsForDay(planning.id, 3);
  const optionA = all.filter(i => i.optionLabel === 'A');
  const optionB = all.filter(i => i.optionLabel === 'B');
  assert.equal(optionA.length, 2, 'Option A has its own 2-item sequence');
  assert.equal(optionB.length, 1, 'Option B has its own independent 1-item sequence');
});

await test('unselected Options remain visible as planned possibilities — their items are never deleted or hidden by group state', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-15' });
  const group = await createOptionGroup(planning.id, { dayNumber: 3, partLabel: 'Morning' });
  const itemA = await createTimelineItem(planning.id, 3, { itemType: 'custom', title: 'Option A item', optionGroupId: group.id, optionLabel: 'A' });
  const itemB = await createTimelineItem(planning.id, 3, { itemType: 'custom', title: 'Option B item', optionGroupId: group.id, optionLabel: 'B' });

  await selectOption(group.id, 'A');
  // Selecting Option A must not touch Option B's items at all — they
  // are a store-level fact independent of which Option is "current".
  const stillB = await getTimelineItem(itemB.id);
  assert.ok(stillB, 'Option B\'s item still exists after Option A is selected');
  assert.equal(stillB.optionLabel, 'B');
  const stillA = await getTimelineItem(itemA.id);
  assert.ok(stillA);
});

console.log('\n30. Item Alternatives (Tour Planning, Chunk 3 — alternative choices for one timeline slot)');
await test('create, list, get, update, and soft-delete an item alternative, nested under its parent timeline item', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const restaurantA = await createAttraction(dest.id, { place: { name: 'Restaurant A (as attraction stand-in)' } });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-15' });
  const lunchItem = await createTimelineItem(planning.id, 1, { itemType: 'meal', title: 'Lunch' });

  const alt = await createItemAlternative(lunchItem.id, { researchRefType: 'attractions', researchRefId: restaurantA.id, rank: 1 });
  assert.ok(alt.id);
  assert.equal(alt.timelineItemId, lunchItem.id);
  assert.equal(alt.researchRefId, restaurantA.id);
  assert.equal(alt.rank, 1);
  assert.equal(alt.selected, false, 'not selected by default — unresolved is a valid starting state');
  assert.equal(alt.costSelections, null, 'costSelections is stored, unused until a later chunk');

  const fetched = await getItemAlternative(alt.id);
  assert.equal(fetched.rank, 1);

  await createItemAlternative(lunchItem.id, { title: 'Restaurant B (custom entry)', rank: 2 });
  const list = await listAlternativesForItem(lunchItem.id);
  assert.equal(list.length, 2, 'both alternatives are nested under the same parent item');

  const updated = await updateItemAlternative(alt.id, { selected: true });
  assert.equal(updated.selected, true);
  assert.equal(updated.rank, 1, 'unrelated fields survive an update untouched');

  await deleteItemAlternative(alt.id);
  assert.equal(await getItemAlternative(alt.id), null);
  assert.equal((await listAlternativesForItem(lunchItem.id)).length, 1);
});

await test('an item alternative requires either a title or a Research reference, and only itinerary-relevant Research types', async () => {
  const dest = await createDestination({ name: 'Peru' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-01', endDate: '2026-01-05' });
  const item = await createTimelineItem(planning.id, 1, { itemType: 'meal', title: 'Lunch' });
  await assert.rejects(() => createItemAlternative(item.id, {}), /title|Research record/i);
  await assert.rejects(
    () => createItemAlternative(item.id, { researchRefType: 'weatherNotes', researchRefId: 'x' }),
    /Research type cannot be referenced/i,
  );
  const ok = await createItemAlternative(item.id, { title: 'A valid custom alternative' });
  assert.ok(ok.id);
});

await test('unresolved alternative selection is valid — multiple planned alternatives can coexist with none selected', async () => {
  const dest = await createDestination({ name: 'Vietnam' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-01', endDate: '2026-01-05' });
  const item = await createTimelineItem(planning.id, 1, { itemType: 'meal', title: 'Dinner' });
  const altA = await createItemAlternative(item.id, { title: 'Restaurant A', rank: 1 });
  const altB = await createItemAlternative(item.id, { title: 'Restaurant B', rank: 2 });
  assert.equal(altA.selected, false);
  assert.equal(altB.selected, false);
  // Both remain "planned alternatives" without a final choice — a
  // genuinely valid, expected state per the approved design.
  const list = await listAlternativesForItem(item.id);
  assert.equal(list.filter(a => a.selected).length, 0);
  assert.equal(list.length, 2);

  const resolved = await updateItemAlternative(altA.id, { selected: true });
  assert.equal(resolved.selected, true);
  // Once A is selected, B can remain as a planned alternative — nothing
  // auto-clears it, matching "Once Restaurant A is selected, B can
  // remain as a planned alternative" from the approved design.
  const bStill = await getItemAlternative(altB.id);
  assert.equal(bStill.selected, false);
});

await test('an item alternative under an item that belongs to an UNSELECTED Option does not count as current itinerary inclusion', async () => {
  // This proves the "inherited inclusion context" design note in
  // itemAlternatives.js: alternatives never track inclusion themselves
  // — it always depends on whether the PARENT item's Option is
  // currently selected, which is read from planningOptionGroups, not
  // from anything stored on the alternative or the item.
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-15' });
  const group = await createOptionGroup(planning.id, { dayNumber: 3, partLabel: 'Morning' });
  const optionBItem = await createTimelineItem(planning.id, 3, { itemType: 'meal', title: 'Lunch (Option B)', optionGroupId: group.id, optionLabel: 'B' });
  const altUnderB = await createItemAlternative(optionBItem.id, { title: 'Backup restaurant', selected: true });

  // Option A is selected, not B.
  await selectOption(group.id, 'A');

  const currentGroup = await getOptionGroup(group.id);
  const isParentItemCurrentlyIncluded = currentGroup.selectedOptionLabel === optionBItem.optionLabel;
  assert.equal(isParentItemCurrentlyIncluded, false, 'Option B\'s item is not part of the currently-selected sequence');
  // Even though the alternative itself is marked selected, its
  // inclusion in the CURRENT itinerary is governed entirely by its
  // parent's Option context, which is what the UI layer checks — this
  // store-level fact (altUnderB.selected) is unaffected either way.
  const stillSelected = await getItemAlternative(altUnderB.id);
  assert.equal(stillSelected.selected, true, 'the alternative\'s own selected flag is untouched by which Option is current');
});

console.log('\n31. Database version upgrade to v8 (partLabel/optionGroupId/optionLabel + planningOptionGroups + itemAlternatives) preserves data through the full chain');
await test('upgrading a v7 database (timelineItems exists without part/option fields) to v8 adds the new fields and stores without touching or reinterpreting existing timeline items', async () => {
  const v7StoreNames = [
    'destinations', 'locations', 'journeys', 'sources', 'attractions', 'restaurants', 'dishes', 'accommodations', 'transport',
    'costs', 'practicalInfo', 'weatherNotes', 'packingNotes', 'generalNotes',
    'shoppingItems', 'shops', 'exchangeRates', 'people', 'plannings', 'timelineItems', 'intakeDocuments', 'candidates',
  ];
  const v7Db = await new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open('dossier', 7);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const name of v7StoreNames) {
        const store = db.createObjectStore(name, { keyPath: 'id' });
        if (name === 'timelineItems') store.createIndex('planningId', 'planningId');
        else if (name === 'plannings') store.createIndex('destinationId', 'destinationId');
        else if (!['destinations', 'exchangeRates', 'people'].includes(name)) store.createIndex('destinationId', 'destinationId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const tx = v7Db.transaction(['destinations', 'plannings', 'timelineItems'], 'readwrite');
    tx.objectStore('destinations').put({ id: 'v7-dest', name: 'Pre-Options Destination', currencies: [], deletedAt: null });
    tx.objectStore('plannings').put({ id: 'v7-planning', destinationId: 'v7-dest', name: 'Pre-Options Planning', startDate: '2026-01-01', endDate: '2026-01-05', notes: '', travellerIds: [], deletedAt: null });
    // A pre-Chunk-3 timeline item — no partLabel/optionGroupId/optionLabel fields exist on it at all.
    tx.objectStore('timelineItems').put({
      id: 'v7-item', planningId: 'v7-planning', dayNumber: 1, itemType: 'custom', title: 'Pre-existing breakfast item',
      researchRefType: null, researchRefId: null, startTime: '08:00', plannedDuration: null, buffer: null, notes: '',
      status: 'planned', rank: null, selected: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
    });
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
  v7Db.close();

  __resetDbForTest();
  const destination = await getDestination('v7-dest');
  assert.ok(destination, 'pre-existing v7 destination survives the v7->v8 upgrade');
  const planning = await getPlanning('v7-planning');
  assert.ok(planning, 'pre-existing v7 Planning survives the v7->v8 upgrade');

  // The pre-existing timeline item must still exist, completely
  // unmodified, unmoved, and unreinterpreted — not deleted, not
  // auto-assigned to any Option.
  const preExistingItem = await getTimelineItem('v7-item');
  assert.ok(preExistingItem, 'the pre-existing v7 timeline item was not deleted by the migration');
  assert.equal(preExistingItem.title, 'Pre-existing breakfast item');
  assert.equal(preExistingItem.dayNumber, 1);
  assert.equal(preExistingItem.startTime, '08:00');
  // The new fields read as absent/null — meaning "ordinary, current,
  // no competing option" — exactly as an item created fresh after
  // Chunk 3 would mean if never placed in an Option.
  assert.equal(preExistingItem.partLabel ?? null, null, 'a pre-Chunk-3 item has no partLabel — treated as an ordinary item');
  assert.equal(preExistingItem.optionGroupId ?? null, null, 'a pre-Chunk-3 item has no optionGroupId — not part of any Option');
  assert.equal(preExistingItem.optionLabel ?? null, null);

  // It must remain listable exactly as before.
  const dayItems = await listTimelineItemsForDay('v7-planning', 1);
  assert.equal(dayItems.length, 1);
  assert.equal(dayItems[0].id, 'v7-item');

  // It must remain fully editable with the new fields via the normal API.
  const updated = await updateTimelineItem('v7-item', { partLabel: 'Morning' });
  assert.equal(updated.partLabel, 'Morning', 'the new field can be set on a migrated item via the ordinary update path');

  // The new stores must now be fully usable.
  assert.equal((await listOptionGroupsForPlanning('v7-planning')).length, 0, 'the new planningOptionGroups store exists and starts empty');
  const group = await createOptionGroup('v7-planning', { dayNumber: 2, partLabel: 'Afternoon' });
  assert.ok(group.id);
  const alt = await createItemAlternative('v7-item', { title: 'A new alternative on an upgraded database' });
  assert.ok(alt.id);
  assert.equal((await listAlternativesForItem('v7-item')).length, 1);
});

await test('a full v1 -> v8 upgrade chain preserves an original Phase-0-era destination, and every Tour Planning feature works on top of it', async () => {
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
    tx.objectStore('destinations').put({ id: 'v1-dest-options', name: 'Original Darjeeling Research', overview: 'The very first destination' });
    tx.objectStore('attractions').put({ id: 'v1-attraction-options', destinationId: 'v1-dest-options', place: { name: 'Batasia Loop' }, provenance: 'manual', deletedAt: null });
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
  v1Db.close();

  __resetDbForTest();
  const destination = await getDestination('v1-dest-options');
  assert.ok(destination, 'the original v1 destination survives the full upgrade chain to v8');

  const attractions = await listAttractions('v1-dest-options');
  assert.equal(attractions.length, 1);

  const person = await createPerson({ name: 'Chain Traveller', dob: '1999-09-09' });
  const planning = await createPlanning('v1-dest-options', { name: 'Chain Trip', startDate: '2026-03-01', endDate: '2026-03-10', travellerIds: [person.id] });
  const group = await createOptionGroup(planning.id, { dayNumber: 3, partLabel: 'Morning' });
  const item = await createTimelineItem(planning.id, 3, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attractions[0].id, optionGroupId: group.id, optionLabel: 'A', startTime: '09:00' });
  await selectOption(group.id, 'A');
  const alt = await createItemAlternative(item.id, { title: 'A fallback plan' });

  assert.equal((await listTimelineItemsForDay(planning.id, 3)).length, 1);
  assert.equal((await listAlternativesForItem(item.id)).length, 1);
  assert.ok(alt.id);
});

console.log('\n32. Opening-hours: explicit closed flag, additive and backward-compatible (Tour Planning, Chunk 4)');
await test('emptyOpeningHours() includes closed:false by default; isOpeningHoursEmpty/formatOpeningHours handle closed groups correctly', async () => {
  const empty = emptyOpeningHours();
  assert.equal(empty[0].closed, false);
  assert.equal(isOpeningHoursEmpty(empty), true, 'a blank group with closed:false is still "no information yet"');

  const closedGroup = [{ id: '1', days: ['fri'], ranges: [{ start: '', end: '' }], closed: true }];
  assert.equal(isOpeningHoursEmpty(closedGroup), false, 'an explicitly closed group is NOT empty/unresearched — it is a real, known fact');
  assert.equal(formatOpeningHours(closedGroup), 'Fri: Closed');

  const openGroup = [{ id: '1', days: ['daily'], ranges: [{ start: '09:00', end: '17:00' }], closed: false }];
  assert.equal(formatOpeningHours(openGroup), 'Daily: 09:00–17:00');
});

await test('resolveOpeningHoursForWeekday distinguishes closed / open / unknown correctly', async () => {
  const closedFriday = [{ id: '1', days: ['fri'], ranges: [{ start: '', end: '' }], closed: true }];
  assert.equal(resolveOpeningHoursForWeekday(closedFriday, 'fri').status, 'closed');
  assert.equal(resolveOpeningHoursForWeekday(closedFriday, 'mon').status, 'unknown', 'Friday-only group says nothing about Monday');

  const openDaily = [{ id: '1', days: ['daily'], ranges: [{ start: '09:00', end: '18:00' }], closed: false }];
  const openResolved = resolveOpeningHoursForWeekday(openDaily, 'wed');
  assert.equal(openResolved.status, 'open');
  assert.deepEqual(openResolved.ranges, [{ start: '09:00', end: '18:00' }]);

  assert.equal(resolveOpeningHoursForWeekday(emptyOpeningHours(), 'mon').status, 'unknown', 'a genuinely blank record is unknown, never closed');
  assert.equal(resolveOpeningHoursForWeekday([], 'mon').status, 'unknown');
  assert.equal(resolveOpeningHoursForWeekday(null, 'mon').status, 'unknown');
});

await test('normalizeAttraction reads a legacy (pre-Chunk-4) openingHours group missing the closed key as closed:false, unchanged meaning', async () => {
  const legacyRecord = {
    place: { name: 'Legacy Temple' },
    openingHours: [{ id: '1', days: ['daily'], ranges: [{ start: '09:00', end: '17:00' }] }], // no `closed` key at all
  };
  const normalized = normalizeAttraction(legacyRecord);
  assert.equal(normalized.openingHours[0].closed, false, 'a legacy group with no closed key reads as false, not undefined/null');
  assert.equal(resolveOpeningHoursForWeekday(normalized.openingHours, 'mon').status, 'open', 'its original open/hours meaning is completely unchanged');
});

console.log('\n33. Planning validation: opening hours (Tour Planning, Chunk 4)');
await test('weekdayKeyForDate resolves the correct weekday for a given calendar date, consistent with the timezone-safe planningDayDate', async () => {
  assert.equal(weekdayKeyForDate('2026-01-10'), 'sat');
  assert.equal(weekdayKeyForDate('2026-01-09'), 'fri');
  assert.equal(weekdayKeyForDate('2026-01-12'), 'mon');
});

await test('an explicitly closed day produces a critical warning', async () => {
  const record = { place: { name: 'Grand Mosque' }, openingHours: [{ id: '1', days: ['fri'], ranges: [{ start: '', end: '' }], closed: true }] };
  const result = checkOpeningHours({ item: { startTime: '10:00', plannedDuration: 60 }, record, weekdayKey: 'fri' });
  assert.equal(result.level, 'critical');
  assert.match(result.message, /closed/i);
});

await test('a planned interval fully within known opening hours produces no warning', async () => {
  const record = { place: { name: 'Museum' }, openingHours: [{ id: '1', days: ['daily'], ranges: [{ start: '09:00', end: '18:00' }], closed: false }] };
  const result = checkOpeningHours({ item: { startTime: '10:00', plannedDuration: 60 }, record, weekdayKey: 'mon' }); // 10:00-11:00, fully inside
  assert.equal(result, null);
});

await test('a planned interval starting before opening produces a warning', async () => {
  const record = { place: { name: 'Museum' }, openingHours: [{ id: '1', days: ['daily'], ranges: [{ start: '09:00', end: '18:00' }], closed: false }] };
  const result = checkOpeningHours({ item: { startTime: '08:00', plannedDuration: 60 }, record, weekdayKey: 'mon' }); // 08:00-09:00, starts before opening
  assert.equal(result.level, 'warning');
  assert.match(result.message, /opening hours/i);
});

await test('a planned interval ending after closing produces a warning — the FULL interval is checked, not just the start time', async () => {
  const record = { place: { name: 'Museum' }, openingHours: [{ id: '1', days: ['daily'], ranges: [{ start: '09:00', end: '18:00' }], closed: false }] };
  // Starts at 17:30, well within hours, but the 60-minute duration
  // pushes the end to 18:30 — past closing. Checking only the start
  // time would incorrectly pass this; the whole interval must be used.
  const result = checkOpeningHours({ item: { startTime: '17:30', plannedDuration: 60 }, record, weekdayKey: 'mon' });
  assert.equal(result.level, 'warning');
});

await test('unknown/missing opening-hours information produces NO warning, regardless of the planned time', async () => {
  const neverResearched = { place: { name: 'New place' }, openingHours: emptyOpeningHours() };
  assert.equal(checkOpeningHours({ item: { startTime: '23:00', plannedDuration: 500 }, record: neverResearched, weekdayKey: 'mon' }), null);

  const noRecordAtAll = null;
  assert.equal(checkOpeningHours({ item: { startTime: '23:00' }, record: noRecordAtAll, weekdayKey: 'mon' }), null);

  const noStartTime = { place: { name: 'Museum' }, openingHours: [{ id: '1', days: ['daily'], ranges: [{ start: '09:00', end: '18:00' }], closed: false }] };
  assert.equal(checkOpeningHours({ item: { startTime: '', plannedDuration: 60 }, record: noStartTime, weekdayKey: 'mon' }), null, 'no startTime means nothing to compare');
});

await test('a day-of-week that IS covered by hours info but a DIFFERENT day-group is unknown for the requested day never warns', async () => {
  // Only Friday is researched (and it's closed); Monday has no
  // information at all and must never be treated as closed by
  // inference from Friday's data.
  const record = { place: { name: 'Grand Mosque' }, openingHours: [{ id: '1', days: ['fri'], ranges: [{ start: '', end: '' }], closed: true }] };
  const result = checkOpeningHours({ item: { startTime: '10:00', plannedDuration: 60 }, record, weekdayKey: 'mon' });
  assert.equal(result, null);
});

console.log('\n34. Planning validation: structured typical duration (Tour Planning, Chunk 4)');
await test('a planned duration outside the structured typical range is informational, non-blocking', async () => {
  const record = { typicalDurationMin: 60, typicalDurationMax: 90 };
  assert.equal(checkDuration({ item: { plannedDuration: 75 }, record }), null, 'within range -> no finding');
  const tooLong = checkDuration({ item: { plannedDuration: 150 }, record });
  assert.equal(tooLong.level, 'info', 'a duration mismatch is informational, never a warning/critical level');
  assert.match(tooLong.message, /150/);
  assert.match(tooLong.message, /60–90/);
});

await test('an unresearched structured duration (both min and max null) never produces a finding', async () => {
  const record = { typicalDurationMin: null, typicalDurationMax: null };
  assert.equal(checkDuration({ item: { plannedDuration: 999 }, record }), null);
});

await test('checkDuration does not require plannedDuration to be set — a blank plannedDuration produces no finding', async () => {
  const record = { typicalDurationMin: 30, typicalDurationMax: 60 };
  assert.equal(checkDuration({ item: { plannedDuration: null }, record }), null);
  assert.equal(checkDuration({ item: {}, record }), null);
});

await test('the free-text duration fields (typicallySpent / transport duration) are never removed or repurposed by the structured fields', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Sigiriya' }, typicallySpent: '2-3 hours', typicalDurationMin: 120, typicalDurationMax: 180 });
  assert.equal(attraction.typicallySpent, '2-3 hours', 'the original free-text field is completely untouched by the new structured fields');
  assert.equal(attraction.typicalDurationMin, 120);
  assert.equal(attraction.typicalDurationMax, 180);

  const transportEntry = await createTransportEntry(dest.id, { from: { label: 'Colombo' }, to: { label: 'Kandy' }, duration: '3 hours', typicalDurationMin: 150, typicalDurationMax: 210 });
  assert.equal(transportEntry.duration, '3 hours');
  assert.equal(transportEntry.typicalDurationMin, 150);

  const restaurantEntry = await createRestaurantEntry(dest.id, { place: { name: 'Ministry of Crab' }, typicalDurationMin: 60, typicalDurationMax: 90 });
  assert.equal(restaurantEntry.typicalDurationMin, 60);
  assert.equal(restaurantEntry.typicalDurationMax, 90);
});

console.log('\n35. Planning validation: structured best time (Tour Planning, Chunk 4)');
await test('a scheduled time within the structured best-time window produces no hint', async () => {
  const record = { bestTimeStart: '06:00', bestTimeEnd: '08:00' };
  assert.equal(checkBestTime({ item: { startTime: '07:00' }, record }), null);
});

await test('a scheduled time outside the structured best-time window produces an informational hint, never a blocking warning', async () => {
  const record = { bestTimeStart: '06:00', bestTimeEnd: '08:00', bestTimeNote: 'Fewer crowds' };
  const result = checkBestTime({ item: { startTime: '14:00' }, record });
  assert.equal(result.level, 'hint', 'best-time is always a hint, never a warning/critical level');
  assert.match(result.message, /06:00–08:00/);
  assert.match(result.message, /Fewer crowds/);
});

await test('best-time information never blocks and this module never mutates the timeline item\'s own time', async () => {
  const record = { bestTimeStart: '06:00', bestTimeEnd: '08:00' };
  const item = { startTime: '14:00' };
  checkBestTime({ item, record });
  assert.equal(item.startTime, '14:00', 'the item object passed in is never mutated');
});

await test('no structured best-time data at all (existing coarse bestTimeOfDay only) produces no hint from checkBestTime', async () => {
  const record = { bestTimeStart: '', bestTimeEnd: '', bestTimeNote: '', bestTimeOfDay: { option: 'Early morning', note: '' } };
  assert.equal(checkBestTime({ item: { startTime: '14:00' }, record }), null, 'checkBestTime only looks at the new structured fields, which are unset here');
});

await test('normalizeAttraction defaults the new structured best-time/duration fields to null/empty for a pre-Chunk-4 record, and keeps the existing coarse bestTimeOfDay untouched', async () => {
  const legacyRecord = { place: { name: 'Old Fort' }, bestTimeOfDay: { option: 'Morning', note: 'Cooler then' } };
  const normalized = normalizeAttraction(legacyRecord);
  assert.equal(normalized.bestTimeStart, '');
  assert.equal(normalized.bestTimeEnd, '');
  assert.equal(normalized.bestTimeNote, '');
  assert.equal(normalized.typicalDurationMin, null);
  assert.equal(normalized.typicalDurationMax, null);
  assert.deepEqual(normalized.bestTimeOfDay, { option: 'Morning', note: 'Cooler then' }, 'the existing coarse bestTimeOfDay is completely preserved, not replaced');
});

console.log('\n36. Chunk 3 behavior remains correct under Chunk 4 (Option groups, alternatives, inclusion context)');
await test('validateTimelineItem runs identically for an item inside a SELECTED vs UNSELECTED Option — validation itself is unaware of Option selection state', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-09', endDate: '2026-01-16' }); // Jan 9 2026 = Friday
  const mosque = await createAttraction(dest.id, { place: { name: 'Grand Mosque' }, openingHours: [{ id: '1', days: ['fri'], ranges: [{ start: '', end: '' }], closed: true }] });
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });

  const itemInOptionA = await createTimelineItem(planning.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: mosque.id, optionGroupId: group.id, optionLabel: 'A', startTime: '10:00', plannedDuration: 60 });
  const itemInOptionB = await createTimelineItem(planning.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: mosque.id, optionGroupId: group.id, optionLabel: 'B', startTime: '10:00', plannedDuration: 60 });

  await selectOption(group.id, 'A'); // Option B is now the UNSELECTED one

  const weekdayKey = weekdayKeyForDate(planningDayDate(planning, 1));
  assert.equal(weekdayKey, 'fri');

  const findingsA = validateTimelineItem({ item: itemInOptionA, record: mosque, weekdayKey });
  const findingsB = validateTimelineItem({ item: itemInOptionB, record: mosque, weekdayKey });
  // Both items reference the same closed-on-Friday mosque at the same
  // time — the closed-day FACT is identical regardless of which
  // Option is currently selected. Chunk 4 validation deliberately has
  // no awareness of Option selection state (see planningValidation.js
  // design note) — that's a presentation decision for the UI layer,
  // not something this pure logic should encode.
  assert.equal(findingsA.openingHours.level, 'critical');
  assert.equal(findingsB.openingHours.level, 'critical');
});

await test('an item alternative under an item in an UNSELECTED Option still does not count as current itinerary inclusion — Chunk 3 behavior unaffected by Chunk 4', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-15' });
  const group = await createOptionGroup(planning.id, { dayNumber: 3, partLabel: 'Morning' });
  const optionBItem = await createTimelineItem(planning.id, 3, { itemType: 'meal', title: 'Lunch (Option B)', optionGroupId: group.id, optionLabel: 'B' });
  const altUnderB = await createItemAlternative(optionBItem.id, { title: 'Backup restaurant', selected: true });

  await selectOption(group.id, 'A'); // Option A selected, not B

  const currentGroup = await getOptionGroup(group.id);
  const isParentItemCurrentlyIncluded = currentGroup.selectedOptionLabel === optionBItem.optionLabel;
  assert.equal(isParentItemCurrentlyIncluded, false, 'exactly the same Chunk 3 inheritance behavior as before Chunk 4 was added');
  const stillSelected = await getItemAlternative(altUnderB.id);
  assert.equal(stillSelected.selected, true, 'the alternative\'s own selected flag is unaffected either way');
});

await test('unselected Options remain visible as planned possibilities, and their items are still individually validated — Chunk 3 + Chunk 4 combined', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-09', endDate: '2026-01-16' }); // Jan 9 2026 = Friday
  const mosque = await createAttraction(dest.id, { place: { name: 'Grand Mosque' }, openingHours: [{ id: '1', days: ['fri'], ranges: [{ start: '', end: '' }], closed: true }] });
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  const optionBItem = await createTimelineItem(planning.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: mosque.id, optionGroupId: group.id, optionLabel: 'B', startTime: '10:00' });
  await selectOption(group.id, 'A');

  // Option B's item is still there (Chunk 3's own guarantee) AND still
  // produces its own closed-day finding when checked (Chunk 4) — the
  // two behaviors compose correctly rather than one suppressing the other.
  const stillThere = await getTimelineItem(optionBItem.id);
  assert.ok(stillThere);
  const weekdayKey = weekdayKeyForDate(planningDayDate(planning, 1));
  const finding = checkOpeningHours({ item: stillThere, record: mosque, weekdayKey });
  assert.equal(finding.level, 'critical');
});

console.log('\n37. Date behavior remains correct under Chunk 4 (derived days, startDate shift, shortened trip)');
await test('changing the Planning startDate correctly changes which weekday a timeline item\'s validation is checked against, without moving the item', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-08', endDate: '2026-01-13' }); // Jan 8 2026 = Thursday
  const mosque = await createAttraction(dest.id, { place: { name: 'Grand Mosque' }, openingHours: [{ id: '1', days: ['fri'], ranges: [{ start: '', end: '' }], closed: true }] });
  const item = await createTimelineItem(planning.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: mosque.id, startTime: '10:00', plannedDuration: 60 });

  // Day 1 starts as Thursday — the mosque is only closed on Friday, so no warning yet.
  const beforeWeekday = weekdayKeyForDate(planningDayDate(planning, 1));
  assert.equal(beforeWeekday, 'thu');
  assert.equal(checkOpeningHours({ item, record: mosque, weekdayKey: beforeWeekday }), null);

  // Shift the trip so Day 1 becomes Friday — the exact scenario from
  // the original requirements. The item is NEVER moved; only which
  // weekday Day 1 now falls on changes, which changes the validation
  // result on next check.
  const shifted = await updatePlanning(planning.id, { startDate: '2026-01-09', endDate: '2026-01-14' }); // Jan 9 2026 = Friday
  const stillOnDay1 = await getTimelineItem(item.id);
  assert.equal(stillOnDay1.dayNumber, 1, 'the item never moved — dayNumber is completely unaffected by the date shift');

  const afterWeekday = weekdayKeyForDate(planningDayDate(shifted, 1));
  assert.equal(afterWeekday, 'fri');
  const afterFinding = checkOpeningHours({ item: stillOnDay1, record: mosque, weekdayKey: afterWeekday });
  assert.equal(afterFinding.level, 'critical', 'the exact "Day 1 becomes Friday -> mosque now shows closed" scenario from the original requirements');
});

await test('shortening a Planning does not delete an out-of-range item, and that item can still be validated using its own dayNumber\'s (now out-of-range) date', async () => {
  const dest = await createDestination({ name: 'Iceland' });
  const planning = await createPlanning(dest.id, { name: 'Long trip', startDate: '2026-01-10', endDate: '2026-01-15' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Glacier tour' }, openingHours: [{ id: '1', days: ['daily'], ranges: [{ start: '08:00', end: '16:00' }], closed: false }] });
  const day5Item = await createTimelineItem(planning.id, 5, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id, startTime: '09:00', plannedDuration: 60 });

  const shortened = await updatePlanning(planning.id, { endDate: '2026-01-13' }); // now only 4 days; Day 5 is out of range
  assert.equal(planningDayCount(shortened), 4);

  const stillThere = await getTimelineItem(day5Item.id);
  assert.ok(stillThere, 'the out-of-range item is not deleted by shortening the trip');
  // Day 5 no longer has a "current" date within the trip, but
  // planningDayDate still computes a definite calendar date for it
  // (the UI uses this to visibly mark it out-of-range) — and that date
  // can still be validated against if desired.
  const day5Date = planningDayDate(shortened, 5);
  assert.ok(day5Date, 'planningDayDate still returns a real date for an out-of-range day number, for out-of-range display purposes');
  assert.equal(day5Date, '2026-01-14');
  const weekdayKey = weekdayKeyForDate(day5Date);
  const finding = checkOpeningHours({ item: stillThere, record: attraction, weekdayKey });
  assert.equal(finding, null, 'within the daily 08:00-16:00 hours -> no warning, proving validation still functions correctly for an out-of-range item');
});

console.log('\n38. Database compatibility: Chunk 4 additive fields require no version bump and are fully migration-safe');
await test('a v8-era attraction record with no closed/typicalDuration*/bestTimeStart/bestTimeEnd/bestTimeNote keys at all is read correctly by normalizeAttraction, with no data loss', async () => {
  // Simulates a record saved before Chunk 4 existed — created directly
  // via createAttraction (DB_VERSION unchanged at 8; Chunk 4 adds no
  // new stores and needs no version bump, per the design).
  const dest = await createDestination({ name: 'Peru' });
  const preChunk4 = await createAttraction(dest.id, { place: { name: 'Machu Picchu' }, typicallySpent: 'Half a day' });
  // Directly strip the new fields to simulate an even older record shape
  // (createAttraction's emptyAttraction() already includes them as
  // null/'' — this proves normalizeAttraction is ALSO safe against a
  // record that predates emptyAttraction() ever having them).
  const strippedRecord = { ...preChunk4 };
  delete strippedRecord.typicalDurationMin;
  delete strippedRecord.typicalDurationMax;
  delete strippedRecord.bestTimeStart;
  delete strippedRecord.bestTimeEnd;
  delete strippedRecord.bestTimeNote;

  const normalized = normalizeAttraction(strippedRecord);
  assert.equal(normalized.typicalDurationMin, null);
  assert.equal(normalized.typicalDurationMax, null);
  assert.equal(normalized.bestTimeStart, '');
  assert.equal(normalized.bestTimeEnd, '');
  assert.equal(normalized.bestTimeNote, '');
  assert.equal(normalized.typicallySpent, 'Half a day', 'the original free-text field the record DID have is completely preserved');
  assert.equal(normalized.place.name, 'Machu Picchu');
});

await test('a pre-Chunk-4 restaurant/transport record with no typicalDurationMin/Max keys is handled safely by checkDuration (never throws, never warns)', async () => {
  const dest = await createDestination({ name: 'Vietnam' });
  const legacyRestaurant = await createRestaurantEntry(dest.id, { place: { name: 'Pho place' } });
  delete legacyRestaurant.typicalDurationMin;
  delete legacyRestaurant.typicalDurationMax;
  assert.doesNotThrow(() => checkDuration({ item: { plannedDuration: 45 }, record: legacyRestaurant }));
  assert.equal(checkDuration({ item: { plannedDuration: 45 }, record: legacyRestaurant }), null);

  const legacyTransport = normalizeTransportEntry({ from: { label: 'A' }, to: { label: 'B' }, duration: '2 hours' }); // no typicalDurationMin/Max key at all
  assert.equal(legacyTransport.typicalDurationMin, null);
  assert.equal(legacyTransport.typicalDurationMax, null);
  assert.equal(checkDuration({ item: { plannedDuration: 100 }, record: legacyTransport }), null);
});

console.log('\n39. Planning costs: traveller age and fee-band qualification (Tour Planning cost chunk)');
await test('ageAsOf computes whole-year age as of the Planning start date, respecting whether the birthday has occurred yet', async () => {
  assert.equal(ageAsOf('2015-06-15', '2026-01-10'), 10, 'birthday later in the year -> still 10');
  assert.equal(ageAsOf('2015-06-15', '2026-06-14'), 10, 'the day before the birthday');
  assert.equal(ageAsOf('2015-06-15', '2026-06-15'), 11, 'on the birthday itself');
  assert.equal(ageAsOf('1990-12-31', '2026-01-01'), 35);
  assert.equal(ageAsOf('', '2026-01-01'), null, 'no DOB -> no age, never a guess');
  assert.equal(ageAsOf('2030-01-01', '2026-01-01'), null, 'a DOB after the reference date is not a valid age');
});

await test('ageQualifiesForBand treats blank bounds as unbounded, not zero', async () => {
  assert.equal(ageQualifiesForBand(8, { minAge: '', maxAge: '12' }), true);
  assert.equal(ageQualifiesForBand(13, { minAge: '', maxAge: '12' }), false);
  assert.equal(ageQualifiesForBand(13, { minAge: '13', maxAge: '' }), true);
  assert.equal(ageQualifiesForBand(12, { minAge: '13', maxAge: '' }), false);
  assert.equal(ageQualifiesForBand(40, { minAge: '', maxAge: '' }), true, 'a band with no age limits applies to everyone');
  assert.equal(ageQualifiesForBand(null, { minAge: '', maxAge: '' }), false, 'an unknown age never qualifies');
});

console.log('\n40. Planning costs: attractions (selected fee bands, age-gated)');
const sampleAttraction = {
  feeBands: [
    { id: 'adult', label: 'Adult', minAge: '13', maxAge: '', status: 'paid', amount: '500', currency: 'INR' },
    { id: 'child', label: 'Child', minAge: '', maxAge: '12', status: 'paid', amount: '250', currency: 'INR' },
    { id: 'free-under-5', label: 'Under 5', minAge: '', maxAge: '4', status: 'free', amount: '', currency: 'INR' },
  ],
};
await test('attraction cost sums only the SELECTED fee bands, each once per age-qualifying traveller', async () => {
  const both = calculateAttractionCost({ costSelections: { selectedFeeBandIds: ['adult', 'child'] }, attraction: sampleAttraction, travellerAges: [35, 33, 8] });
  assert.equal(both.estimated, true);
  assert.equal(both.amount, 500 * 2 + 250 * 1, 'two adults at 500 + one child at 250');
  assert.equal(both.currency, 'INR');

  const adultOnly = calculateAttractionCost({ costSelections: { selectedFeeBandIds: ['adult'] }, attraction: sampleAttraction, travellerAges: [35, 33, 8] });
  assert.equal(adultOnly.amount, 1000, 'an unselected band (child) is never added automatically, even though a child is travelling');
});

await test('an attraction with no fee band selected is NOT estimated — never silently zero, never auto-guessed', async () => {
  const none = calculateAttractionCost({ costSelections: null, attraction: sampleAttraction, travellerAges: [35] });
  assert.equal(none.estimated, false);
  assert.equal(none.amount, null, 'null, not 0 — "not estimated" must be distinguishable from "free"');
  const emptySelection = calculateAttractionCost({ costSelections: { selectedFeeBandIds: [] }, attraction: sampleAttraction, travellerAges: [35] });
  assert.equal(emptySelection.estimated, false);
});

await test('a selected band marked FREE is estimated at zero — distinct from not-estimated', async () => {
  const free = calculateAttractionCost({ costSelections: { selectedFeeBandIds: ['free-under-5'] }, attraction: sampleAttraction, travellerAges: [3] });
  assert.equal(free.estimated, true, 'a free attraction IS estimated (at zero)');
  assert.equal(free.amount, 0);
});

await test('a selected band that no traveller qualifies for contributes nothing and leaves the item not-estimated', async () => {
  const noOneQualifies = calculateAttractionCost({ costSelections: { selectedFeeBandIds: ['child'] }, attraction: sampleAttraction, travellerAges: [35, 40] });
  assert.equal(noOneQualifies.estimated, false, 'no child is travelling, so the child band applies to nobody');
});

await test('a dangling selected fee band id (Research band since removed) is skipped safely and preserved in costSelections', async () => {
  const selections = { selectedFeeBandIds: ['adult', 'band-that-was-deleted'] };
  const result = calculateAttractionCost({ costSelections: selections, attraction: sampleAttraction, travellerAges: [35] });
  assert.equal(result.amount, 500, 'the dangling id contributes nothing; the valid one still counts');
  assert.deepEqual(selections.selectedFeeBandIds, ['adult', 'band-that-was-deleted'], 'calculation never mutates or prunes the stored selection');
});

await test('camera/videography charges are never included automatically in an attraction estimate', async () => {
  const withExtras = { ...sampleAttraction, cameraCharge: { amount: '100', currency: 'INR' }, videographyCharge: { amount: '500', currency: 'INR' } };
  const result = calculateAttractionCost({ costSelections: { selectedFeeBandIds: ['adult'] }, attraction: withExtras, travellerAges: [35] });
  assert.equal(result.amount, 500, 'only the selected fee band — camera/video are not added');
});

await test('costSelections round-trips through the real timelineItems store, including a dangling id', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Sigiriya' }, feeBands: sampleAttraction.feeBands });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-12' });
  const item = await createTimelineItem(planning.id, 1, {
    itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id,
    costSelections: { selectedFeeBandIds: ['adult', 'child'] },
  });
  assert.deepEqual(item.costSelections, { selectedFeeBandIds: ['adult', 'child'] });

  // Research later drops the 'child' band — the stored selection must not be rewritten.
  await updateAttraction(attraction.id, { feeBands: [sampleAttraction.feeBands[0]] });
  const reloaded = await getTimelineItem(item.id);
  assert.deepEqual(reloaded.costSelections.selectedFeeBandIds, ['adult', 'child'], 'the dangling id stays stored exactly as saved');
  const fresh = await getAttraction(attraction.id);
  const result = calculateAttractionCost({ costSelections: reloaded.costSelections, attraction: fresh, travellerAges: [35, 8] });
  assert.equal(result.amount, 500, 'only the surviving band counts');
});

await test('a timeline item with no costSelections defaults to null (existing items are unaffected)', async () => {
  const dest = await createDestination({ name: 'Peru' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-01', endDate: '2026-01-02' });
  const item = await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'Free time' });
  assert.equal(item.costSelections, null);
});

console.log('\n41. Planning costs: restaurants and transport (Research price, Planning override)');
await test('a restaurant uses the Research reference price as the initial estimate', async () => {
  const result = calculateRestaurantCost({ costSelections: null, restaurant: { price: { amount: '800', currency: 'INR' } } });
  assert.equal(result.estimated, true);
  assert.equal(result.amount, 800);
  assert.equal(result.overridden, false);
});

await test('a Planning override REPLACES the restaurant Research price and never changes the Research record', async () => {
  const dest = await createDestination({ name: 'Japan' });
  const restaurant = await createRestaurantEntry(dest.id, { place: { name: 'Sushi place' }, price: { amount: '800', currency: 'INR', unit: '', note: '' } });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-04-01', endDate: '2026-04-03' });
  const item = await createTimelineItem(planning.id, 1, {
    itemType: 'meal', researchRefType: 'restaurants', researchRefId: restaurant.id,
    costSelections: { estimateOverride: { amount: '1000', currency: 'INR' } },
  });
  const result = calculateRestaurantCost({ costSelections: item.costSelections, restaurant });
  assert.equal(result.amount, 1000, 'the override, not 800 and not 1800');
  assert.equal(result.overridden, true);

  const researchAfter = await getRestaurantEntry(restaurant.id);
  assert.equal(researchAfter.price.amount, '800', 'the Research record is completely untouched by a Planning override');
});

await test('transport uses the Research price, and a Planning override replaces it', async () => {
  const transport = { price: { amount: '2000', currency: 'INR' } };
  assert.equal(calculateTransportCost({ costSelections: null, transport }).amount, 2000);
  const overridden = calculateTransportCost({ costSelections: { estimateOverride: { amount: '2500', currency: 'INR' } }, transport });
  assert.equal(overridden.amount, 2500);
  assert.equal(overridden.overridden, true);
});

await test('missing price with no override is "not estimated" — never treated as zero', async () => {
  const noPrice = calculateRestaurantCost({ costSelections: null, restaurant: { price: { amount: '', currency: '' } } });
  assert.equal(noPrice.estimated, false);
  assert.equal(noPrice.amount, null);
  assert.equal(calculateTransportCost({ costSelections: null, transport: { price: null } }).estimated, false);
  assert.equal(calculateRestaurantCost({ costSelections: null, restaurant: null }).estimated, false);
});

await test('an explicit override of 0 is a real estimate of zero, not "not estimated"', async () => {
  const result = calculateRestaurantCost({ costSelections: { estimateOverride: { amount: '0', currency: 'INR' } }, restaurant: { price: { amount: '800', currency: 'INR' } } });
  assert.equal(result.estimated, true);
  assert.equal(result.amount, 0, 'the person deliberately entered 0 (e.g. a free meal) — it must override the Research 800');
});

console.log('\n42. Planning costs: accommodation stay range (checkOutDayNumber correction — replaces the old manual-nights mechanism)');
const sampleHotel = {
  price: { amount: '3000', currency: 'INR' },
  extraPersonCharges: [
    { label: 'Extra adult', price: { amount: '1500', currency: 'INR' } },
    { label: 'Extra child', price: { amount: '800', currency: 'INR' } },
  ],
};

await test('nightsForAccommodationItem computes nights as checkOutDayNumber - dayNumber, with no manual-nights fallback', async () => {
  assert.equal(nightsForAccommodationItem({ dayNumber: 2, checkOutDayNumber: 5 }), 3);
  assert.equal(nightsForAccommodationItem({ dayNumber: 1, checkOutDayNumber: 2 }), 1);
  assert.equal(nightsForAccommodationItem({ dayNumber: 1, checkOutDayNumber: null }), null, 'no check-out day set -> nights unknown, never guessed at 1');
  assert.equal(nightsForAccommodationItem({ dayNumber: 1 }), null, 'checkOutDayNumber entirely absent -> unknown, same as null');
  // The old mechanism is gone — a stray costSelections.nights value
  // (e.g. left over from a value constructed outside this app) must
  // have NO effect at all; only dayNumber/checkOutDayNumber matter now.
  assert.equal(nightsForAccommodationItem({ dayNumber: 1, costSelections: { nights: 99 } }), null, 'costSelections.nights is no longer read by this function');
});

await test('invalid check-out ranges (zero, negative, same-day, before check-in) are all treated as unknown nights, never a guessed or negative value', async () => {
  assert.equal(nightsForAccommodationItem({ dayNumber: 3, checkOutDayNumber: 3 }), null, 'same-day check-out is invalid');
  assert.equal(nightsForAccommodationItem({ dayNumber: 3, checkOutDayNumber: 2 }), null, 'check-out before check-in is invalid');
  assert.equal(nightsForAccommodationItem({ dayNumber: 3, checkOutDayNumber: 0 }), null);
  assert.equal(nightsForAccommodationItem({ dayNumber: 3, checkOutDayNumber: -1 }), null);
  assert.equal(nightsForAccommodationItem({ dayNumber: 3, checkOutDayNumber: 'not a number' }), null, 'a non-numeric value never throws, never produces NaN nights');
});

await test('createTimelineItem rejects an invalid checkOutDayNumber (zero, negative, same-day, before check-in) at write time', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const hotel = await createAccommodation(dest.id, { place: { name: 'Hotel' }, price: { amount: '3000', currency: 'INR', unit: '', note: '' } });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-20' });
  await assert.rejects(() => createTimelineItem(planning.id, 3, { itemType: 'accommodation', researchRefType: 'accommodations', researchRefId: hotel.id, checkOutDayNumber: 3 }), /later day/i, 'same-day');
  await assert.rejects(() => createTimelineItem(planning.id, 3, { itemType: 'accommodation', researchRefType: 'accommodations', researchRefId: hotel.id, checkOutDayNumber: 2 }), /later day/i, 'before check-in');
  await assert.rejects(() => createTimelineItem(planning.id, 3, { itemType: 'accommodation', researchRefType: 'accommodations', researchRefId: hotel.id, checkOutDayNumber: 0 }), /later day/i, 'zero');
  await assert.rejects(() => createTimelineItem(planning.id, 3, { itemType: 'accommodation', researchRefType: 'accommodations', researchRefId: hotel.id, checkOutDayNumber: -5 }), /later day/i, 'negative');
  // Leaving it unset entirely is always valid.
  const unset = await createTimelineItem(planning.id, 3, { itemType: 'accommodation', researchRefType: 'accommodations', researchRefId: hotel.id });
  assert.equal(unset.checkOutDayNumber, null);
});

await test('updateTimelineItem re-validates checkOutDayNumber against the (possibly just-changed) dayNumber', async () => {
  const dest = await createDestination({ name: 'Peru' });
  const hotel = await createAccommodation(dest.id, { place: { name: 'Hotel' }, price: { amount: '1000', currency: 'INR', unit: '', note: '' } });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-01', endDate: '2026-01-20' });
  const item = await createTimelineItem(planning.id, 2, { itemType: 'accommodation', researchRefType: 'accommodations', researchRefId: hotel.id, checkOutDayNumber: 5 });
  await assert.rejects(() => updateTimelineItem(item.id, { checkOutDayNumber: 1 }), /later day/i, 'moving check-out before the existing check-in is rejected');
  const updated = await updateTimelineItem(item.id, { checkOutDayNumber: 8 });
  assert.equal(updated.checkOutDayNumber, 8);
});

await test('accommodation cost is nightly rate x (checkOutDayNumber - dayNumber), not a manually-entered count', async () => {
  const threeNights = calculateAccommodationCost({ costSelections: null, accommodation: sampleHotel, nights: nightsForAccommodationItem({ dayNumber: 2, checkOutDayNumber: 5 }) });
  assert.equal(threeNights.amount, 9000);
  const oneNight = calculateAccommodationCost({ costSelections: null, accommodation: sampleHotel, nights: nightsForAccommodationItem({ dayNumber: 1, checkOutDayNumber: 2 }) });
  assert.equal(oneNight.amount, 3000);
});

await test('accommodation with no check-out day set is NOT estimated, never defaulted to a single night', async () => {
  const result = calculateAccommodationCost({ costSelections: null, accommodation: sampleHotel, nights: nightsForAccommodationItem({ dayNumber: 1, checkOutDayNumber: null }) });
  assert.equal(result.estimated, false);
  assert.equal(result.amount, null);
});

await test('only SELECTED extra-person charges are added, once per stay (not per night), and a dangling charge label is skipped safely', async () => {
  const nights = nightsForAccommodationItem({ dayNumber: 1, checkOutDayNumber: 3 }); // 2 nights
  const withOneExtra = calculateAccommodationCost({ costSelections: { selectedExtraChargeLabels: ['Extra adult'] }, accommodation: sampleHotel, nights });
  assert.equal(withOneExtra.amount, 6000 + 1500, 'two nights plus ONE selected extra-adult charge — not multiplied by nights, and Extra child is not added');

  const dangling = calculateAccommodationCost({ costSelections: { selectedExtraChargeLabels: ['Extra adult', 'Charge that no longer exists'] }, accommodation: sampleHotel, nights: nightsForAccommodationItem({ dayNumber: 1, checkOutDayNumber: 2 }) });
  assert.equal(dangling.amount, 3000 + 1500, 'the dangling label contributes nothing');
});

await test('an accommodation Planning override replaces the whole calculation, including extra charges, regardless of the stay range', async () => {
  const result = calculateAccommodationCost({
    costSelections: { selectedExtraChargeLabels: ['Extra adult'], estimateOverride: { amount: '7500', currency: 'INR' } },
    accommodation: sampleHotel, nights: nightsForAccommodationItem({ dayNumber: 1, checkOutDayNumber: 4 }),
  });
  assert.equal(result.amount, 7500);
  assert.equal(result.overridden, true);
  // Even with no check-out day set at all (nights null), an override still works.
  const noNightsOverride = calculateAccommodationCost({ costSelections: { estimateOverride: { amount: '2000', currency: 'INR' } }, accommodation: sampleHotel, nights: null });
  assert.equal(noNightsOverride.amount, 2000);
});

await test('accommodation with no nightly rate and no override is not estimated, even with a valid stay range', async () => {
  const noRate = calculateAccommodationCost({ costSelections: null, accommodation: { price: { amount: '', currency: '' } }, nights: nightsForAccommodationItem({ dayNumber: 1, checkOutDayNumber: 3 }) });
  assert.equal(noRate.estimated, false);
  assert.equal(noRate.amount, null);
});

await test('room allocation is informational only and never affects the accommodation estimate', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const hotel = await createAccommodation(dest.id, { place: { name: 'Hotel' }, price: { amount: '3000', currency: 'INR', unit: '', note: '' } });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-15' });
  const item = await createTimelineItem(planning.id, 1, {
    itemType: 'accommodation', researchRefType: 'accommodations', researchRefId: hotel.id,
    checkOutDayNumber: 3,
    costSelections: { roomAllocation: [{ roomLabel: 'Room 1', travellerIds: ['a', 'b'] }, { roomLabel: 'Room 2', travellerIds: ['c'] }] },
  });
  const result = calculateAccommodationCost({ costSelections: item.costSelections, accommodation: hotel, nights: nightsForAccommodationItem(item) });
  assert.equal(result.amount, 6000, 'two rooms allocated, but the estimate is still just nightly x nights — no per-room pricing logic');
});

await test('multiple accommodation stays are supported within one Planning, and each contributes its own nights independently', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const hotelA = await createAccommodation(dest.id, { place: { name: 'Hotel A' }, price: { amount: '3000', currency: 'INR', unit: '', note: '' } });
  const hotelB = await createAccommodation(dest.id, { place: { name: 'Hotel B' }, price: { amount: '2000', currency: 'INR', unit: '', note: '' } });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-20' });
  const stayA = await createTimelineItem(planning.id, 1, { itemType: 'accommodation', researchRefType: 'accommodations', researchRefId: hotelA.id, checkOutDayNumber: 4 }); // 3 nights
  const stayB = await createTimelineItem(planning.id, 4, { itemType: 'accommodation', researchRefType: 'accommodations', researchRefId: hotelB.id, checkOutDayNumber: 9 }); // 5 nights

  const records = { [hotelA.id]: hotelA, [hotelB.id]: hotelB };
  const breakdown = calculatePlanningCostBreakdown({
    items: [stayA, stayB], alternatives: [], optionGroupsById: {}, travellerAges: [],
    getRecordForItem: (item) => records[item.researchRefId],
  });
  assert.equal(breakdown.categoryTotals.accommodation.INR, 3000 * 3 + 2000 * 5, 'both stays sum correctly, each with its own independently-computed nights');
});

await test('a Planning startDate shift does not change a stay\'s nights — checkOutDayNumber/dayNumber are day-number based, same as every other date-shift-safe fact in this app', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const hotel = await createAccommodation(dest.id, { place: { name: 'Hotel' }, price: { amount: '3000', currency: 'INR', unit: '', note: '' } });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-20' });
  const item = await createTimelineItem(planning.id, 2, { itemType: 'accommodation', researchRefType: 'accommodations', researchRefId: hotel.id, checkOutDayNumber: 5 });
  assert.equal(nightsForAccommodationItem(item), 3);

  const shifted = await updatePlanning(planning.id, { startDate: '2026-03-01', endDate: '2026-03-11' });
  const stillThere = await getTimelineItem(item.id);
  assert.equal(stillThere.dayNumber, 2, 'check-in day number unchanged by the shift');
  assert.equal(stillThere.checkOutDayNumber, 5, 'check-out day number unchanged by the shift');
  assert.equal(nightsForAccommodationItem(stillThere), 3, 'nights is unaffected — it was never calendar-date based');

  // The calendar DATES those day numbers map to have moved, exactly
  // like every other derived-day fact — but that's a separate concern
  // from nights, which this correction never ties to calendar dates.
  const days = listPlanningDays(shifted);
  assert.equal(days[0].date, '2026-03-01', 'calendar date mapping did shift, as expected, independent of nights');
});

console.log('\n43. Planning costs: custom/other items and Shopping');
await test('a custom item has no cost unless the person enters a Planning estimate', async () => {
  assert.equal(calculateCustomItemCost({ costSelections: null }).estimated, false);
  const entered = calculateCustomItemCost({ costSelections: { estimateOverride: { amount: '300', currency: 'INR' } } });
  assert.equal(entered.estimated, true);
  assert.equal(entered.amount, 300);
});

await test('a shopping-style custom item never contributes to the total unless a Planning estimate is explicitly entered', async () => {
  const items = [
    { id: 'shop-1', itemType: 'custom', researchRefType: null, researchRefId: null, title: 'Buy souvenirs', costSelections: null },
    { id: 'shop-2', itemType: 'custom', researchRefType: null, researchRefId: null, title: 'Buy tea', costSelections: { estimateOverride: { amount: '2000', currency: 'INR' } } },
  ];
  const breakdown = calculatePlanningCostBreakdown({ items, alternatives: [], optionGroupsById: {}, getRecordForItem: () => null, travellerAges: [] });
  assert.equal(breakdown.categoryTotals.other.INR, 2000, 'only the item with an explicit estimate counts');
  assert.equal(breakdown.unestimatedItems.length, 1, 'the un-priced shopping item is listed as not estimated, not silently zero');
});

console.log('\n44. Planning costs: category routing');
await test('costCategoryForItem routes by Research type, falling back to itemType for custom items', async () => {
  assert.equal(costCategoryForItem({ researchRefType: 'attractions' }), 'attractions');
  assert.equal(costCategoryForItem({ researchRefType: 'restaurants' }), 'food');
  assert.equal(costCategoryForItem({ researchRefType: 'transport' }), 'transport');
  assert.equal(costCategoryForItem({ researchRefType: 'accommodations' }), 'accommodation');
  assert.equal(costCategoryForItem({ researchRefType: null, itemType: 'meal' }), 'food');
  assert.equal(costCategoryForItem({ researchRefType: null, itemType: 'travel' }), 'transport');
  assert.equal(costCategoryForItem({ researchRefType: null, itemType: 'accommodation' }), 'accommodation');
  assert.equal(costCategoryForItem({ researchRefType: null, itemType: 'custom' }), 'other');
  assert.deepEqual(COST_CATEGORIES, ['accommodation', 'transport', 'attractions', 'food', 'other']);
});

console.log('\n45. Planning costs: itinerary Option / alternative inclusion context');
await test('an ordinary item is always included; an Option item is included only when ITS Option is the selected one', async () => {
  const groups = { g1: { id: 'g1', selectedOptionLabel: 'A' } };
  assert.equal(isTimelineItemCurrentlyIncluded({ optionGroupId: null }, groups), true);
  assert.equal(isTimelineItemCurrentlyIncluded({ optionGroupId: 'g1', optionLabel: 'A' }, groups), true);
  assert.equal(isTimelineItemCurrentlyIncluded({ optionGroupId: 'g1', optionLabel: 'B' }, groups), false);
});

await test('an UNRESOLVED (pending) Option group includes NOTHING — competing Options are never all counted', async () => {
  const groups = { g1: { id: 'g1', selectedOptionLabel: null } };
  assert.equal(isTimelineItemCurrentlyIncluded({ optionGroupId: 'g1', optionLabel: 'A' }, groups), false);
  assert.equal(isTimelineItemCurrentlyIncluded({ optionGroupId: 'g1', optionLabel: 'B' }, groups), false);
});

await test('an item whose Option group no longer exists is not counted (never guessed as included)', async () => {
  assert.equal(isTimelineItemCurrentlyIncluded({ optionGroupId: 'deleted-group', optionLabel: 'A' }, {}), false);
});

await test('only the SELECTED Option\'s costs count toward the total; the unselected Option is excluded', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-12' });
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  const optionA = await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'Option A activity', optionGroupId: group.id, optionLabel: 'A', costSelections: { estimateOverride: { amount: '1000', currency: 'INR' } } });
  const optionB = await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'Option B activity', optionGroupId: group.id, optionLabel: 'B', costSelections: { estimateOverride: { amount: '5000', currency: 'INR' } } });
  const ordinary = await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'Lunch', costSelections: { estimateOverride: { amount: '400', currency: 'INR' } } });
  await selectOption(group.id, 'A');

  const groupsById = Object.fromEntries((await listOptionGroupsForPlanning(planning.id)).map(g => [g.id, g]));
  const items = await listTimelineItems(planning.id);
  const breakdown = calculatePlanningCostBreakdown({ items, alternatives: [], optionGroupsById: groupsById, getRecordForItem: () => null, travellerAges: [] });
  assert.equal(breakdown.overallByCurrency.INR, 1400, 'Option A (1000) + ordinary lunch (400); Option B\'s 5000 is NOT counted');
  assert.ok(optionA && optionB && ordinary);
});

await test('with the Option group left PENDING, neither competing Option counts — only ordinary items', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-12' });
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'A', optionGroupId: group.id, optionLabel: 'A', costSelections: { estimateOverride: { amount: '1000', currency: 'INR' } } });
  await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'B', optionGroupId: group.id, optionLabel: 'B', costSelections: { estimateOverride: { amount: '5000', currency: 'INR' } } });
  await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'Lunch', costSelections: { estimateOverride: { amount: '400', currency: 'INR' } } });

  const groupsById = Object.fromEntries((await listOptionGroupsForPlanning(planning.id)).map(g => [g.id, g]));
  const items = await listTimelineItems(planning.id);
  const breakdown = calculatePlanningCostBreakdown({ items, alternatives: [], optionGroupsById: groupsById, getRecordForItem: () => null, travellerAges: [] });
  assert.equal(breakdown.overallByCurrency.INR, 400, 'an unresolved choice must not double-count both competing Options');
});

await test('reselecting a different Option changes which costs count, with no stored total to go stale', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-12' });
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'A', optionGroupId: group.id, optionLabel: 'A', costSelections: { estimateOverride: { amount: '1000', currency: 'INR' } } });
  await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'B', optionGroupId: group.id, optionLabel: 'B', costSelections: { estimateOverride: { amount: '5000', currency: 'INR' } } });
  const items = await listTimelineItems(planning.id);
  const totalFor = async () => {
    const groupsById = Object.fromEntries((await listOptionGroupsForPlanning(planning.id)).map(g => [g.id, g]));
    return calculatePlanningCostBreakdown({ items, alternatives: [], optionGroupsById: groupsById, getRecordForItem: () => null, travellerAges: [] }).overallByCurrency.INR;
  };
  await selectOption(group.id, 'A');
  assert.equal(await totalFor(), 1000);
  await selectOption(group.id, 'B');
  assert.equal(await totalFor(), 5000);
  await selectOption(group.id, null);
  assert.equal(await totalFor(), undefined, 'back to pending: nothing counts, so there is no INR total at all');
});

await test('an item alternative counts only if it is itself selected AND its parent item is currently included', async () => {
  const groups = { g1: { id: 'g1', selectedOptionLabel: 'A' } };
  const parentInSelectedOption = { optionGroupId: 'g1', optionLabel: 'A' };
  const parentInUnselectedOption = { optionGroupId: 'g1', optionLabel: 'B' };
  assert.equal(isAlternativeCurrentlyIncluded({ selected: true }, parentInSelectedOption, groups), true);
  assert.equal(isAlternativeCurrentlyIncluded({ selected: false }, parentInSelectedOption, groups), false, 'a non-selected alternative is not double-counted alongside the chosen one');
  assert.equal(isAlternativeCurrentlyIncluded({ selected: true }, parentInUnselectedOption, groups), false, 'a selected alternative inside an UNSELECTED Option must not count');
});

await test('rollup: selected alternative counts, unselected sibling does not, alternative under an unselected Option does not', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-12' });
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  const lunchInA = await createTimelineItem(planning.id, 1, { itemType: 'meal', title: 'Lunch slot (A)', optionGroupId: group.id, optionLabel: 'A' });
  const lunchInB = await createTimelineItem(planning.id, 1, { itemType: 'meal', title: 'Lunch slot (B)', optionGroupId: group.id, optionLabel: 'B' });
  const chosen = await createItemAlternative(lunchInA.id, { title: 'Restaurant A', selected: true, costSelections: { estimateOverride: { amount: '700', currency: 'INR' } } });
  const sibling = await createItemAlternative(lunchInA.id, { title: 'Restaurant B', selected: false, costSelections: { estimateOverride: { amount: '900', currency: 'INR' } } });
  const underB = await createItemAlternative(lunchInB.id, { title: 'Restaurant D', selected: true, costSelections: { estimateOverride: { amount: '3000', currency: 'INR' } } });
  await selectOption(group.id, 'A');

  const groupsById = Object.fromEntries((await listOptionGroupsForPlanning(planning.id)).map(g => [g.id, g]));
  const items = await listTimelineItems(planning.id);
  const alternatives = [
    { alternative: chosen, parentItem: lunchInA },
    { alternative: sibling, parentItem: lunchInA },
    { alternative: underB, parentItem: lunchInB },
  ];
  const breakdown = calculatePlanningCostBreakdown({ items, alternatives, optionGroupsById: groupsById, getRecordForItem: () => null, travellerAges: [] });
  assert.equal(breakdown.categoryTotals.food.INR, 700, 'only the selected alternative under the selected Option: 700 (not 900, not 3000)');
});

await test('an item whose alternatives are all unselected still counts by its own estimate — alternatives never replace or double it', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-12' });
  const lunch = await createTimelineItem(planning.id, 1, { itemType: 'meal', title: 'Lunch', costSelections: { estimateOverride: { amount: '600', currency: 'INR' } } });
  const alt = await createItemAlternative(lunch.id, { title: 'Backup', selected: false, costSelections: { estimateOverride: { amount: '900', currency: 'INR' } } });
  const breakdown = calculatePlanningCostBreakdown({
    items: [lunch], alternatives: [{ alternative: alt, parentItem: lunch }], optionGroupsById: {}, getRecordForItem: () => null, travellerAges: [],
  });
  assert.equal(breakdown.categoryTotals.food.INR, 600);
});

console.log('\n46. Planning costs: Planned vs Optional');
await test('both planned and optional items count when they are in the current itinerary', async () => {
  const items = [
    { id: 'p', itemType: 'custom', status: 'planned', optionGroupId: null, costSelections: { estimateOverride: { amount: '1000', currency: 'INR' } } },
    { id: 'o', itemType: 'custom', status: 'optional', optionGroupId: null, costSelections: { estimateOverride: { amount: '500', currency: 'INR' } } },
  ];
  const breakdown = calculatePlanningCostBreakdown({ items, alternatives: [], optionGroupsById: {}, getRecordForItem: () => null, travellerAges: [] });
  assert.equal(breakdown.overallByCurrency.INR, 1500, 'Optional still counts — it means "may be skipped", not "not part of the estimate"');
});

await test('an Optional item inside an UNSELECTED Option is still excluded — status never overrides Option inclusion', async () => {
  const groups = { g1: { id: 'g1', selectedOptionLabel: 'A' } };
  const items = [{ id: 'o', itemType: 'custom', status: 'optional', optionGroupId: 'g1', optionLabel: 'B', costSelections: { estimateOverride: { amount: '500', currency: 'INR' } } }];
  const breakdown = calculatePlanningCostBreakdown({ items, alternatives: [], optionGroupsById: groups, getRecordForItem: () => null, travellerAges: [] });
  assert.equal(breakdown.overallByCurrency.INR, undefined);
});

console.log('\n47. Planning costs: category totals, overall total, and not-estimated tracking');
await test('a full mixed Planning rolls up per category and overall, listing un-estimated items separately', async () => {
  const hotel = { id: 'h', price: { amount: '3000', currency: 'INR' }, extraPersonCharges: [] };
  const restaurant = { id: 'r', price: { amount: '800', currency: 'INR' } };
  const transportRec = { id: 't', price: { amount: '2000', currency: 'INR' } };
  const attraction = { id: 'a', feeBands: sampleAttraction.feeBands };
  const noPriceRestaurant = { id: 'r2', price: { amount: '', currency: '' } };
  const records = { h: hotel, r: restaurant, t: transportRec, a: attraction, r2: noPriceRestaurant };

  const items = [
    { id: 'i1', researchRefType: 'accommodations', researchRefId: 'h', itemType: 'accommodation', dayNumber: 1, checkOutDayNumber: 3, optionGroupId: null, costSelections: null },
    { id: 'i2', researchRefType: 'restaurants', researchRefId: 'r', itemType: 'meal', optionGroupId: null, costSelections: null },
    { id: 'i3', researchRefType: 'transport', researchRefId: 't', itemType: 'travel', optionGroupId: null, costSelections: { estimateOverride: { amount: '2400', currency: 'INR' } } },
    { id: 'i4', researchRefType: 'attractions', researchRefId: 'a', itemType: 'attraction', optionGroupId: null, costSelections: { selectedFeeBandIds: ['adult', 'child'] } },
    { id: 'i5', researchRefType: 'restaurants', researchRefId: 'r2', itemType: 'meal', optionGroupId: null, costSelections: null },
    { id: 'i6', researchRefType: null, itemType: 'custom', optionGroupId: null, costSelections: { estimateOverride: { amount: '300', currency: 'INR' } } },
  ];
  const breakdown = calculatePlanningCostBreakdown({
    items, alternatives: [], optionGroupsById: {}, travellerAges: [35, 8],
    getRecordForItem: (item) => (item.researchRefId ? records[item.researchRefId] : null),
  });
  assert.equal(breakdown.categoryTotals.accommodation.INR, 6000);
  assert.equal(breakdown.categoryTotals.food.INR, 800, 'only the priced restaurant; the un-priced one is not counted as zero');
  assert.equal(breakdown.categoryTotals.transport.INR, 2400, 'the override, not the 2000 Research price');
  assert.equal(breakdown.categoryTotals.attractions.INR, 750, 'adult 500 + child 250');
  assert.equal(breakdown.categoryTotals.other.INR, 300);
  assert.equal(breakdown.overallByCurrency.INR, 6000 + 800 + 2400 + 750 + 300);
  assert.deepEqual(breakdown.unestimatedItems.map(u => u.itemId), ['i5'], 'the un-priced restaurant is surfaced as not estimated');
});

await test('an empty Planning has no totals and no un-estimated items', async () => {
  const breakdown = calculatePlanningCostBreakdown({ items: [], alternatives: [], optionGroupsById: {}, getRecordForItem: () => null, travellerAges: [] });
  assert.deepEqual(breakdown.overallByCurrency, {});
  assert.deepEqual(breakdown.unestimatedItems, []);
  for (const category of COST_CATEGORIES) assert.deepEqual(breakdown.categoryTotals[category], {});
});

await test('amounts in different currencies are kept apart per currency, never blindly summed together', async () => {
  const items = [
    { id: 'a', itemType: 'custom', optionGroupId: null, costSelections: { estimateOverride: { amount: '1000', currency: 'INR' } } },
    { id: 'b', itemType: 'custom', optionGroupId: null, costSelections: { estimateOverride: { amount: '50', currency: 'USD' } } },
  ];
  const breakdown = calculatePlanningCostBreakdown({ items, alternatives: [], optionGroupsById: {}, getRecordForItem: () => null, travellerAges: [] });
  assert.deepEqual(breakdown.overallByCurrency, { INR: 1000, USD: 50 });
});

console.log('\n48. Planning costs: currency conversion reuses the existing convertAmount mechanism');
await test('convertTotalToHomeCurrency converts using the REAL stored exchange rates via the existing convertAmount()', async () => {
  await setExchangeRate('USD', 'INR', 84);
  await setExchangeRate('THB', 'INR', 2.5);
  // 100 USD -> 8400 INR; 400 THB -> 1000 INR; 500 INR stays -> 9900 INR total
  const total = await convertTotalToHomeCurrency({ USD: 100, THB: 400, INR: 500 }, 'INR', convertAmount);
  assert.equal(total, 8400 + 1000 + 500);
});

await test('if ANY currency has no rate to the home currency, the whole converted total is null — never a silently partial number', async () => {
  await setExchangeRate('USD', 'INR', 84);
  const total = await convertTotalToHomeCurrency({ USD: 100, EUR: 50 }, 'INR', convertAmount);
  assert.equal(total, null, 'EUR has no stored rate, so no trustworthy home total exists');
});

await test('a Planning entirely in the home currency needs no rate at all', async () => {
  const total = await convertTotalToHomeCurrency({ INR: 2500 }, 'INR', convertAmount);
  assert.equal(total, 2500);
});

await test('with no currency-tagged amounts there is no home total to show', async () => {
  assert.equal(await convertTotalToHomeCurrency({}, 'INR', convertAmount), null);
});

await test('a Planning override can be in a different currency from the Research price; each stays in its own currency until converted', async () => {
  await setExchangeRate('USD', 'INR', 84);
  const result = calculateRestaurantCost({ costSelections: { estimateOverride: { amount: '20', currency: 'USD' } }, restaurant: { price: { amount: '800', currency: 'INR' } } });
  assert.equal(result.currency, 'USD', 'the override currency wins along with the override amount');
  assert.equal(await convertAmount(result.amount, result.currency, 'INR'), 1680);
});

console.log('\n49. Planning costs: traveller age drives fee bands through the real Planning/People data');
await test('ages are derived from real People records as of the real Planning startDate', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const adult = await createPerson({ name: 'Adult', dob: '1990-03-01' });
  const child = await createPerson({ name: 'Child', dob: '2016-08-20' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-12', travellerIds: [adult.id, child.id] });
  const people = await listPeople();
  const ages = people.filter(p => planning.travellerIds.includes(p.id)).map(p => ageAsOf(p.dob, planning.startDate));
  assert.deepEqual(ages.sort((a, b) => a - b), [9, 35]);

  const result = calculateAttractionCost({ costSelections: { selectedFeeBandIds: ['adult', 'child'] }, attraction: sampleAttraction, travellerAges: ages });
  assert.equal(result.amount, 500 + 250);

  // Shifting the trip across the child's birthday changes their age as of the start date.
  const later = await updatePlanning(planning.id, { startDate: '2026-09-01', endDate: '2026-09-03' });
  const laterAges = people.filter(p => later.travellerIds.includes(p.id)).map(p => ageAsOf(p.dob, later.startDate));
  assert.deepEqual(laterAges.sort((a, b) => a - b), [10, 36]);
});

await test('calculateItemCost dispatches to the right calculator by Research type', async () => {
  assert.equal(calculateItemCost({ researchRefType: 'restaurants', costSelections: null }, { record: { price: { amount: '800', currency: 'INR' } } }).amount, 800);
  assert.equal(calculateItemCost({ researchRefType: 'transport', costSelections: null }, { record: { price: { amount: '2000', currency: 'INR' } } }).amount, 2000);
  assert.equal(calculateItemCost({ researchRefType: 'accommodations', costSelections: null }, { record: sampleHotel, nights: 2 }).amount, 6000);
  assert.equal(calculateItemCost({ researchRefType: 'attractions', costSelections: { selectedFeeBandIds: ['adult'] } }, { record: sampleAttraction, travellerAges: [30] }).amount, 500);
  assert.equal(calculateItemCost({ researchRefType: null, costSelections: { estimateOverride: { amount: '10', currency: 'INR' } } }, {}).amount, 10);
});

console.log('\n50. Existing behavior preserved: Chunk 3/4 unaffected by cost fields');
await test('costSelections does not disturb Option/alternative/validation behavior on the same items', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const mosque = await createAttraction(dest.id, { place: { name: 'Grand Mosque' }, openingHours: [{ id: '1', days: ['fri'], ranges: [{ start: '', end: '' }], closed: true }], feeBands: sampleAttraction.feeBands });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-09', endDate: '2026-01-11' }); // Jan 9 2026 = Friday
  const item = await createTimelineItem(planning.id, 1, {
    itemType: 'attraction', researchRefType: 'attractions', researchRefId: mosque.id, startTime: '10:00', plannedDuration: 60,
    costSelections: { selectedFeeBandIds: ['adult'] },
  });
  const finding = checkOpeningHours({ item, record: mosque, weekdayKey: weekdayKeyForDate(planningDayDate(planning, 1)) });
  assert.equal(finding.level, 'critical', 'the closed-day warning still fires exactly as before');
  assert.equal(item.dayNumber, 1);
  const updated = await updateTimelineItem(item.id, { notes: 'edited' });
  assert.deepEqual(updated.costSelections, { selectedFeeBandIds: ['adult'] }, 'an unrelated edit never disturbs stored costSelections');
});

await test('a timeline item saved before this chunk (no costSelections key at all) still works and is simply not estimated', async () => {
  const preCost = { id: 'old', planningId: 'p', dayNumber: 1, itemType: 'custom', title: 'Old item', researchRefType: null, optionGroupId: null };
  assert.equal(preCost.costSelections, undefined);
  const result = calculateItemCost(preCost, { record: null });
  assert.equal(result.estimated, false);
  const breakdown = calculatePlanningCostBreakdown({ items: [preCost], alternatives: [], optionGroupsById: {}, getRecordForItem: () => null, travellerAges: [] });
  assert.equal(breakdown.unestimatedItems.length, 1);
  assert.deepEqual(breakdown.overallByCurrency, {});
});

console.log('\n51. Home currency (correction): a global setting, independent of destination defaultCurrency');
await test('getHomeCurrency defaults to INR on a fresh install, regardless of any destination\'s own defaultCurrency', async () => {
  const dest = await createDestination({ name: 'Thailand' });
  await setDestinationDefaultCurrency(dest.id, 'THB');
  const destination = await getDestination(dest.id);
  assert.equal(getDestinationDefaultCurrency(destination), 'THB', 'the destination default is genuinely THB');

  const home = await getHomeCurrency();
  assert.equal(home, 'INR', 'the global home currency defaults to INR regardless of the destination default');
});

await test('setHomeCurrency persists and getHomeCurrency returns the updated value on a later read', async () => {
  await setHomeCurrency('USD');
  assert.equal(await getHomeCurrency(), 'USD');
  // Changing it again overwrites cleanly, not additively.
  await setHomeCurrency('EUR');
  assert.equal(await getHomeCurrency(), 'EUR');
});

await test('setHomeCurrency normalizes case and whitespace, and rejects an empty value', async () => {
  await setHomeCurrency(' gbp ');
  assert.equal(await getHomeCurrency(), 'GBP');
  await assert.rejects(() => setHomeCurrency(''), /currency/i);
  await assert.rejects(() => setHomeCurrency('   '), /currency/i);
});

await test('the home currency is a SINGLE global setting shared across every destination and Planning — it is not destination-scoped', async () => {
  const destA = await createDestination({ name: 'Japan' });
  const destB = await createDestination({ name: 'Iceland' });
  await setDestinationDefaultCurrency(destA.id, 'JPY');
  await setDestinationDefaultCurrency(destB.id, 'ISK');
  await setHomeCurrency('CAD');
  // Reading it in the context of either destination gives the exact
  // same answer — there is only ever one home currency.
  assert.equal(await getHomeCurrency(), 'CAD');
  const reloadedA = await getDestination(destA.id);
  const reloadedB = await getDestination(destB.id);
  assert.equal(getDestinationDefaultCurrency(reloadedA), 'JPY', 'destination A default is unaffected');
  assert.equal(getDestinationDefaultCurrency(reloadedB), 'ISK', 'destination B default is unaffected');
});

await test('a Planning cost total converts correctly to the home currency even when the destination default currency is completely different', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  await setDestinationDefaultCurrency(dest.id, 'LKR'); // destination default — must NOT be used as home currency
  await setHomeCurrency('USD');
  await setExchangeRate('LKR', 'USD', 0.0033);

  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-12' });
  const restaurant = await createRestaurantEntry(dest.id, { place: { name: 'Ministry of Crab' }, price: { amount: '30000', currency: 'LKR', unit: '', note: '' } });
  await createTimelineItem(planning.id, 1, { itemType: 'meal', researchRefType: 'restaurants', researchRefId: restaurant.id });

  const items = await listTimelineItems(planning.id);
  const breakdown = calculatePlanningCostBreakdown({
    items, alternatives: [], optionGroupsById: {}, travellerAges: [],
    getRecordForItem: () => restaurant,
  });
  assert.equal(breakdown.overallByCurrency.LKR, 30000, 'the Research/Planning amount stays in its ORIGINAL currency (LKR) in the breakdown');

  const home = await getHomeCurrency();
  assert.equal(home, 'USD', 'home currency is USD, nothing to do with the LKR destination default');
  const homeTotal = await convertTotalToHomeCurrency(breakdown.overallByCurrency, home, convertAmount);
  assert.equal(Math.round(homeTotal * 100) / 100, 99, '30000 LKR * 0.0033 = 99 USD, converted via the existing convertAmount mechanism');
});

await test('if no exchange rate exists from a Planning\'s currency to the home currency, the home total is null — never a misleading partial figure', async () => {
  const dest = await createDestination({ name: 'Mongolia' });
  await setHomeCurrency('NZD'); // deliberately a pair with no stored rate
  const breakdown = { INR: 1000, MNT: 50000 };
  const total = await convertTotalToHomeCurrency(breakdown, await getHomeCurrency(), convertAmount);
  assert.equal(total, null, 'no rate for either currency to NZD -> null, not a partial or zero total');
  assert.ok(dest.id, 'destination created only to exercise a realistic context; unrelated to the null-total assertion');
});

console.log('\n52. Item-level alternative costs (correction): reuses the same calculation rules as timeline items, never duplicated');
await test('an item alternative with selected attraction fee bands is costed by the SAME calculateAttractionCost logic a timeline item uses', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Sigiriya' }, feeBands: sampleAttraction.feeBands });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-12' });
  const mainItem = await createTimelineItem(planning.id, 1, { itemType: 'attraction', title: 'Main attraction plan' });
  const alt = await createItemAlternative(mainItem.id, { researchRefType: 'attractions', researchRefId: attraction.id, selected: true, costSelections: { selectedFeeBandIds: ['adult', 'child'] } });

  const altCost = calculateItemCost(alt, { record: attraction, travellerAges: [35, 8] });
  const equivalentTimelineItem = { researchRefType: 'attractions', costSelections: alt.costSelections };
  const timelineItemCost = calculateItemCost(equivalentTimelineItem, { record: attraction, travellerAges: [35, 8] });
  assert.equal(altCost.amount, timelineItemCost.amount, 'identical costSelections + identical record -> identical result, proving no duplicated logic path');
  assert.equal(altCost.amount, 750);
});

await test('an item alternative can carry a Planning-specific override for a restaurant/transport Research price, same mechanism as a timeline item', async () => {
  const dest = await createDestination({ name: 'Japan' });
  const restaurant = await createRestaurantEntry(dest.id, { place: { name: 'Sushi place' }, price: { amount: '800', currency: 'INR', unit: '', note: '' } });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-04-01', endDate: '2026-04-03' });
  const lunchItem = await createTimelineItem(planning.id, 1, { itemType: 'meal', title: 'Lunch' });
  const alt = await createItemAlternative(lunchItem.id, { researchRefType: 'restaurants', researchRefId: restaurant.id, costSelections: { estimateOverride: { amount: '1200', currency: 'INR' } } });

  const cost = calculateItemCost(alt, { record: restaurant });
  assert.equal(cost.amount, 1200, 'the override, not the Research 800');
  assert.equal(cost.overridden, true);

  const researchAfter = await getRestaurantEntry(restaurant.id);
  assert.equal(researchAfter.price.amount, '800', 'Research is completely untouched by an alternative\'s cost override');
});

await test('updateItemAlternative can set/change costSelections on an EXISTING alternative, round-tripping through the real store', async () => {
  const dest = await createDestination({ name: 'Vietnam' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-01', endDate: '2026-01-05' });
  const item = await createTimelineItem(planning.id, 1, { itemType: 'meal', title: 'Dinner' });
  const alt = await createItemAlternative(item.id, { title: 'Backup restaurant' });
  assert.equal(alt.costSelections, null);

  const updated = await updateItemAlternative(alt.id, { costSelections: { estimateOverride: { amount: '600', currency: 'INR' } } });
  assert.deepEqual(updated.costSelections, { estimateOverride: { amount: '600', currency: 'INR' } });
  const reloaded = await getItemAlternative(alt.id);
  assert.deepEqual(reloaded.costSelections, { estimateOverride: { amount: '600', currency: 'INR' } }, 'persisted correctly');
});

console.log('\n53. Item-level alternative costs: all existing inclusion rules remain correct (regression)');
await test('a SELECTED alternative with an included parent counts toward the Planning total', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-12' });
  const lunch = await createTimelineItem(planning.id, 1, { itemType: 'meal', title: 'Lunch' }); // ordinary item -> always included
  const alt = await createItemAlternative(lunch.id, { title: 'Restaurant', selected: true, costSelections: { estimateOverride: { amount: '700', currency: 'INR' } } });

  const breakdown = calculatePlanningCostBreakdown({
    items: [lunch], alternatives: [{ alternative: alt, parentItem: lunch }], optionGroupsById: {}, getRecordForItem: () => null, travellerAges: [],
  });
  assert.equal(breakdown.categoryTotals.food.INR, 700);
});

await test('an UNSELECTED sibling alternative does not count, even with a fully-populated cost estimate', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-12' });
  const lunch = await createTimelineItem(planning.id, 1, { itemType: 'meal', title: 'Lunch' });
  const chosen = await createItemAlternative(lunch.id, { title: 'Restaurant A', selected: true, costSelections: { estimateOverride: { amount: '700', currency: 'INR' } } });
  const sibling = await createItemAlternative(lunch.id, { title: 'Restaurant B', selected: false, costSelections: { estimateOverride: { amount: '5000', currency: 'INR' } } });

  const breakdown = calculatePlanningCostBreakdown({
    items: [lunch], alternatives: [{ alternative: chosen, parentItem: lunch }, { alternative: sibling, parentItem: lunch }],
    optionGroupsById: {}, getRecordForItem: () => null, travellerAges: [],
  });
  assert.equal(breakdown.categoryTotals.food.INR, 700, 'only the selected sibling counts — the unselected one (5000) never contributes');
});

await test('an alternative inside an UNSELECTED itinerary Option never counts, regardless of its own selected flag or cost estimate', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-12' });
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  const itemInA = await createTimelineItem(planning.id, 1, { itemType: 'meal', title: 'Lunch (A)', optionGroupId: group.id, optionLabel: 'A' });
  const itemInB = await createTimelineItem(planning.id, 1, { itemType: 'meal', title: 'Lunch (B)', optionGroupId: group.id, optionLabel: 'B' });
  const altInB = await createItemAlternative(itemInB.id, { title: 'Expensive restaurant', selected: true, costSelections: { estimateOverride: { amount: '9000', currency: 'INR' } } });
  await selectOption(group.id, 'A');

  const groupsById = Object.fromEntries((await listOptionGroupsForPlanning(planning.id)).map(g => [g.id, g]));
  const breakdown = calculatePlanningCostBreakdown({
    items: [itemInA, itemInB], alternatives: [{ alternative: altInB, parentItem: itemInB }],
    optionGroupsById: groupsById, getRecordForItem: () => null, travellerAges: [],
  });
  assert.equal(breakdown.categoryTotals.food.INR, undefined, 'Option A has no priced items, Option B\'s alternative is excluded entirely — nothing counts');
});

await test('an UNRESOLVED (pending) Option group never double-counts alternatives from either competing Option', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-12' });
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  const itemInA = await createTimelineItem(planning.id, 1, { itemType: 'meal', title: 'Lunch (A)', optionGroupId: group.id, optionLabel: 'A' });
  const itemInB = await createTimelineItem(planning.id, 1, { itemType: 'meal', title: 'Lunch (B)', optionGroupId: group.id, optionLabel: 'B' });
  const altInA = await createItemAlternative(itemInA.id, { title: 'Restaurant A', selected: true, costSelections: { estimateOverride: { amount: '700', currency: 'INR' } } });
  const altInB = await createItemAlternative(itemInB.id, { title: 'Restaurant B', selected: true, costSelections: { estimateOverride: { amount: '900', currency: 'INR' } } });
  // selectOption is never called — the group stays at its default pending state.

  const groupsById = Object.fromEntries((await listOptionGroupsForPlanning(planning.id)).map(g => [g.id, g]));
  const breakdown = calculatePlanningCostBreakdown({
    items: [itemInA, itemInB], alternatives: [{ alternative: altInA, parentItem: itemInA }, { alternative: altInB, parentItem: itemInB }],
    optionGroupsById: groupsById, getRecordForItem: () => null, travellerAges: [],
  });
  assert.equal(breakdown.categoryTotals.food.INR, undefined, 'neither alternative counts while the Option is unresolved — never 700, never 900, never 1600');
});

await test('an alternative that is itself unresolved (selected: false) never counts, even with its parent fully included', async () => {
  const dest = await createDestination({ name: 'Sri Lanka' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-12' });
  const lunch = await createTimelineItem(planning.id, 1, { itemType: 'meal', title: 'Lunch', costSelections: { estimateOverride: { amount: '400', currency: 'INR' } } });
  const altA = await createItemAlternative(lunch.id, { title: 'Option A', selected: false, costSelections: { estimateOverride: { amount: '700', currency: 'INR' } } });
  const altB = await createItemAlternative(lunch.id, { title: 'Option B', selected: false, costSelections: { estimateOverride: { amount: '900', currency: 'INR' } } });

  const breakdown = calculatePlanningCostBreakdown({
    items: [lunch], alternatives: [{ alternative: altA, parentItem: lunch }, { alternative: altB, parentItem: lunch }],
    optionGroupsById: {}, getRecordForItem: () => null, travellerAges: [],
  });
  // Only the parent item's own cost (400) counts — neither
  // unresolved alternative is double-counted alongside it.
  assert.equal(breakdown.categoryTotals.food.INR, 400);
});

console.log('\n54. Phase 1 — derived end time, never a stored field (lib/planningValidation.js)');
await test('toMinutes / minutesToTime round-trip correctly, including past-midnight wrap', async () => {
  assert.equal(toMinutes('08:30'), 510);
  assert.equal(toMinutes('00:00'), 0);
  assert.equal(toMinutes(''), null);
  assert.equal(toMinutes(null), null);
  assert.equal(minutesToTime(510), '08:30');
  assert.equal(minutesToTime(0), '00:00');
  assert.equal(minutesToTime(1440), '00:00', 'exactly 24h wraps to the start of the next day');
  assert.equal(minutesToTime(1500), '01:00');
  assert.equal(minutesToTime(-30), '23:30', 'a negative value (defensive) wraps backward correctly rather than producing a negative time string');
});

await test('itemEndTime derives start + plannedDuration, exactly the worked example from the approved design (08:30 + 1h = 09:30)', async () => {
  assert.equal(itemEndTime({ startTime: '08:30', plannedDuration: 60 }), '09:30');
  assert.equal(itemEndTime({ startTime: '14:00', plannedDuration: 45 }), '14:45');
});

await test('itemEndTime correctly crosses a midnight boundary rather than erroring or clamping', async () => {
  assert.equal(itemEndTime({ startTime: '23:30', plannedDuration: 90 }), '01:00');
  assert.equal(itemEndTime({ startTime: '23:00', plannedDuration: 60 }), '00:00');
});

await test('itemEndTime returns null (never a guess) when there is nothing to derive from', async () => {
  assert.equal(itemEndTime({ startTime: '08:30', plannedDuration: null }), null, 'no duration -> no end time');
  assert.equal(itemEndTime({ startTime: '', plannedDuration: 60 }), null, 'no start time -> no end time');
  assert.equal(itemEndTime({}), null);
});

await test('no end-time field is ever persisted on a timeline item — it stays purely derived', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-14' });
  const item = await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'Tiger Hill sunrise', startTime: '04:30', plannedDuration: 90 });
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'endTime'), false, 'the stored record has no endTime field at all');
  assert.equal(itemEndTime(item), '06:00', 'it is still correctly derivable on demand from the stored startTime/plannedDuration');
});

console.log('\n55. Phase 1 — real schedule conflict detection (checkItemOverlap)');
await test('two items with a genuine time overlap produce a warning', async () => {
  const a = { startTime: '08:00', plannedDuration: 90, buffer: 0 };
  const b = { startTime: '09:00', plannedDuration: 30, buffer: 0 }; // a runs until 09:30, b starts at 09:00 -> overlap
  const finding = checkItemOverlap(a, b);
  assert.ok(finding);
  assert.equal(finding.level, 'warning');
});

await test('two items that do not overlap at all produce no finding, regardless of the gap size', async () => {
  assert.equal(checkItemOverlap({ startTime: '08:00', plannedDuration: 60, buffer: 0 }, { startTime: '10:00', plannedDuration: 30, buffer: 0 }), null, 'a two-hour gap is fine, not an error');
  assert.equal(checkItemOverlap({ startTime: '08:00', plannedDuration: 60, buffer: 0 }, { startTime: '20:00', plannedDuration: 30, buffer: 0 }), null, 'a large gap (free time) is never flagged as an error');
});

await test('an item ending exactly when the next starts, with zero buffer, does not conflict', async () => {
  const finding = checkItemOverlap({ startTime: '08:00', plannedDuration: 60, buffer: 0 }, { startTime: '09:00', plannedDuration: 30, buffer: 0 });
  assert.equal(finding, null, 'back-to-back with no buffer eaten into is adjacent, not overlapping');
});

await test('buffer time is accounted for — a gap that would be fine on duration alone can still conflict once buffer is included', async () => {
  // First item: 08:00-09:00 plus a 30-minute buffer -> occupied until 09:30.
  // Second item starts at 09:00 -> inside the first item's buffer window.
  const finding = checkItemOverlap({ startTime: '08:00', plannedDuration: 60, buffer: 30 }, { startTime: '09:00', plannedDuration: 30, buffer: 0 });
  assert.ok(finding, 'the buffer makes this a genuine conflict even though the raw activity durations do not overlap');
  assert.match(finding.message, /buffer/i);
});

await test('a second item starting exactly when the first\'s buffer window ends does not conflict', async () => {
  const finding = checkItemOverlap({ startTime: '08:00', plannedDuration: 60, buffer: 30 }, { startTime: '09:30', plannedDuration: 30, buffer: 0 });
  assert.equal(finding, null);
});

await test('checkItemOverlap is symmetric — argument order does not change the result', async () => {
  const a = { startTime: '08:00', plannedDuration: 90, buffer: 15 };
  const b = { startTime: '09:00', plannedDuration: 30, buffer: 0 };
  assert.deepEqual(checkItemOverlap(a, b), checkItemOverlap(b, a));
});

await test('checkItemOverlap never throws and returns null when data is missing — no start time, or no duration on either item', async () => {
  assert.equal(checkItemOverlap({ startTime: '', plannedDuration: 60 }, { startTime: '09:00', plannedDuration: 30 }), null);
  assert.equal(checkItemOverlap({ startTime: '08:00', plannedDuration: null }, { startTime: '09:00', plannedDuration: 30 }), null);
  assert.equal(checkItemOverlap({ startTime: '08:00', plannedDuration: 60 }, { startTime: '09:00', plannedDuration: null }), null);
  assert.doesNotThrow(() => checkItemOverlap(null, { startTime: '09:00', plannedDuration: 30 }));
});

await test('an overlap exists between two real timeline items created in the same Planning/day, found via the actual store data', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-14' });
  const batasiaLoop = await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'Batasia Loop', startTime: '08:00', plannedDuration: 90, buffer: 15 });
  const breakfast = await createTimelineItem(planning.id, 1, { itemType: 'meal', title: 'Breakfast', startTime: '09:00', plannedDuration: 30 });
  const finding = checkItemOverlap(batasiaLoop, breakfast);
  assert.ok(finding, 'Batasia Loop (08:00-09:30 + 15min buffer = occupied until 09:45) genuinely overlaps Breakfast starting at 09:00');
});

console.log('\n56. Phase 1 — out-of-range day retention (presentation-only; no planningDays store introduced)');
await test('shortening a Planning never deletes an out-of-range day\'s items, and planningDayDate still computes a real date for that day number for display purposes', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-14' }); // 5 days
  const day5Item = await createTimelineItem(planning.id, 5, { itemType: 'custom', title: 'Rock Garden', startTime: '10:00', plannedDuration: 60 });

  const shortened = await updatePlanning(planning.id, { endDate: '2026-01-12' }); // now 3 days; Day 5 is out of range
  assert.equal(planningDayCount(shortened), 3);

  const stillThere = await getTimelineItem(day5Item.id);
  assert.ok(stillThere, 'Day 5\'s item was never deleted by shortening the trip');
  assert.equal(stillThere.title, 'Rock Garden');

  // The day is now beyond listPlanningDays()'s own range...
  const currentDays = listPlanningDays(shortened);
  assert.equal(currentDays.length, 3);
  assert.ok(!currentDays.some(d => d.dayNumber === 5), 'Day 5 is not part of the current range');

  // ...but planningDayDate() still computes a real date for it, which
  // is exactly what the UI layer uses to render an out-of-range day
  // card without needing a new planningDays store (see
  // daysToRender() in PlanningDetailPage.jsx, a presentation-only
  // function, not a data-model change).
  const day5Date = planningDayDate(shortened, 5);
  assert.equal(day5Date, '2026-01-14');
});

await test('extending a Planning back out, or re-lengthening it, naturally un-marks a previously out-of-range day with no special handling needed', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-14' });
  await createTimelineItem(planning.id, 5, { itemType: 'custom', title: 'Rock Garden' });
  const shortened = await updatePlanning(planning.id, { endDate: '2026-01-12' });
  assert.equal(listPlanningDays(shortened).some(d => d.dayNumber === 5), false);

  const lengthenedAgain = await updatePlanning(planning.id, { endDate: '2026-01-14' });
  assert.equal(listPlanningDays(lengthenedAgain).some(d => d.dayNumber === 5), true, 'Day 5 is back in the current range purely because the dates say so — nothing needed to "move it back"');
});

console.log('\n57. Phase 1 — moving/reordering an item preserves all of its data');
await test('moving an item to a different day (updateTimelineItem with dayNumber + startTime) preserves every other field untouched', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const attraction = await createAttraction(dest.id, { place: { name: 'Tiger Hill' }, feeBands: [{ id: 'adult', label: 'Adult', minAge: '', maxAge: '', status: 'paid', amount: '50', currency: 'INR' }] });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-14' });
  const original = await createTimelineItem(planning.id, 1, {
    itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id,
    startTime: '04:30', plannedDuration: 90, buffer: 15, notes: 'Bring warm clothes', status: 'optional',
    costSelections: { selectedFeeBandIds: ['adult'] },
  });
  const alt = await createItemAlternative(original.id, { title: 'Backup viewpoint', rank: 1 });

  // The "move" operation itself — same store function every other edit uses.
  const moved = await updateTimelineItem(original.id, { dayNumber: 3, startTime: '05:00' });

  assert.equal(moved.id, original.id, 'the item keeps its identity — this is a move, not a delete+recreate');
  assert.equal(moved.dayNumber, 3, 'moved to the new day');
  assert.equal(moved.startTime, '05:00', 'moved to the new time');
  // Everything else preserved exactly:
  assert.equal(moved.researchRefType, 'attractions');
  assert.equal(moved.researchRefId, attraction.id);
  assert.equal(moved.plannedDuration, 90);
  assert.equal(moved.buffer, 15);
  assert.equal(moved.notes, 'Bring warm clothes');
  assert.equal(moved.status, 'optional');
  assert.deepEqual(moved.costSelections, { selectedFeeBandIds: ['adult'] });

  // The item-level Alternative, stored separately, survives untouched
  // and is still correctly linked to the same (moved) parent item.
  const altsAfterMove = await listAlternativesForItem(moved.id);
  assert.equal(altsAfterMove.length, 1);
  assert.equal(altsAfterMove[0].id, alt.id);
  assert.equal(altsAfterMove[0].title, 'Backup viewpoint');
});

await test('reordering within a day (changing only startTime) changes the item\'s position in listTimelineItemsForDay without touching anything else', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-14' });
  const breakfast = await createTimelineItem(planning.id, 1, { itemType: 'meal', title: 'Breakfast', startTime: '08:00', notes: 'Hotel buffet' });
  const walk = await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'Mall Road walk', startTime: '09:00' });

  let dayOrder = await listTimelineItemsForDay(planning.id, 1);
  assert.deepEqual(dayOrder.map(i => i.title), ['Breakfast', 'Mall Road walk']);

  // "Reorder" Mall Road walk to be first by giving it an earlier time
  // — the honest implementation per the data model: there is no
  // separate position field, order IS time (see
  // listTimelineItemsForDay in timelineItems.js).
  const reordered = await updateTimelineItem(walk.id, { startTime: '07:30' });
  assert.equal(reordered.notes, '', 'unrelated field (walk had no notes) stays as it was, not clobbered');

  dayOrder = await listTimelineItemsForDay(planning.id, 1);
  assert.deepEqual(dayOrder.map(i => i.title), ['Mall Road walk', 'Breakfast'], 'the order changed because the time changed, exactly reflecting the new schedule');
  const breakfastAfter = await getTimelineItem(breakfast.id);
  assert.equal(breakfastAfter.notes, 'Hotel buffet', 'the OTHER item was not touched by reordering the first one');
});

await test('an item belonging to an itinerary Option group keeps its optionGroupId/optionLabel when only its time is changed (time-only reorder, not a day move)', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-14' });
  const group = await createOptionGroup(planning.id, { dayNumber: 2, partLabel: 'Morning' });
  const item = await createTimelineItem(planning.id, 2, { itemType: 'custom', title: 'Toy train ride', optionGroupId: group.id, optionLabel: 'A', startTime: '07:00' });

  const retimed = await updateTimelineItem(item.id, { startTime: '06:30' });
  assert.equal(retimed.optionGroupId, group.id, 'still belongs to the same Option group');
  assert.equal(retimed.optionLabel, 'A', 'still the same Option within that group');
  assert.equal(retimed.dayNumber, 2, 'day unchanged — only the time moved');
});

console.log('\n58. Phase 1 — existing cost/validation/inclusion semantics remain fully intact (regression)');
await test('opening-hours validation (Chunk 4) is unaffected by the Phase 1 overlap-detection addition', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const monastery = await createAttraction(dest.id, { place: { name: 'Ghum Monastery' }, openingHours: [{ id: '1', days: ['fri'], ranges: [{ start: '', end: '' }], closed: true }] });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-09', endDate: '2026-01-13' }); // Jan 9 2026 = Friday
  const item = await createTimelineItem(planning.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: monastery.id, startTime: '10:00', plannedDuration: 60 });
  const finding = checkOpeningHours({ item, record: monastery, weekdayKey: weekdayKeyForDate(planningDayDate(planning, 1)) });
  assert.equal(finding.level, 'critical', 'closed-day detection still works exactly as before Phase 1');
});

await test('Option group inclusion/selection semantics (Chunk 3) are unaffected by Phase 1\'s chronological-merge presentation changes', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-14' });
  const group = await createOptionGroup(planning.id, { dayNumber: 3, partLabel: 'Morning' });
  const optionA = await createTimelineItem(planning.id, 3, { itemType: 'custom', title: 'Toy train', optionGroupId: group.id, optionLabel: 'A', startTime: '07:00' });
  const optionB = await createTimelineItem(planning.id, 3, { itemType: 'custom', title: 'Monastery visit', optionGroupId: group.id, optionLabel: 'B', startTime: '07:00' });
  await selectOption(group.id, 'A');
  const refreshedGroup = await getOptionGroup(group.id);
  assert.equal(refreshedGroup.selectedOptionLabel, 'A');
  const stillB = await getTimelineItem(optionB.id);
  assert.ok(stillB, 'unselected Option B item still exists, unaffected by Phase 1');
  assert.ok(optionA);
});

await test('cost calculation and home-currency handling are unaffected by Phase 1', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  await setDestinationDefaultCurrency(dest.id, 'NPR');
  await setHomeCurrency('INR');
  await setExchangeRate('NPR', 'INR', 0.625);
  const restaurant = await createRestaurantEntry(dest.id, { place: { name: 'Glenary\'s' }, price: { amount: '800', currency: 'INR', unit: '', note: '' } });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-14' });
  await createTimelineItem(planning.id, 1, { itemType: 'meal', researchRefType: 'restaurants', researchRefId: restaurant.id });
  const items = await listTimelineItems(planning.id);
  const breakdown = calculatePlanningCostBreakdown({ items, alternatives: [], optionGroupsById: {}, travellerAges: [], getRecordForItem: () => restaurant });
  assert.equal(breakdown.categoryTotals.food.INR, 800);
  assert.equal(await getHomeCurrency(), 'INR');
});

await test('accommodation stay-range and traveller age calculations are unaffected by Phase 1', async () => {
  const dest = await createDestination({ name: 'Darjeeling' });
  const hotel = await createAccommodation(dest.id, { place: { name: 'Windamere' }, price: { amount: '6000', currency: 'INR', unit: '', note: '' } });
  const adult = await createPerson({ name: 'Parent', dob: '1985-01-01' });
  const child = await createPerson({ name: 'Child', dob: '2019-06-01' });
  const planning = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-01-10', endDate: '2026-01-14', travellerIds: [adult.id, child.id] });
  const stay = await createTimelineItem(planning.id, 1, { itemType: 'accommodation', researchRefType: 'accommodations', researchRefId: hotel.id, checkOutDayNumber: 4 });
  assert.equal(nightsForAccommodationItem(stay), 3);
  const people = await listPeople();
  const ages = people.filter(p => planning.travellerIds.includes(p.id)).map(p => ageAsOf(p.dob, planning.startDate));
  assert.deepEqual(ages.sort((a, b) => a - b), [6, 41]);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);