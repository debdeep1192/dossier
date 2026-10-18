// Tour Planning, Phase 4 — itinerary manipulation integrity.
//
// Focus: deleting an Option group must not leave its items active but
// invisible (the bug found during Phase 3), and everything that reads
// a Planning — rendering rules, inclusion, costs, Must-see audit,
// Needs Attention, Research reverse references — must stay consistent
// before and after. Real IndexedDB behaviour via fake-indexeddb,
// exercising the actual stores and lib functions, in the same style
// as foundation.test.js / researchPlanning.test.js.
//
// Run with: npm run test:itinerary-integrity

import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { __resetDbForTest, getDb, getOne, put } from '../connection.js';
import { createDestination } from '../stores/destinations.js';
import { createAttraction, deleteAttraction, listAttractions } from '../stores/attractions.js';
import { createPlanning, updatePlanning, planningDayDate, listPlanningDays } from '../stores/plannings.js';
import { createTimelineItem, listTimelineItems, updateTimelineItem, deleteTimelineItem } from '../stores/timelineItems.js';
import { createOptionGroup, selectOption, deleteOptionGroup, listOptionGroupsForPlanning, getOptionGroup } from '../stores/planningOptionGroups.js';
import { createItemAlternative, listAlternativesForItem } from '../stores/itemAlternatives.js';
import { listReviewFlagsForPlanning } from '../stores/planningReviewFlags.js';
import { emptyFeeBand } from '../../lib/feeBands.js';
import { calculatePlanningCostBreakdown, isTimelineItemCurrentlyIncluded } from '../../lib/planningCosts.js';
import { auditMustSeeAttractions, buildNeedsAttention, summarizeNeedsAttention } from '../../lib/planningAwareness.js';
import { checkItemOverlap } from '../../lib/planningValidation.js';
import { loadPlanningReferenceData, deriveResearchReferences } from '../../lib/researchReferences.js';
import { detachOrphanedGroupItems, isOrphanedFromOptionGroup, describeOptionGroupDeletion } from '../../lib/optionGroupIntegrity.js';

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

const TRIP = { startDate: '2026-12-20', endDate: '2026-12-24' };
const BAND = { ...emptyFeeBand('INR'), status: 'paid', amount: '100' };

// --- fixtures -----------------------------------------------------------------------------

async function world() {
  const dest = await createDestination({ name: 'Darjeeling' });
  const mk = (name, extra = {}) => createAttraction(dest.id, { place: { name }, feeBands: [BAND], ...extra });
  const planning = await createPlanning(dest.id, { name: 'Trip', ...TRIP });
  return { dest, planning, mk };
}

const attractionItem = (attraction, extra = {}) => ({
  itemType: 'attraction', researchRefType: 'attractions', researchRefId: attraction.id,
  costSelections: { selectedFeeBandIds: [BAND.id] }, ...extra,
});

// Everything the Planning page loads for one Planning, applying the same
// read-time tolerance the page and list page apply.
async function snapshot(dest, planning) {
  const rawItems = await listTimelineItems(planning.id);
  const optionGroups = await listOptionGroupsForPlanning(planning.id);
  const timelineItems = detachOrphanedGroupItems(rawItems, optionGroups);
  const alternativesByItemId = {};
  for (const item of timelineItems) alternativesByItemId[item.id] = await listAlternativesForItem(item.id);
  const records = Object.fromEntries((await listAttractions(dest.id)).map(r => [r.id, r]));
  return {
    rawItems, timelineItems, optionGroups, alternativesByItemId, records,
    optionGroupsById: Object.fromEntries(optionGroups.map(g => [g.id, g])),
    reviewFlags: await listReviewFlagsForPlanning(planning.id),
    planning,
  };
}

// The page's own partition rule (DaysTimeline): an item with an
// optionGroupId is only ever rendered THROUGH an active group; everything
// else is an ordinary row. Returns what would actually be on screen.
function visibleItemIds(snap) {
  const ids = new Set();
  const activeGroupIds = new Set(snap.optionGroups.map(g => g.id));
  for (const item of snap.timelineItems) {
    if (!item.optionGroupId) ids.add(item.id);
    else if (activeGroupIds.has(item.optionGroupId)) {
      // rendered through its group: selected Option as rows, others as a summary line
      ids.add(item.id);
    }
  }
  return ids;
}

function costs(snap, travellerAges = [30]) {
  const alternatives = Object.entries(snap.alternativesByItemId).flatMap(([itemId, alts]) => {
    const parentItem = snap.timelineItems.find(i => i.id === itemId);
    return parentItem ? alts.map(alternative => ({ alternative, parentItem })) : [];
  });
  return calculatePlanningCostBreakdown({
    items: snap.timelineItems, alternatives, optionGroupsById: snap.optionGroupsById, travellerAges,
    getRecordForItem: (item) => (item.researchRefId ? snap.records[item.researchRefId] : null),
  });
}

function attention(snap, currentDayCount = 5) {
  return buildNeedsAttention({
    timelineItems: snap.timelineItems, optionGroups: snap.optionGroups, alternativesByItemId: snap.alternativesByItemId,
    attractions: Object.values(snap.records), reviewFlags: snap.reviewFlags, currentDayCount,
  });
}

function audit(snap) {
  return auditMustSeeAttractions({
    attractions: Object.values(snap.records), timelineItems: snap.timelineItems, alternativesByItemId: snap.alternativesByItemId,
    optionGroupsById: snap.optionGroupsById, reviewFlags: snap.reviewFlags,
  });
}

