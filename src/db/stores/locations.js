import { getAll, getOne, put, newId } from '../connection.js';

const STORE = 'locations';

// A Location is a flexible sub-area within a Destination — a city,
// town, island, district, or any other meaningful subdivision the
// person defines. It is deliberately NOT called "City": a destination
// may have zero, one, or many locations, and nothing about this shape
// assumes a strict geographic type.
//
// Records in the 10 research-section stores carry an optional
// `locationId` (see shared.js -> commonMetadata). `locationId: null`
// (or simply absent, for records saved before this existed) means the
// record applies to the whole destination; a set `locationId` scopes
// it to one specific location. A destination with no locations at all
// continues to work exactly as before — nothing here is required.
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
// keep the (now-dangling) id. This is a deliberate minimal first pass;
// reassigning or clearing orphaned references is left for later if it
// turns out to matter in practice.
export async function deleteLocation(id) {
  const existing = await getOne(STORE, id);
  if (!existing || existing.deletedAt) throw new Error('Location not found.');
  const next = { ...existing, deletedAt: new Date().toISOString() };
  await put(STORE, next);
  return next;
}
