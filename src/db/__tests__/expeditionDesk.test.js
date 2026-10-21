// Home "Expedition Desk" — read-only summary of where the traveller
// stands. Tests the pure date/selection logic and the loader against
// real IndexedDB behaviour (fake-indexeddb), using the actual stores
// and the same awareness/inclusion functions the Planning screen uses.
//
// Run with: npm run test:expedition-desk  (also under TZ=UTC,
// Asia/Kolkata and America/Los_Angeles — the date logic is the point)

import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { __resetDbForTest, getOne, put } from '../connection.js';
import { createDestination } from '../stores/destinations.js';
import { createAttraction } from '../stores/attractions.js';
import { createRestaurantEntry } from '../stores/restaurants.js';
import { createPlanning, deletePlanning } from '../stores/plannings.js';
import { createTimelineItem, listTimelineItems } from '../stores/timelineItems.js';
import { createOptionGroup, selectOption, deleteOptionGroup } from '../stores/planningOptionGroups.js';
import { createItemAlternative } from '../stores/itemAlternatives.js';
import {
  localDateString, dayDifference, classifyPlanning, pickFeaturedPlanning, describePhase, deriveNextSteps, loadExpeditionDesk,
} from '../../lib/expeditionDesk.js';

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

const P = (name, startDate, endDate) => ({ id: name, name, startDate, endDate });

console.log('\n=== Home: Expedition Desk ===\n');
console.log('A. Local-calendar date handling');

await test('A1. localDateString reads the LOCAL calendar day, including just after and just before midnight', async () => {
  assert.equal(localDateString(new Date(2026, 2, 8, 0, 30)), '2026-03-08', '00:30 local is still the 8th');
  assert.equal(localDateString(new Date(2026, 2, 8, 23, 59, 59)), '2026-03-08', '23:59:59 local is still the 8th');
  assert.equal(localDateString(new Date(2026, 11, 31, 23, 0)), '2026-12-31');
  assert.equal(localDateString(new Date(2027, 0, 1, 0, 0)), '2027-01-01');
  assert.equal(localDateString(new Date(2028, 1, 29, 12, 0)), '2028-02-29', 'leap day');
});

await test('A2. dayDifference counts whole calendar days across DST changes, month/year ends and leap days', async () => {
  assert.equal(dayDifference('2026-03-07', '2026-03-09'), 2, 'US spring-forward');
  assert.equal(dayDifference('2026-10-31', '2026-11-02'), 2, 'US fall-back');
  assert.equal(dayDifference('2026-03-28', '2026-03-30'), 2, 'EU spring-forward');
  assert.equal(dayDifference('2026-12-30', '2027-01-02'), 3);
  assert.equal(dayDifference('2028-02-28', '2028-03-01'), 2, 'leap year');
  assert.equal(dayDifference('2027-02-28', '2027-03-01'), 1, 'non-leap year');
  assert.equal(dayDifference('2026-05-10', '2026-05-10'), 0);
  assert.equal(dayDifference('2026-05-10', '2026-05-08'), -2);
  assert.equal(dayDifference('', '2026-05-08'), null);
  assert.equal(dayDifference('2026-02-31', '2026-03-01'), null, 'impossible date rejected');
  assert.equal(dayDifference('20260510', '2026-05-11'), null, 'wrong shape rejected');
  assert.equal(dayDifference(undefined, null), null);
});

await test('A3. classifyPlanning: underway on the first and last day, upcoming, past, undated/malformed', async () => {
  const trip = P('t', '2026-12-20', '2026-12-24'); // 5 days
  assert.deepEqual(classifyPlanning(trip, '2026-12-19'), { phase: 'upcoming', daysUntilStart: 1, totalDays: 5 });
  assert.deepEqual(classifyPlanning(trip, '2026-12-20'), { phase: 'underway', dayNumber: 1, totalDays: 5 });
  assert.deepEqual(classifyPlanning(trip, '2026-12-22'), { phase: 'underway', dayNumber: 3, totalDays: 5 });
  assert.deepEqual(classifyPlanning(trip, '2026-12-24'), { phase: 'underway', dayNumber: 5, totalDays: 5 });
  assert.deepEqual(classifyPlanning(trip, '2026-12-25'), { phase: 'past', daysSinceEnd: 1, totalDays: 5 });
  assert.equal(classifyPlanning({ startDate: '', endDate: '' }, '2026-12-20').phase, 'undated');
  assert.equal(classifyPlanning({ startDate: 'garbage', endDate: '2026-12-24' }, '2026-12-20').phase, 'undated');
  assert.equal(classifyPlanning(null, '2026-12-20').phase, 'undated');
  const oneDay = P('one', '2026-12-20', '2026-12-20');
  assert.deepEqual(classifyPlanning(oneDay, '2026-12-20'), { phase: 'underway', dayNumber: 1, totalDays: 1 });
});