async function refs(destId, attractionId) {
  return deriveResearchReferences({ researchRefType: 'attractions', researchRefId: attractionId, planningData: await loadPlanningReferenceData(destId) });
}

// What the OLD deleteOptionGroup did: soft-delete the group row only.
async function legacyDeleteGroupOnly(groupId) {
  const group = await getOne('planningOptionGroups', groupId);
  await put('planningOptionGroups', { ...group, deletedAt: new Date().toISOString() });
}

const STRUCTURAL = ['optionGroupId', 'optionLabel', 'updatedAt'];
function withoutStructural(item) {
  const copy = { ...item };
  for (const k of STRUCTURAL) delete copy[k];
  return copy;
}

console.log('\n=== Phase 4: itinerary manipulation integrity ===\n');

// ---------------------------------------------------------------------------
console.log('A. Deleting an Option group — items survive as ordinary items');

await test('A1. deleting an EMPTY group just removes the group', async () => {
  const { planning } = await world();
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  const deleted = await deleteOptionGroup(group.id);
  assert.ok(deleted.deletedAt);
  assert.equal(await getOptionGroup(group.id), null);
  assert.deepEqual(await listOptionGroupsForPlanning(planning.id), []);
  assert.deepEqual(await listTimelineItems(planning.id), []);
});

await test('A2. a group with ONE item: the item survives, is ordinary, and keeps every meaningful field', async () => {
  const { dest, planning, mk } = await world();
  const tiger = await mk('Tiger Hill');
  const group = await createOptionGroup(planning.id, { dayNumber: 2, partLabel: 'Morning' });
  const item = await createTimelineItem(planning.id, 2, attractionItem(tiger, {
    optionGroupId: group.id, optionLabel: 'A', partLabel: 'Morning', startTime: '05:00', plannedDuration: 90, buffer: 15,
    notes: 'Leave early', status: 'optional', rank: 3,
  }));
  await selectOption(group.id, 'A');
  const before = await getOne('timelineItems', item.id);

  await deleteOptionGroup(group.id);

  const after = await getOne('timelineItems', item.id);
  assert.equal(after.deletedAt, null, 'still active');
  assert.equal(after.optionGroupId, null);
  assert.equal(after.optionLabel, null);
  assert.deepEqual(withoutStructural(after), withoutStructural(before), 'every other field is preserved exactly');
  assert.equal(after.dayNumber, 2);
  assert.equal(after.startTime, '05:00');
  assert.equal(after.researchRefId, tiger.id, 'still a reference, not a snapshot');

  const snap = await snapshot(dest, planning);
  assert.ok(visibleItemIds(snap).has(item.id), 'visible on screen');
  assert.equal(isTimelineItemCurrentlyIncluded(snap.timelineItems[0], snap.optionGroupsById), true);
});

await test('A3. a group with MANY items across several Options: all survive; nothing else is touched', async () => {
  const { dest, planning, mk } = await world();
  const [a, b, c, d] = await Promise.all(['A1', 'B1', 'C1', 'D1'].map(n => mk(n)));
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  const other = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Evening' });
  const inGroup = [];
  inGroup.push(await createTimelineItem(planning.id, 1, attractionItem(a, { optionGroupId: group.id, optionLabel: 'A', startTime: '09:00', plannedDuration: 60 })));
  inGroup.push(await createTimelineItem(planning.id, 1, attractionItem(b, { optionGroupId: group.id, optionLabel: 'A', startTime: '10:30', plannedDuration: 60 })));
  inGroup.push(await createTimelineItem(planning.id, 1, attractionItem(c, { optionGroupId: group.id, optionLabel: 'B', startTime: '09:00', plannedDuration: 120 })));
  const bystanderInOtherGroup = await createTimelineItem(planning.id, 1, attractionItem(d, { optionGroupId: other.id, optionLabel: 'A', startTime: '19:00' }));
  const ordinary = await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'Breakfast', startTime: '08:00' });
  const alreadyDeleted = await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'Removed earlier', optionGroupId: group.id, optionLabel: 'B' });
  await deleteTimelineItem(alreadyDeleted.id);
  await selectOption(group.id, 'A');
  const bystanderBefore = await getOne('timelineItems', bystanderInOtherGroup.id);
  const ordinaryBefore = await getOne('timelineItems', ordinary.id);

  await deleteOptionGroup(group.id);

  const snap = await snapshot(dest, planning);
  for (const item of inGroup) {
    const stored = await getOne('timelineItems', item.id);
    assert.equal(stored.deletedAt, null);
    assert.equal(stored.optionGroupId, null);
    assert.equal(stored.optionLabel, null);
    assert.ok(visibleItemIds(snap).has(item.id));
  }
  assert.deepEqual(await getOne('timelineItems', bystanderInOtherGroup.id), bystanderBefore, 'an item in a DIFFERENT group is byte-for-byte untouched');
  assert.deepEqual(await getOne('timelineItems', ordinary.id), ordinaryBefore, 'an ordinary item is byte-for-byte untouched');
  assert.ok((await getOne('timelineItems', alreadyDeleted.id)).deletedAt, 'a previously soft-deleted item stays deleted — not resurrected');
  assert.equal((await getOne('timelineItems', alreadyDeleted.id)).optionGroupId, group.id, 'and is not rewritten');
  assert.equal((await getOptionGroup(other.id)).selectedOptionLabel, null, 'the other group is untouched');
});

