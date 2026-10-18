import { getAll, getOne, newId, put, tx } from '../connection.js';

const STORE = 'planningOptionGroups';

// An Itinerary Option group — Tour Planning, Chunk 3. Represents a set
// of competing sequences ("Option A", "Option B", ...) for one part of
// one Planning day, e.g. "Day 3, Morning: Option A (Attraction A ->
// Attraction B) vs Option B (Attraction C)".
//
// This is deliberately a DIFFERENT mechanism from itemAlternatives
// (see itemAlternatives.js): a Group/Option is an alternative SEQUENCE
// of timeline items for a day-part; an Item Alternative is an
// alternative Research choice WITHIN one already-placed timeline slot
// (e.g. Restaurant A/B for one Lunch item). The two are not unified
// into one generic "alternatives" concept, per the approved design.
//
// The actual content of each Option lives on the timelineItems rows
// that reference this group's id via their own optionGroupId +
// optionLabel fields (see timelineItems.js) — this store only holds
// the group's identity (which day/part it's for) and which Option
// label, if any, is currently selected.
//
// selectedOptionLabel: null means "Selection pending" — genuinely
// unresolved, and must stay representable; nothing here forces a
// choice. Parts are free-form labels (Morning/Afternoon/Evening or any
// custom string), not a fixed enum, and different parts on the same
// day are entirely independent groups.
export function emptyOptionGroup() {
  return { dayNumber: null, partLabel: '', selectedOptionLabel: null };
}

export async function listOptionGroupsForPlanning(planningId) {
  const all = await getAll(STORE, 'planningId', planningId);
  return all.filter(r => !r.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getOptionGroup(id) {
  const record = await getOne(STORE, id);
  if (!record || record.deletedAt) return null;
  return record;
}

function assertValid(fields) {
  if (!fields.planningId) throw new Error('Planning is required.');
  if (!fields.dayNumber || fields.dayNumber < 1) throw new Error('A valid day is required.');
  if (!fields.partLabel?.trim()) throw new Error('A part label is required (e.g. Morning, Afternoon, or a custom name).');
}

export async function createOptionGroup(planningId, fields) {
  const merged = { ...emptyOptionGroup(), ...fields, planningId };
  assertValid(merged);
  const now = new Date().toISOString();
  const record = {
    id: newId(),
    planningId,
    dayNumber: merged.dayNumber,
    partLabel: merged.partLabel.trim(),
    selectedOptionLabel: merged.selectedOptionLabel || null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await put(STORE, record);
  return record;
}

// Sets (or clears, with null) which Option label is the current
// selection for this group. Clearing it back to null is exactly how a
// previously-resolved part becomes "Selection pending" again — no
// separate state machine needed, the same as the Must-see audit's own
// "deselecting reopens the warning" behavior described in the approved
// design (that audit is a later chunk, but the same reasoning applies
// here: state is read fresh, never cached elsewhere).
export async function selectOption(groupId, optionLabel) {
  const existing = await getOne(STORE, groupId);
  if (!existing || existing.deletedAt) throw new Error('Option group not found.');
  const next = { ...existing, selectedOptionLabel: optionLabel || null, updatedAt: new Date().toISOString() };
  await put(STORE, next);
  return next;
}

// Deletes an Option group WITHOUT deleting or hiding any of its items.
//
// Intended behaviour (it is what the confirmation dialog promises —
// "its item(s) will remain but will no longer belong to any Option" —
// and what the page always documented): every item that belonged to
// the group reverts to an ordinary, ungrouped timeline item, keeping
// its day, time, duration, buffer, notes, status, costs, Research
// reference and its item Alternatives (which hang off the item, not
// the group, so they stay valid). Only the two fields that tie an item
// to the now-deleted group — optionGroupId and optionLabel — are
// cleared, because that relationship is the one thing that genuinely
// becomes invalid.
//
// Previously this only soft-deleted the group row, leaving its items
// active but pointing at a group that no longer exists: the Planning
// page then never rendered them (grouped items are only reached
// through an active group), and the cost/audit/conflict inclusion
// rules dropped them too. See lib/optionGroupIntegrity.js.
//
// Atomic: the group's soft-delete and every item's detachment happen
// in ONE readwrite transaction over both stores, so there is no
// moment where the group is gone but its items are still pointing at
// it (or vice versa), and any failure rolls the whole thing back. An
// empty group, or a group whose items were all already deleted, simply
// has nothing to detach. Deleting an already-deleted/unknown group
// still throws the same 'Record not found.' as every other delete and
// changes nothing.
export function deleteOptionGroup(id) {
  return tx([STORE, 'timelineItems'], 'readwrite', (stores) => new Promise((resolve, reject) => {
    const fail = (error) => {
      // Roll back anything already queued in this transaction.
      try { stores[STORE].transaction.abort(); } catch { /* transaction already finished */ }
      reject(error);
    };
    const groupRequest = stores[STORE].get(id);
    groupRequest.onerror = () => fail(groupRequest.error);
    groupRequest.onsuccess = () => {
      const group = groupRequest.result;
      if (!group || group.deletedAt) { fail(new Error('Record not found.')); return; }
      const itemsRequest = stores.timelineItems.index('planningId').getAll(group.planningId);
      itemsRequest.onerror = () => fail(itemsRequest.error);
      itemsRequest.onsuccess = () => {
        const now = new Date().toISOString();
        for (const item of itemsRequest.result) {
          if (item.deletedAt || item.optionGroupId !== id) continue;
          stores.timelineItems.put({ ...item, optionGroupId: null, optionLabel: null, updatedAt: now });
        }
        const deleted = { ...group, deletedAt: now };
        stores[STORE].put(deleted);
        resolve(deleted);
      };
    };
  }));
}
