import { getAll, getOne, put, newId } from '../connection.js';

const STORE = 'journeys';

// A Journey represents travel between two already-created cities/
// locations within one destination — "along the way from Bangkok to
// Phuket" (item 7 of the spec). This supersedes an earlier draft that
// tried to represent this as a synthetic `journey:<fromId>:<toId>`
// value stored directly in a record's `locationId` — that was reverted
// (see git history / DOSSIER_HANDOVER.md) because it overloaded
// `locationId` with a value that isn't a real location id, which is a
// semantic and maintenance hazard (anything that naively resolves
// `locationId` against the locations list would silently fail on it).
//
// Design: `locationId` on every record continues to mean ONLY "a real
// location id, or null" — nothing else, ever. A journey is its own
// small entity here, and a record that wants journey context carries
// a SEPARATE, optional `journeyId` field — added only to the shape of
// sections where it's actually useful (Transport, Attractions), never
// to commonMetadata(), so sections that have no use for journey
// context (e.g. Packing, General Notes) are completely unaffected.
//
// A journey is ordered (fromLocationId -> toLocationId) since "Bangkok
// to Phuket" and "Phuket to Bangkok" are meaningfully different trips
// (different fares, durations, directions) — unlike the old pseudo-id
// design, which collapsed both directions into one identifier.
export function emptyJourney() {
  return { fromLocationId: null, toLocationId: null, notes: '' };
}

export function listJourneys(destinationId) {
  return getAll(STORE, 'destinationId', destinationId).then(all => all.filter(j => !j.deletedAt));
}

export async function getJourney(id) {
  const record = await getOne(STORE, id);
  if (!record || record.deletedAt) return null;
  return record;
}

export async function createJourney(destinationId, { fromLocationId, toLocationId, notes } = {}) {
  if (!fromLocationId || !toLocationId) throw new Error('Choose both a starting and an ending city/location.');
  if (fromLocationId === toLocationId) throw new Error('A journey needs two different cities/locations.');
  const now = new Date().toISOString();
  const record = {
    id: newId(),
    destinationId,
    fromLocationId,
    toLocationId,
    notes: notes || '',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await put(STORE, record);
  return record;
}

export async function updateJourney(id, updates) {
  const existing = await getOne(STORE, id);
  if (!existing || existing.deletedAt) throw new Error('Journey not found.');
  const next = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  if (next.fromLocationId === next.toLocationId) throw new Error('A journey needs two different cities/locations.');
  await put(STORE, next);
  return next;
}

// Soft-delete only, matching every other store. Any record referencing
// this journey via `journeyId` keeps the (now-dangling) id — the same
// deliberate minimal-first-pass choice already made for locations.js's
// deleteLocation(). See handleLocationDeleted() below for the one case
// this module DOES handle explicitly (a location itself being deleted).
export async function deleteJourney(id) {
  const existing = await getOne(STORE, id);
  if (!existing || existing.deletedAt) throw new Error('Journey not found.');
  const next = { ...existing, deletedAt: new Date().toISOString() };
  await put(STORE, next);
  return next;
}

// Renaming a location is always safe for journeys: they reference it
// by id, and describeJourney() below reads the current name at display
// time — nothing needs to change here when a location is renamed.

// Deleting a location, though, would leave any journey that references
// it pointing at a location that no longer resolves to a name. Rather
// than leaving that silently broken (which the spec explicitly asks us
// to avoid — "Handle rename/delete safely and explicitly. Do not
// silently leave broken references."), the location deletion flow
// calls this first so the person is told exactly what depends on the
// location before it's removed, and any journey that used it is
// soft-deleted alongside it (a journey with a missing endpoint isn't a
// journey anymore — it's exactly as retired as the location it needed).
export async function listJourneysUsingLocation(destinationId, locationId) {
  const all = await listJourneys(destinationId);
  return all.filter(j => j.fromLocationId === locationId || j.toLocationId === locationId);
}

export async function retireJourneysUsingLocation(destinationId, locationId) {
  const affected = await listJourneysUsingLocation(destinationId, locationId);
  await Promise.all(affected.map(j => deleteJourney(j.id)));
  return affected;
}

export function describeJourney(journey, locations) {
  if (!journey) return '';
  const from = locations.find(l => l.id === journey.fromLocationId);
  const to = locations.find(l => l.id === journey.toLocationId);
  return `${from ? from.name : 'Unknown'} → ${to ? to.name : 'Unknown'}`;
}