await test('A4. both selection states — Option selected, and Selection pending — behave the same: items survive', async () => {
  for (const selection of ['A', 'B', null]) {
    __resetDbForTest();
    globalThis.indexedDB = new (await import('fake-indexeddb')).IDBFactory();
    const { dest, planning, mk } = await world();
    const x = await mk('X'); const y = await mk('Y');
    const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
    const ia = await createTimelineItem(planning.id, 1, attractionItem(x, { optionGroupId: group.id, optionLabel: 'A', startTime: '09:00' }));
    const ib = await createTimelineItem(planning.id, 1, attractionItem(y, { optionGroupId: group.id, optionLabel: 'B', startTime: '14:00' }));
    if (selection) await selectOption(group.id, selection);
    await deleteOptionGroup(group.id);
    const snap = await snapshot(dest, planning);
    assert.deepEqual([...visibleItemIds(snap)].sort(), [ia.id, ib.id].sort(), `selection=${selection}: both items visible`);
    assert.ok(snap.timelineItems.every(i => !i.optionGroupId && i.deletedAt === null));
    assert.ok(snap.rawItems.every(i => !i.optionGroupId && !i.optionLabel && i.deletedAt === null), 'the STORED records are detached, not merely read that way');
  }
});

await test('A5. item alternatives stay attached to their (surviving) parent item, with their selection intact', async () => {
  const { dest, planning, mk } = await world();
  const lunchA = await mk('Lunch Spot A'); const lunchB = await mk('Lunch Spot B');
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Midday' });
  const lunch = await createTimelineItem(planning.id, 1, { itemType: 'meal', researchRefType: 'attractions', researchRefId: lunchA.id, optionGroupId: group.id, optionLabel: 'A', startTime: '13:00' });
  const altChosen = await createItemAlternative(lunch.id, { researchRefType: 'attractions', researchRefId: lunchB.id, selected: true, notes: 'closer' });
  const altOther = await createItemAlternative(lunch.id, { title: 'Pack a picnic' });
  await selectOption(group.id, 'A');
  const altsBefore = await listAlternativesForItem(lunch.id);

  await deleteOptionGroup(group.id);

  const altsAfter = await listAlternativesForItem(lunch.id);
  assert.deepEqual(altsAfter, altsBefore, 'alternatives are byte-for-byte unchanged — their parent relationship is still valid');
  assert.equal(altsAfter.find(a => a.id === altChosen.id).selected, true);
  assert.equal(altsAfter.find(a => a.id === altOther.id).selected, false, 'an unresolved choice stays unresolved — nothing is auto-selected');
  const snap = await snapshot(dest, planning);
  assert.equal(snap.alternativesByItemId[lunch.id].length, 2);
});

await test('A6. repeated deletion and unknown groups are safe: same error, nothing changes', async () => {
  const { dest, planning, mk } = await world();
  const x = await mk('X');
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  await createTimelineItem(planning.id, 1, attractionItem(x, { optionGroupId: group.id, optionLabel: 'A' }));
  await deleteOptionGroup(group.id);
  const afterFirst = JSON.stringify(await listTimelineItems(planning.id));
  await assert.rejects(() => deleteOptionGroup(group.id), /Record not found/);
  await assert.rejects(() => deleteOptionGroup('no-such-group'), /Record not found/);
  assert.equal(JSON.stringify(await listTimelineItems(planning.id)), afterFirst, 'a repeated/unknown delete changes nothing');
  assert.equal((await snapshot(dest, planning)).timelineItems.length, 1);
});

await test('A7. the deletion is atomic: if anything fails part-way, neither the group nor any item changes', async () => {
  const { planning, mk } = await world();
  const x = await mk('X'); const y = await mk('Y');
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  await createTimelineItem(planning.id, 1, attractionItem(x, { optionGroupId: group.id, optionLabel: 'A' }));
  await createTimelineItem(planning.id, 1, attractionItem(y, { optionGroupId: group.id, optionLabel: 'B' }));
  const before = JSON.stringify([await listTimelineItems(planning.id), await listOptionGroupsForPlanning(planning.id)]);

  // Make the group's own write fail AFTER the item writes were queued.
  const realPut = globalThis.IDBObjectStore.prototype.put;
  globalThis.IDBObjectStore.prototype.put = function (record, ...rest) {
    if (record && record.id === group.id && record.deletedAt) throw new Error('simulated write failure');
    return realPut.call(this, record, ...rest);
  };
  try {
    await assert.rejects(() => deleteOptionGroup(group.id));
  } finally {
    globalThis.IDBObjectStore.prototype.put = realPut;
  }
  const after = JSON.stringify([await listTimelineItems(planning.id), await listOptionGroupsForPlanning(planning.id)]);
  assert.equal(after, before, 'rolled back completely: group still active, items still grouped, no half-detached state');
});

// ---------------------------------------------------------------------------
console.log('\nB. Chronological order and visibility after deletion');

