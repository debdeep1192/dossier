import { getAll, getOne, put, remove as removeRecord } from '../connection.js';
import { touchMetadata } from '../shared.js';

// This is storage PLUMBING shared across sections — open a connection,
// read/write a store, filter soft-deletes — not a shared data shape.
// Every section's own store file (attractions.js, restaurants.js, ...)
// still defines its own create()/update() with its own explicit field
// list; this module never sees or cares what a section's fields are.
// Analogous to sharing a `db.query()` helper across separate SQL tables
// without those tables becoming "the same model."

export async function listActive(storeName, destinationId) {
  const all = await getAll(storeName, 'destinationId', destinationId);
  return all.filter(r => !r.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getActive(storeName, id) {
  const record = await getOne(storeName, id);
  if (!record || record.deletedAt) return null;
  return record;
}

export async function save(storeName, record) {
  await put(storeName, record);
  return record;
}

export async function patch(storeName, id, updates) {
  const existing = await getOne(storeName, id);
  if (!existing || existing.deletedAt) throw new Error('Record not found.');
  const next = touchMetadata({ ...existing, ...updates });
  await put(storeName, next);
  return next;
}

export async function softDelete(storeName, id) {
  const existing = await getOne(storeName, id);
  if (!existing || existing.deletedAt) throw new Error('Record not found.');
  const next = { ...existing, deletedAt: new Date().toISOString() };
  await put(storeName, next);
  return next;
}

export { removeRecord as hardDelete };
