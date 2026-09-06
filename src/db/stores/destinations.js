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

export async function createDestination({ name, overview, defaultCurrency }) {
  if (!name || !name.trim()) throw new Error('Destination name is required.');
  const now = new Date().toISOString();
  const chosenDefault = (defaultCurrency || 'INR').trim().toUpperCase();
  const record = {
    id: newId(),
    name: name.trim(),
    overview: overview || '',
    // The currency new monetary fields for this destination default to,
    // until the person picks otherwise per-field. INR unless the person
    // chose something else at creation time (item 11/12 of the spec).
    // Existing destinations saved before this field existed simply have
    // no `defaultCurrency` key — getDestinationDefaultCurrency() in
    // currency.js treats that the same as 'INR', so nothing needs to be
    // backfilled.
    defaultCurrency: chosenDefault,
    // The chosen default is always immediately available as a usable
    // currency (getCurrencyOptions reads CORE_CURRENCIES + this array)
    // — a destination created with KGS as its default shouldn't require
    // a separate "add KGS as a currency" step before it can be used.
    // INR/USD are never listed here since getCurrencyOptions() already
    // guarantees them unconditionally.
    // INR/USD are checked as literals here (not imported from
    // currency.js's CORE_CURRENCIES) specifically to avoid a circular
    // import — currency.js already imports getDestination/
    // updateDestination from this file. Keep these two literals in
    // sync with CORE_CURRENCIES in currency.js if that ever changes.
    currencies: ['INR', 'USD'].includes(chosenDefault) ? [] : [chosenDefault],
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