await test('B1. surviving items land on their own day in time order, interleaved with ordinary items', async () => {
  const { dest, planning, mk } = await world();
  const [a, b, c] = await Promise.all(['A', 'B', 'C'].map(n => mk(n)));
  const group = await createOptionGroup(planning.id, { dayNumber: 3, partLabel: 'Morning' });
  await createTimelineItem(planning.id, 3, attractionItem(a, { optionGroupId: group.id, optionLabel: 'A', startTime: '11:00', plannedDuration: 30 }));
  await createTimelineItem(planning.id, 3, attractionItem(b, { optionGroupId: group.id, optionLabel: 'A', startTime: '09:00', plannedDuration: 30 }));
  await createTimelineItem(planning.id, 3, { itemType: 'custom', title: 'Coffee', startTime: '10:00', plannedDuration: 30 });
  await createTimelineItem(planning.id, 3, { itemType: 'custom', title: 'Untimed note' });
  await createTimelineItem(planning.id, 4, attractionItem(c, { optionGroupId: null }));
  await selectOption(group.id, 'A');
  await deleteOptionGroup(group.id);

  const snap = await snapshot(dest, planning);
  const day3 = snap.timelineItems.filter(i => i.dayNumber === 3 && !i.optionGroupId);
  const ordered = [...day3].sort((x, y) => {
    if (x.startTime && y.startTime) return x.startTime.localeCompare(y.startTime);
    if (x.startTime) return -1;
    if (y.startTime) return 1;
    return x.createdAt.localeCompare(y.createdAt);
  }).map(i => i.startTime || '(untimed)');
  assert.deepEqual(ordered, ['09:00', '10:00', '11:00', '(untimed)'], 'the same time-then-created ordering the page applies to ordinary items');
  assert.equal(snap.timelineItems.filter(i => i.dayNumber === 4).length, 1, 'other days unaffected');
});

await test('B2. an item on an out-of-range day is neither lost nor hidden, and still counts as out-of-range content', async () => {
  const { dest, planning, mk } = await world(); // 5-day trip
  const far = await mk('Far away');
  const group = await createOptionGroup(planning.id, { dayNumber: 8, partLabel: 'Morning' });
  const item = await createTimelineItem(planning.id, 8, attractionItem(far, { optionGroupId: group.id, optionLabel: 'A' }));
  await selectOption(group.id, 'A');
  await deleteOptionGroup(group.id);
  const snap = await snapshot(dest, planning);
  assert.ok(visibleItemIds(snap).has(item.id));
  const outOfRange = attention(snap, 5).filter(i => i.kind === 'out_of_range');
  assert.deepEqual(outOfRange.map(i => [i.dayNumber, i.message]), [[8, 'Day 8 has 1 item outside the current trip dates']]);
});

// ---------------------------------------------------------------------------
console.log('\nC. Costs before and after');

await test('C1. when only the SELECTED Option has items, the itinerary and total are unchanged by deleting the group', async () => {
  const { dest, planning, mk } = await world();
  const x = await mk('X'); const y = await mk('Y');
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  await createTimelineItem(planning.id, 1, attractionItem(x, { optionGroupId: group.id, optionLabel: 'A', startTime: '09:00' }));
  await createTimelineItem(planning.id, 1, attractionItem(y, { optionGroupId: group.id, optionLabel: 'A', startTime: '11:00' }));
  await selectOption(group.id, 'A');
  const before = costs(await snapshot(dest, planning)).overallByCurrency;
  assert.deepEqual(before, { INR: 200 });
  assert.equal(describeOptionGroupDeletion(await getOptionGroup(group.id), (await listTimelineItems(planning.id))).newlyCurrentCount, 0);
  await deleteOptionGroup(group.id);
  assert.deepEqual(costs(await snapshot(dest, planning)).overallByCurrency, before);
});

await test('C2. items of NON-selected Options become ordinary (current): the total now counts them — exactly what the dialog warns about', async () => {
  const { dest, planning, mk } = await world();
  const x = await mk('X'); const y = await mk('Y');
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  await createTimelineItem(planning.id, 1, attractionItem(x, { optionGroupId: group.id, optionLabel: 'A', startTime: '09:00' }));
  await createTimelineItem(planning.id, 1, attractionItem(y, { optionGroupId: group.id, optionLabel: 'B', startTime: '14:00' }));
  await selectOption(group.id, 'A');
  assert.deepEqual(costs(await snapshot(dest, planning)).overallByCurrency, { INR: 100 }, 'before: only Option A counts');
  const plan = describeOptionGroupDeletion(await getOptionGroup(group.id), await listTimelineItems(planning.id));
  assert.equal(plan.newlyCurrentCount, 1);
  await deleteOptionGroup(group.id);
  assert.deepEqual(costs(await snapshot(dest, planning)).overallByCurrency, { INR: 200 }, 'after: both are ordinary items');
});

await test('C3. a pending group contributed nothing before; its items are ordinary (and counted) after', async () => {
  const { dest, planning, mk } = await world();
  const x = await mk('X'); const y = await mk('Y');
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  await createTimelineItem(planning.id, 1, attractionItem(x, { optionGroupId: group.id, optionLabel: 'A' }));
  await createTimelineItem(planning.id, 1, attractionItem(y, { optionGroupId: group.id, optionLabel: 'B' }));
  assert.deepEqual(costs(await snapshot(dest, planning)).overallByCurrency, {});
  await deleteOptionGroup(group.id);
  assert.deepEqual(costs(await snapshot(dest, planning)).overallByCurrency, { INR: 200 });
});

