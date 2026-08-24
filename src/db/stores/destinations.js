import { getAll, getOne, put, newId } from '../connection.js';

const STORE = 'destinations';

export async function listDestinations() {
  const all = await getAll(STORE);
  return all.filter(d => !d.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getDestination(id) {
  const record = await getOne(STORE, id);
  if (!record || record.deletedAt) return null;
  return record;
}

export async function createDestination({ name, overview }) {
  if (!name || !name.trim()) throw new Error('Destination name is required.');
  const now = new Date().toISOString();
  const record = {
    id: newId(),
    name: name.trim(),
    overview: overview || '',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await put(STORE, record);
  return record;
}

export async function updateDestination(id, updates) {
  const existing = await getOne(STORE, id);
  if (!existing || existing.deletedAt) throw new Error('Destination not found.');
  const next = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  await put(STORE, next);
  return next;
}

export async function deleteDestination(id) {
  const existing = await getOne(STORE, id);
  if (!existing || existing.deletedAt) throw new Error('Destination not found.');
  const next = { ...existing, deletedAt: new Date().toISOString() };
  await put(STORE, next);
  return next;
}