console.log('\nB. Choosing the featured trip');

await test('B1. underway beats upcoming beats past; nearest upcoming; most recent past; none -> null', async () => {
  const today = '2026-12-22';
  const underway = P('underway', '2026-12-20', '2026-12-24');
  const soon = P('soon', '2026-12-28', '2026-12-30');
  const later = P('later', '2027-03-01', '2027-03-05');
  const old = P('old', '2026-01-01', '2026-01-05');
  const recent = P('recent', '2026-12-10', '2026-12-15');
  assert.equal(pickFeaturedPlanning([later, soon, old, underway, recent], today).planning.id, 'underway');
  assert.equal(pickFeaturedPlanning([later, soon, old, recent], today).planning.id, 'soon');
  assert.equal(pickFeaturedPlanning([old, recent], today).planning.id, 'recent');
  assert.equal(pickFeaturedPlanning([], today), null);
  assert.equal(pickFeaturedPlanning(undefined, today), null);
  assert.equal(pickFeaturedPlanning([P('u', '', '')], today), null, 'undated Plannings are never featured');
});

await test('B2. with two trips underway, the one that started most recently leads; phase labels read correctly', async () => {
  const a = P('a', '2026-12-18', '2026-12-30');
  const b = P('b', '2026-12-21', '2026-12-23');
  assert.equal(pickFeaturedPlanning([a, b], '2026-12-22').planning.id, 'b');
  assert.equal(describePhase({ phase: 'underway', dayNumber: 3, totalDays: 5 }), 'Underway · Day 3 of 5');
  assert.equal(describePhase({ phase: 'upcoming', daysUntilStart: 1 }), 'Upcoming · Starts tomorrow');
  assert.equal(describePhase({ phase: 'upcoming', daysUntilStart: 12 }), 'Upcoming · In 12 days');
  assert.equal(describePhase({ phase: 'past', daysSinceEnd: 1 }), 'Most recent · Ended yesterday');
  assert.equal(describePhase({ phase: 'past', daysSinceEnd: 9 }), 'Most recent · Ended 9 days ago');
  assert.equal(describePhase({ phase: 'undated' }), 'Undated');
});

console.log('\nC. Next steps');

await test('C1. next steps follow a fixed priority, singular/plural, capped at three; nothing outstanding says so', async () => {
  const none = { pendingOptions: 0, pendingAlternatives: 0, mustSeeUnresolved: 0, conflicts: 0, outOfRange: 0, totalWarnings: 0 };
  assert.deepEqual(deriveNextSteps({ ...none, conflicts: 1 }, {}).map(s => s.label), ['Fix 1 schedule conflict']);
  const all = { ...none, conflicts: 2, pendingOptions: 1, pendingAlternatives: 3, mustSeeUnresolved: 1 };
  const steps = deriveNextSteps(all, {});
  assert.deepEqual(steps.map(s => s.key), ['conflicts', 'options', 'alternatives'], 'capped at three, in priority order');
  assert.equal(steps[0].label, 'Fix 2 schedule conflicts');
  assert.equal(deriveNextSteps(all, {}, 4)[3].label, 'Place or review 1 Must-see attraction');
  assert.equal(deriveNextSteps(none, { itemCount: 0, daysPlanned: 0, totalDays: 5 })[0].key, 'start');
  assert.equal(deriveNextSteps(none, { itemCount: 4, daysPlanned: 3, totalDays: 5 })[0].label, 'Plan the remaining 2 days');
  assert.equal(deriveNextSteps(none, { itemCount: 4, daysPlanned: 4, totalDays: 5 })[0].label, 'Plan the remaining 1 day');
  assert.deepEqual(deriveNextSteps(none, { itemCount: 5, daysPlanned: 5, totalDays: 5 }).map(s => s.key), ['clear']);
  assert.deepEqual(deriveNextSteps(none, {}).map(s => s.key), ['clear'], 'no dates -> never invents work');
});