await test('C4. missing prices are never treated as zero after the change; a selected alternative still prices via its parent', async () => {
  const { dest, planning, mk } = await world();
  const priced = await mk('Priced');
  const unpriced = await createAttraction(dest.id, { place: { name: 'No price' } });
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  await createTimelineItem(planning.id, 1, attractionItem(priced, { optionGroupId: group.id, optionLabel: 'A' }));
  const noPrice = await createTimelineItem(planning.id, 1, { itemType: 'attraction', researchRefType: 'attractions', researchRefId: unpriced.id, optionGroupId: group.id, optionLabel: 'A' });
  const host = await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'Slot', optionGroupId: group.id, optionLabel: 'A' });
  await createItemAlternative(host.id, { researchRefType: 'attractions', researchRefId: priced.id, selected: true, costSelections: { selectedFeeBandIds: [BAND.id] } });
  await selectOption(group.id, 'A');
  const before = costs(await snapshot(dest, planning));
  await deleteOptionGroup(group.id);
  const after = costs(await snapshot(dest, planning));
  assert.deepEqual(after.overallByCurrency, before.overallByCurrency);
  assert.equal(after.overallByCurrency.INR, 200, 'priced item + selected priced alternative');
  assert.ok(after.unestimatedItems.some(u => u.itemId === noPrice.id), 'the unpriced item is reported "not estimated", not counted as 0');
});

// ---------------------------------------------------------------------------
console.log('\nD. Research references, Must-see and Needs Attention');

await test('D1. reverse references: an item in an unselected Option was "referenced only" and becomes "included" once ordinary', async () => {
  const { dest, planning, mk } = await world();
  const x = await mk('X'); const y = await mk('Y');
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  await createTimelineItem(planning.id, 1, attractionItem(x, { optionGroupId: group.id, optionLabel: 'A' }));
  await createTimelineItem(planning.id, 1, attractionItem(y, { optionGroupId: group.id, optionLabel: 'B' }));
  await selectOption(group.id, 'A');
  assert.equal((await refs(dest.id, x.id))[0].status, 'included');
  assert.equal((await refs(dest.id, y.id))[0].status, 'referenced');
  await deleteOptionGroup(group.id);
  assert.equal((await refs(dest.id, x.id)).length, 1, 'still exactly one Planning');
  assert.equal((await refs(dest.id, x.id))[0].status, 'included');
  assert.equal((await refs(dest.id, y.id))[0].status, 'included');
});

await test('D2. Must-see audit and Needs Attention: pending-group warning clears; a Must-see item now counts as included', async () => {
  const { dest, planning, mk } = await world();
  const mustSee = await mk('Tiger Hill', { visitPriority: 'must_see' });
  const other = await mk('Zoo');
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  await createTimelineItem(planning.id, 1, attractionItem(mustSee, { optionGroupId: group.id, optionLabel: 'A' }));
  await createTimelineItem(planning.id, 1, attractionItem(other, { optionGroupId: group.id, optionLabel: 'B' }));

  let snap = await snapshot(dest, planning);
  assert.equal(audit(snap)[0].status, 'unresolved');
  let summary = summarizeNeedsAttention(attention(snap));
  assert.equal(summary.pendingOptions, 1);
  assert.equal(summary.mustSeeUnresolved, 1);

  await deleteOptionGroup(group.id);
  snap = await snapshot(dest, planning);
  assert.equal(audit(snap)[0].status, 'included');
  summary = summarizeNeedsAttention(attention(snap));
  assert.equal(summary.pendingOptions, 0, 'there is no group left to be pending');
  assert.equal(summary.mustSeeUnresolved, 0);
});

await test('D3. items that were hidden competing sequences can now show a genuine schedule conflict — consistent with the dialog\'s warning', async () => {
  const { dest, planning, mk } = await world();
  const x = await mk('X'); const y = await mk('Y');
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  await createTimelineItem(planning.id, 1, attractionItem(x, { optionGroupId: group.id, optionLabel: 'A', startTime: '09:00', plannedDuration: 60 }));
  await createTimelineItem(planning.id, 1, attractionItem(y, { optionGroupId: group.id, optionLabel: 'B', startTime: '09:30', plannedDuration: 60 }));
  await selectOption(group.id, 'A');
  assert.equal(summarizeNeedsAttention(attention(await snapshot(dest, planning))).conflicts, 0, 'competing Options never conflict with each other');
  await deleteOptionGroup(group.id);
  assert.equal(summarizeNeedsAttention(attention(await snapshot(dest, planning))).conflicts, 1);
});

await test('D4. an unavailable (soft-deleted) Research reference on a grouped item survives deletion untouched, with no crash', async () => {
  const { dest, planning, mk } = await world();
  const gone = await mk('Old Monastery');
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  const item = await createTimelineItem(planning.id, 1, attractionItem(gone, { optionGroupId: group.id, optionLabel: 'A' }));
  await selectOption(group.id, 'A');
  await deleteAttraction(gone.id);
  await deleteOptionGroup(group.id);
  const snap = await snapshot(dest, planning);
  assert.equal(snap.timelineItems[0].id, item.id);
  assert.equal(snap.timelineItems[0].researchRefId, gone.id, 'reference left exactly as stored');
  assert.equal(snap.records[gone.id], undefined, 'resolves to nothing — never to another record');
  const c = costs(snap);
  assert.ok(c.unestimatedItems.some(u => u.itemId === item.id), 'unavailable Research => "not estimated", never zero');
  const goneRefs = await refs(dest.id, gone.id); // must not throw; the Planning still references that id
  assert.equal(goneRefs.length, 1);
  assert.equal(goneRefs[0].status, 'included');
});

