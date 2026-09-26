import { getAll, getOne, newId, put } from '../connection.js';
import { softDelete } from './crud.js';

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

export function deleteOptionGroup(id) {
  return softDelete(STORE, id);
}
