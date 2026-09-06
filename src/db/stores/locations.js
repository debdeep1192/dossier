import { getAll, getOne, put, newId } from '../connection.js';

const STORE = 'locations';

// A Location is a flexible sub-area within a Destination — a city,
// town, island, district, or any other meaningful subdivision the
// person defines. It is deliberately NOT called "City" in the data
// model (the product concept is "City", but a Location can also be a
// town/island/region/etc — see item 3 of the spec): a destination may
// have zero, one, or many locations, and nothing about this shape
// assumes a strict geographic type.
//
// Records in the section stores carry an optional `locationId` (see
// shared.js -> commonMetadata). `locationId: null` (or simply absent,
// for records saved before this existed) means the record applies to
// the whole destination; a set `locationId` scopes it to one specific
// location. A destination with no locations at all continues to work
// exactly as before — nothing here is required.
export function emptyLocation() {
  return { name: '', lat: null, lng: null };
}

export async function listLocations(destinationId) {
  const all = await getAll(STORE, 'destinationId', destinationId);
  return all.filter(l => !l.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getLocation(id) {
  const record = await getOne(STORE, id);
  if (!record || record.deletedAt) return null;
  return record;
}

export async function createLocation(destinationId, { name, lat, lng } = {}) {
  if (!name || !name.trim()) throw new Error('Location name is required.');
  const now = new Date().toISOString();
  const record = {
    id: newId(),
    destinationId,
    name: name.trim(),
    lat: lat ?? null,
    lng: lng ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await put(STORE, record);
  return record;
}

export async function updateLocation(id, updates) {
  const existing = await getOne(STORE, id);
  if (!existing || existing.deletedAt) throw new Error('Location not found.');
  const next = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  await put(STORE, next);
  return next;
}

// Soft-delete only, matching every other store. Note: this does not
// touch records that reference this location via `locationId` — they
// keep the (now-dangling) id (a deliberate minimal first pass; see
// db/stores/journeys.js for the one reference type that IS handled
// explicitly — journeys using this location, via
// retireJourneysUsingLocation(), which callers of deleteLocation
// should invoke first; see DestinationDetail.jsx).
export async function deleteLocation(id) {
  const existing = await getOne(STORE, id);
  if (!existing || existing.deletedAt) throw new Error('Location not found.');
  const next = { ...existing, deletedAt: new Date().toISOString() };
  await put(STORE, next);
  return next;
}

// Given a record's `locationId` (a real location id, or null for
// "whole destination") and the destination's full location list,
// returns a short human-readable description of where the record
// applies. This ONLY handles the two real cases — `locationId` never
// holds anything else (see db/stores/journeys.js for how journey
// context is represented separately, via each record's own optional
// `journeyId` field, not through this function or through
// `locationId`).
export function describeLocationContext(locationId, locations) {
  if (locationId) {
    const loc = locations.find(l => l.id === locationId);
    return loc ? loc.name : 'Specific location';
  }
  return 'Whole destination';
}
