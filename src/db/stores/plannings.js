import { newId } from '../connection.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';

const STORE = 'plannings';

// A Planning is a specific trip built using a destination's Research —
// Tour Planning, Chunk 1 (foundation only: no timeline items, options,
// alternatives, cost calculation, or Must-see audit yet — those are
// later chunks per the approved design).
//
// destinationId is required — a Planning always belongs to exactly one
// existing Research destination (convention-only reference, same as
// every other cross-store id in this app; no relational integrity is
// enforced at the IndexedDB level here either).
//
// travellerIds references existing `people` records by id — Planning
// never copies/duplicates a Person's or a Research record's data, per
// the approved design's explicit "reference, don't duplicate" rule.
export function emptyPlanning() {
  return { destinationId: '', name: '', startDate: '', endDate: '', notes: '', travellerIds: [] };
}

export function listPlannings(destinationId) {
  return listActive(STORE, destinationId);
}

export function getPlanning(id) {
  return getActive(STORE, id);
}

function assertValid(fields) {
  if (!fields.destinationId) throw new Error('Destination is required.');
  if (!fields.name?.trim()) throw new Error('Planning name is required.');
  if (!fields.startDate) throw new Error('Start date is required.');
  if (!fields.endDate) throw new Error('End date is required.');
  if (fields.endDate < fields.startDate) throw new Error('End date cannot be before start date.');
}

export async function createPlanning(destinationId, fields) {
  const merged = { ...emptyPlanning(), ...fields, destinationId };
  assertValid(merged);
  const now = new Date().toISOString();
  const record = {
    id: newId(),
    destinationId,
    name: merged.name.trim(),
    startDate: merged.startDate,
    endDate: merged.endDate,
    notes: merged.notes || '',
    travellerIds: merged.travellerIds || [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  return save(STORE, record);
}

export async function updatePlanning(id, fields) {
  const existing = await getActive(STORE, id);
  if (!existing) throw new Error('Planning not found.');
  const merged = { ...existing, ...fields };
  assertValid(merged);
  // Only include `name` in the patch when the caller actually provided
  // it — patch() spreads its updates directly over the existing record
  // (see crud.js), so `{ name: undefined }` would silently overwrite an
  // untouched name with undefined rather than leaving it alone.
  const updates = { ...fields };
  if (fields.name !== undefined) updates.name = fields.name.trim();
  return patch(STORE, id, updates);
}

export function deletePlanning(id) {
  return softDelete(STORE, id);
}

// Derived Days (Chunk 1 scope): no planningDays store exists or is
// planned — day numbers and their calendar dates are always computed
// fresh from startDate, never persisted. This is what keeps "Day 1"
// stable when startDate changes: nothing stored ever refers to a
// calendar date, only a dayNumber, and dayNumber -> calendar date is a
// pure function of the Planning's current startDate. Future chunks that
// attach real content to a day (timeline items) will key that content
// by dayNumber, never by calendar date, for the same reason.
export function planningDayCount(planning) {
  if (!planning?.startDate || !planning?.endDate) return 0;
  const start = new Date(`${planning.startDate}T00:00:00`);
  const end = new Date(`${planning.endDate}T00:00:00`);
  const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 ? diffDays + 1 : 0;
}

export function planningDayDate(planning, dayNumber) {
  if (!planning?.startDate) return null;
  const start = new Date(`${planning.startDate}T00:00:00`);
  start.setDate(start.getDate() + (dayNumber - 1));
  return start.toISOString().slice(0, 10); // YYYY-MM-DD, matching the existing date convention
}

export function listPlanningDays(planning) {
  const count = planningDayCount(planning);
  return Array.from({ length: count }, (_, i) => {
    const dayNumber = i + 1;
    return { dayNumber, date: planningDayDate(planning, dayNumber) };
  });
}