console.log('\nD. Loading the desk from real data');

async function seed() {
  const dest = await createDestination({ name: 'Darjeeling' });
  const mk = (name, extra = {}) => createAttraction(dest.id, { place: { name }, ...extra });
  return { dest, mk };
}

await test('D1. no Plannings: empty desk with counts, no featured trip, no error', async () => {
  const empty = await loadExpeditionDesk('2026-12-22');
  assert.deepEqual([empty.destinationCount, empty.planningCount, empty.featured, empty.others], [0, 0, null, []]);
  const { dest } = await seed();
  const withDest = await loadExpeditionDesk('2026-12-22');
  assert.equal(withDest.destinationCount, 1);
  assert.equal(withDest.featured, null);
  assert.ok(dest.id);
});

await test('D2. features the underway trip with phase, destination, coverage, decisions, must-see and research counts', async () => {
  const { dest, mk } = await seed();
  const tiger = await mk('Tiger Hill', { visitPriority: 'must_see' });
  const batasia = await mk('Batasia Loop', { visitPriority: 'must_see' });
  await mk('Zoo');
  await createRestaurantEntry(dest.id, { place: { name: 'Keventers' } });
  const trip = await createPlanning(dest.id, { name: 'December Trip', startDate: '2026-12-20', endDate: '2026-12-24' });
  await createTimelineItem(trip.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: tiger.id, startTime: '05:00', plannedDuration: 60 });
  await createTimelineItem(trip.id, 3, { itemType: 'custom', title: 'Rest day', startTime: '10:00' });

  const desk = await loadExpeditionDesk('2026-12-22');
  assert.equal(desk.planningCount, 1);
  const f = desk.featured;
  assert.equal(f.planning.id, trip.id);
  assert.equal(f.phase, 'underway');
  assert.equal(f.dayNumber, 3);
  assert.equal(f.destinationName, 'Darjeeling');
  assert.deepEqual(f.stats, { itemCount: 2, daysPlanned: 2, totalDays: 5 });
  assert.deepEqual(f.mustSee, { total: 2, resolved: 1 }, 'Tiger Hill is in the itinerary; Batasia Loop is not');
  assert.equal(f.summary.mustSeeUnresolved, 1);
  assert.deepEqual(f.research, { attractions: 3, restaurants: 1, accommodations: 0, transport: 0 });
  assert.ok(f.attention.some(a => a.kind === 'must_see_unresolved' && a.title === 'Batasia Loop'));
  assert.ok(f.attention.every(a => a.severity === 'warning'), 'informational notes are not shown on the desk');
  assert.equal(f.nextSteps[0].key, 'must-see');
  assert.ok(batasia.id);
});

await test('D3. unresolved decisions surface exactly as on the Planning screen: pending Option, pending alternative, conflict', async () => {
  const { dest, mk } = await seed();
  const a = await mk('A'); const b = await mk('B');
  const trip = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-12-20', endDate: '2026-12-24' });
  const group = await createOptionGroup(trip.id, { dayNumber: 2, partLabel: 'Morning' });
  await createTimelineItem(trip.id, 2, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: a.id, optionGroupId: group.id, optionLabel: 'A', startTime: '09:00' });
  const host = await createTimelineItem(trip.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: a.id, startTime: '09:00', plannedDuration: 60 });
  await createItemAlternative(host.id, { researchRefType: 'attractions', researchRefId: b.id });
  await createTimelineItem(trip.id, 1, { itemType: 'custom', title: 'Overlapping', startTime: '09:30', plannedDuration: 60 });

  const f = (await loadExpeditionDesk('2026-12-22')).featured;
  assert.deepEqual([f.summary.pendingOptions, f.summary.pendingAlternatives, f.summary.conflicts], [1, 1, 1]);
  assert.deepEqual(f.nextSteps.map(s => s.key), ['conflicts', 'options', 'alternatives']);
  assert.equal(f.stats.itemCount, 2, 'the item inside the pending Option is a possibility, not a plan');
  assert.equal(f.stats.daysPlanned, 1);

  await selectOption(group.id, 'A');
  const after = (await loadExpeditionDesk('2026-12-22')).featured;
  assert.equal(after.summary.pendingOptions, 0);
  assert.equal(after.stats.itemCount, 3, 'now part of the current itinerary');
  assert.equal(after.stats.daysPlanned, 2);
});