// ---------------------------------------------------------------------------
console.log('\nE. Records ALREADY orphaned by the old deletion behaviour');

await test('E1. read-time tolerance: legacy orphans are visible, counted, movable and referenced — and the stored records are not rewritten', async () => {
  const { dest, planning, mk } = await world();
  const x = await mk('X', { visitPriority: 'must_see' });
  const group = await createOptionGroup(planning.id, { dayNumber: 2, partLabel: 'Morning' });
  const item = await createTimelineItem(planning.id, 2, attractionItem(x, { optionGroupId: group.id, optionLabel: 'A', startTime: '09:00', plannedDuration: 60 }));
  await selectOption(group.id, 'A');
  await legacyDeleteGroupOnly(group.id); // exactly what the old code did

  const stored = await getOne('timelineItems', item.id);
  assert.equal(stored.optionGroupId, group.id, 'sanity: the legacy orphan really is stored with a dangling group id');

  const snap = await snapshot(dest, planning);
  assert.equal(snap.rawItems[0].optionGroupId, group.id, 'raw read is unchanged — nothing is written on read');
  assert.equal(isOrphanedFromOptionGroup(snap.rawItems[0], snap.optionGroupsById), true);
  assert.equal(snap.timelineItems[0].optionGroupId, null, 'presented as the ordinary item it reverts to');
  assert.ok(visibleItemIds(snap).has(item.id));
  assert.deepEqual(costs(snap).overallByCurrency, { INR: 100 });
  assert.equal(audit(snap)[0].status, 'included');
  assert.equal((await refs(dest.id, x.id))[0].status, 'included');
  assert.deepEqual(await getOne('timelineItems', item.id), stored, 'still byte-for-byte the stored record');
});

await test('E2. editing a legacy orphan (time, notes, day) works and is not blocked; its alternatives are preserved', async () => {
  const { dest, planning, mk } = await world();
  const x = await mk('X'); const y = await mk('Y');
  const group = await createOptionGroup(planning.id, { dayNumber: 2, partLabel: 'Morning' });
  const item = await createTimelineItem(planning.id, 2, attractionItem(x, { optionGroupId: group.id, optionLabel: 'A', startTime: '09:00' }));
  const alt = await createItemAlternative(item.id, { researchRefType: 'attractions', researchRefId: y.id, selected: true });
  await legacyDeleteGroupOnly(group.id);

  await updateTimelineItem(item.id, { notes: 'edited', startTime: '10:00' }); // what the item form / Move form send
  await updateTimelineItem(item.id, { dayNumber: 4 });                        // the Move form's day change
  const snap = await snapshot(dest, planning);
  assert.equal(snap.timelineItems[0].dayNumber, 4);
  assert.equal(snap.timelineItems[0].notes, 'edited');
  assert.equal(snap.alternativesByItemId[item.id][0].id, alt.id);
  assert.equal(snap.alternativesByItemId[item.id][0].selected, true);
  assert.ok(visibleItemIds(snap).has(item.id));
});

await test('E3. malformed or partial relationships never hide or crash anything', async () => {
  const { dest, planning } = await world();
  // Label with no group (cannot be created through the API; craft it directly).
  const malformed = await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'Label only' });
  await put('timelineItems', { ...malformed, optionLabel: 'B' });
  // Group id for a group that never existed.
  const phantom = await createTimelineItem(planning.id, 1, { itemType: 'custom', title: 'Phantom group' });
  await put('timelineItems', { ...phantom, optionGroupId: 'never-existed', optionLabel: 'A' });
  const snap = await snapshot(dest, planning);
  assert.deepEqual([...visibleItemIds(snap)].sort(), [malformed.id, phantom.id].sort());
  assert.equal(detachOrphanedGroupItems(null, null).length, 0);
  assert.equal(detachOrphanedGroupItems([], []).length, 0);
  assert.equal(isOrphanedFromOptionGroup(null, {}), false);
  assert.equal(isOrphanedFromOptionGroup({ optionGroupId: null }, {}), false);
  summarizeNeedsAttention(attention(snap)); // must not throw
});

await test('E4. detachOrphanedGroupItems is pure: non-orphans are the same objects, inputs are not mutated', async () => {
  const group = { id: 'g1', selectedOptionLabel: 'A' };
  const kept = { id: 'i1', optionGroupId: 'g1', optionLabel: 'A' };
  const orphan = { id: 'i2', optionGroupId: 'gone', optionLabel: 'A', notes: 'n' };
  const plain = { id: 'i3', optionGroupId: null, optionLabel: null };
  const input = [kept, orphan, plain];
  const snapshotJson = JSON.stringify(input);
  const out = detachOrphanedGroupItems(input, [group]);
  assert.equal(out[0], kept);
  assert.equal(out[2], plain);
  assert.deepEqual(out[1], { id: 'i2', optionGroupId: null, optionLabel: null, notes: 'n' });
  assert.equal(JSON.stringify(input), snapshotJson);
});

// ---------------------------------------------------------------------------
console.log('\nF. Attaching items to Option groups (no new orphans)');

await test('F1. an item cannot be attached to a deleted, unknown, other-Planning, or other-day group', async () => {
  const { dest, planning, mk } = await world();
  const x = await mk('X');
  const otherPlanning = await createPlanning(dest.id, { name: 'Other', ...TRIP });
  const live = await createOptionGroup(planning.id, { dayNumber: 2, partLabel: 'Morning' });
  const dead = await createOptionGroup(planning.id, { dayNumber: 2, partLabel: 'Gone' });
  const foreign = await createOptionGroup(otherPlanning.id, { dayNumber: 2, partLabel: 'Foreign' });
  await deleteOptionGroup(dead.id);

  await assert.rejects(() => createTimelineItem(planning.id, 2, attractionItem(x, { optionGroupId: dead.id, optionLabel: 'A' })), /no longer exists/);
  await assert.rejects(() => createTimelineItem(planning.id, 2, attractionItem(x, { optionGroupId: 'unknown', optionLabel: 'A' })), /no longer exists/);
  await assert.rejects(() => createTimelineItem(planning.id, 2, attractionItem(x, { optionGroupId: foreign.id, optionLabel: 'A' })), /different Planning/);
  await assert.rejects(() => createTimelineItem(planning.id, 3, attractionItem(x, { optionGroupId: live.id, optionLabel: 'A' })), /group's day/);
  const ok = await createTimelineItem(planning.id, 2, attractionItem(x, { optionGroupId: live.id, optionLabel: 'A' }));
  assert.equal(ok.optionGroupId, live.id);
  assert.equal((await listTimelineItems(planning.id)).length, 1, 'rejected attempts created nothing');
});

await test('F2. update may not re-point an item at a deleted group, but ordinary edits on grouped/orphaned items are unaffected', async () => {
  const { planning, mk } = await world();
  const x = await mk('X');
  const live = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  const dead = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Gone' });
  const item = await createTimelineItem(planning.id, 1, attractionItem(x, { optionGroupId: live.id, optionLabel: 'A' }));
  await deleteOptionGroup(dead.id);
  await assert.rejects(() => updateTimelineItem(item.id, { optionGroupId: dead.id, optionLabel: 'A' }), /no longer exists/);
  const edited = await updateTimelineItem(item.id, { notes: 'fine', startTime: '08:00' });
  assert.equal(edited.optionGroupId, live.id);
  assert.equal(edited.notes, 'fine');
});

// ---------------------------------------------------------------------------
console.log('\nG. Confirmation message');

await test('G1. the dialog states plainly what will happen, for every group shape', async () => {
  const item = (label) => ({ optionLabel: label });
  assert.equal(describeOptionGroupDeletion({ selectedOptionLabel: null }, []).message, 'Delete this Option group? It has no items.');

  const selectedOnly = describeOptionGroupDeletion({ selectedOptionLabel: 'A' }, [item('A'), item('A')]);
  assert.match(selectedOnly.message, /Its 2 items \(Option A\) will stay in the itinerary as regular items\. Nothing is deleted\./);
  assert.equal(selectedOnly.newlyCurrentCount, 0);

  const mixed = describeOptionGroupDeletion({ selectedOptionLabel: 'A' }, [item('A'), item('B'), item('B'), item('C')]);
  assert.equal(mixed.newlyCurrentCount, 3);
  assert.deepEqual(mixed.newlyCurrentOptionLabels, ['B', 'C']);
  assert.match(mixed.message, /All 4 items will stay as regular itinerary items, including 3 items \(Option B, Option C\) that are not currently selected\./);
  assert.match(mixed.message, /start counting toward the day's schedule and costs\. Nothing is deleted\./);

  const pending = describeOptionGroupDeletion({ selectedOptionLabel: null }, [item('A')]);
  assert.match(pending.message, /All 1 item will stay as regular itinerary items, including 1 item \(Option A\) that is not selected yet\./);
});

// ---------------------------------------------------------------------------
console.log('\nH. Moving items, and Phase 1–3 regression');

await test('H1. an item that was in a group can be moved to another day after deletion; its alternatives and reference follow', async () => {
  const { dest, planning, mk } = await world();
  const x = await mk('X'); const y = await mk('Y');
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  const item = await createTimelineItem(planning.id, 1, attractionItem(x, { optionGroupId: group.id, optionLabel: 'A', startTime: '09:00' }));
  const alt = await createItemAlternative(item.id, { researchRefType: 'attractions', researchRefId: y.id, selected: true });
  await selectOption(group.id, 'A');
  await deleteOptionGroup(group.id);
  const costBeforeMove = costs(await snapshot(dest, planning)).overallByCurrency;
  const moved = await updateTimelineItem(item.id, { dayNumber: 3, startTime: '15:00' }); // exactly the Move form's payload
  assert.equal(moved.dayNumber, 3);
  assert.equal(moved.researchRefId, x.id);
  assert.equal((await listAlternativesForItem(item.id))[0].id, alt.id);
  const snap = await snapshot(dest, planning);
  assert.ok(visibleItemIds(snap).has(item.id));
  assert.deepEqual(costs(snap).overallByCurrency, costBeforeMove, 'moving changes no cost');
  assert.deepEqual(costBeforeMove, { INR: 100 }, 'the selected alternative prices the slot (it replaces the parent\'s own price)');
});

await test('H2. moving an ordinary item between days keeps references, costs and conflict detection correct', async () => {
  const { dest, planning, mk } = await world();
  const x = await mk('X'); const y = await mk('Y');
  const a = await createTimelineItem(planning.id, 1, attractionItem(x, { startTime: '09:00', plannedDuration: 60 }));
  await createTimelineItem(planning.id, 2, attractionItem(y, { startTime: '09:30', plannedDuration: 60 }));
  assert.equal(summarizeNeedsAttention(attention(await snapshot(dest, planning))).conflicts, 0, 'different days never conflict');
  await updateTimelineItem(a.id, { dayNumber: 2 });
  assert.equal(summarizeNeedsAttention(attention(await snapshot(dest, planning))).conflicts, 1, 'now on the same day and overlapping');
  assert.ok(checkItemOverlap({ startTime: '09:00', plannedDuration: 60, buffer: 0 }, { startTime: '09:30', plannedDuration: 60, buffer: 0 }));
  assert.deepEqual(costs(await snapshot(dest, planning)).overallByCurrency, { INR: 200 });
  assert.equal((await refs(dest.id, x.id)).length, 1);
});

await test('H3. changing which Option is selected still switches inclusion, costs, audit and references; deleting an alternative/item stays consistent', async () => {
  const { dest, planning, mk } = await world();
  const x = await mk('X', { visitPriority: 'must_see' }); const y = await mk('Y');
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  const ix = await createTimelineItem(planning.id, 1, attractionItem(x, { optionGroupId: group.id, optionLabel: 'A' }));
  await createTimelineItem(planning.id, 1, attractionItem(y, { optionGroupId: group.id, optionLabel: 'B' }));
  for (const [sel, total, mustSeeIncluded] of [['A', 100, true], ['B', 100, false], [null, 0, false]]) {
    await selectOption(group.id, sel);
    const snap = await snapshot(dest, planning);
    assert.deepEqual(costs(snap).overallByCurrency, total ? { INR: total } : {}, `selection=${sel}`);
    assert.equal(audit(snap)[0].status === 'included', mustSeeIncluded, `selection=${sel}`);
    assert.equal((await refs(dest.id, x.id))[0].status === 'included', mustSeeIncluded, `selection=${sel}`);
  }
  await deleteTimelineItem(ix.id);
  assert.deepEqual(await refs(dest.id, x.id), []);
});

await test('H4. date shifts keep every item on its day number; shortening a trip deletes nothing from later days', async () => {
  const { dest, planning, mk } = await world();
  const x = await mk('X');
  await createTimelineItem(planning.id, 5, attractionItem(x));
  const shifted = await updatePlanning(planning.id, { startDate: '2027-01-10', endDate: '2027-01-14' });
  assert.equal(listPlanningDays(shifted).find(d => d.dayNumber === 5).date, '2027-01-14');
  assert.equal((await listTimelineItems(planning.id))[0].dayNumber, 5);
  await updatePlanning(planning.id, { endDate: '2027-01-11' });
  assert.equal((await listTimelineItems(planning.id)).length, 1, 'item on a now out-of-range day is kept');
  assert.equal((await snapshot(dest, shifted)).timelineItems[0].dayNumber, 5);
});

// ---------------------------------------------------------------------------
console.log('\nI. Date-only behaviour (run under UTC, Asia/Kolkata, America/Los_Angeles)');

await test('I1. planningDayDate is a local-calendar function: correct across month/year ends and DST changes', async () => {
  const days = (start, n) => Array.from({ length: n }, (_, i) => planningDayDate({ startDate: start }, i + 1));
  assert.deepEqual(days('2026-12-30', 4), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.deepEqual(days('2026-02-27', 3), ['2026-02-27', '2026-02-28', '2026-03-01']);
  assert.deepEqual(days('2028-02-28', 3), ['2028-02-28', '2028-02-29', '2028-03-01'], 'leap day');
  assert.deepEqual(days('2026-03-07', 3), ['2026-03-07', '2026-03-08', '2026-03-09'], 'US spring-forward (Mar 8 2026)');
  assert.deepEqual(days('2026-10-31', 3), ['2026-10-31', '2026-11-01', '2026-11-02'], 'US fall-back (Nov 1 2026)');
  assert.deepEqual(days('2026-03-28', 3), ['2026-03-28', '2026-03-29', '2026-03-30'], 'EU spring-forward (Mar 29 2026)');
  assert.equal(planningDayDate({ startDate: '' }, 1), null);
});

await test('I2. no production source derives a calendar date from toISOString().slice/split (guards the local-date convention)', async () => {
  const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const offenders = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== '__tests__') walk(full); continue; }
      if (!/\.(js|jsx)$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (/toISOString\(\)\s*\.\s*(slice|substring|substr|split)\s*\(/.test(text)) offenders.push(path.relative(srcRoot, full));
    }
  })(srcRoot);
  assert.deepEqual(offenders, [], 'timestamps (full ISO instants) are fine; date-only values must use local components');
});

await test('I3. the Option-group deletion itself stores only full-instant timestamps and touches no date-only field', async () => {
  const { planning, mk } = await world();
  const x = await mk('X');
  const group = await createOptionGroup(planning.id, { dayNumber: 1, partLabel: 'Morning' });
  const item = await createTimelineItem(planning.id, 1, attractionItem(x, { optionGroupId: group.id, optionLabel: 'A' }));
  await deleteOptionGroup(group.id);
  const stored = await getOne('timelineItems', item.id);
  assert.match(stored.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(stored.dayNumber, 1, 'day association is a day NUMBER, never a calendar date');
  const db = await getDb();
  assert.equal(db.version, 10, 'no schema change');
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