await test('D4. items orphaned by an old Option-group deletion count as planned (same reading as the Planning screen)', async () => {
  const { dest, mk } = await seed();
  const a = await mk('A');
  const trip = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-12-20', endDate: '2026-12-24' });
  const group = await createOptionGroup(trip.id, { dayNumber: 2, partLabel: 'Morning' });
  const item = await createTimelineItem(trip.id, 2, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: a.id, optionGroupId: group.id, optionLabel: 'A' });
  await put('planningOptionGroups', { ...(await getOne('planningOptionGroups', group.id)), deletedAt: new Date().toISOString() }); // the OLD deletion
  const f = (await loadExpeditionDesk('2026-12-22')).featured;
  assert.deepEqual(f.stats, { itemCount: 1, daysPlanned: 1, totalDays: 5 });
  assert.equal((await getOne('timelineItems', item.id)).optionGroupId, group.id, 'read-only: nothing rewritten');

  // And the current behaviour: deleting a group keeps the items planned.
  const g2 = await createOptionGroup(trip.id, { dayNumber: 3, partLabel: 'Evening' });
  await createTimelineItem(trip.id, 3, { itemType: 'custom', title: 'Dinner', optionGroupId: g2.id, optionLabel: 'A' });
  await selectOption(g2.id, 'A');
  await deleteOptionGroup(g2.id);
  assert.equal((await loadExpeditionDesk('2026-12-22')).featured.stats.daysPlanned, 2);
});

await test('D5. other Plannings are listed (nearest upcoming first, then past, then undated); deleted and cross-destination handled', async () => {
  const { dest } = await seed();
  const other = await createDestination({ name: 'Sikkim' });
  const now = await createPlanning(dest.id, { name: 'Now', startDate: '2026-12-20', endDate: '2026-12-24' });
  await createPlanning(dest.id, { name: 'Far', startDate: '2027-06-01', endDate: '2027-06-03' });
  await createPlanning(other.id, { name: 'Near', startDate: '2026-12-30', endDate: '2027-01-02' });
  await createPlanning(dest.id, { name: 'Old', startDate: '2026-01-01', endDate: '2026-01-03' });
  const dead = await createPlanning(dest.id, { name: 'Deleted', startDate: '2026-12-23', endDate: '2026-12-25' });
  await deletePlanning(dead.id);

  const desk = await loadExpeditionDesk('2026-12-22');
  assert.equal(desk.featured.planning.id, now.id);
  assert.deepEqual(desk.others.map(o => [o.planning.name, o.phase, o.destinationName]), [
    ['Near', 'upcoming', 'Sikkim'], ['Far', 'upcoming', 'Darjeeling'], ['Old', 'past', 'Darjeeling'],
  ]);
  assert.equal(desk.planningCount, 4, 'a soft-deleted Planning is not counted');
});

await test('D6. loading the desk writes nothing', async () => {
  const { dest, mk } = await seed();
  const a = await mk('A', { visitPriority: 'must_see' });
  const trip = await createPlanning(dest.id, { name: 'Trip', startDate: '2026-12-20', endDate: '2026-12-24' });
  await createTimelineItem(trip.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: a.id });
  const before = JSON.stringify(await listTimelineItems(trip.id));
  await loadExpeditionDesk('2026-12-22');
  await loadExpeditionDesk('2026-12-22');
  assert.equal(JSON.stringify(await listTimelineItems(trip.id)), before);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
