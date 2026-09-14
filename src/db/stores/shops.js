import { commonMetadata, emptyPlace } from '../shared.js';
import { getAll } from '../connection.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';
import { emptyOpeningHours } from '../../lib/openingHours.js';

const STORE = 'shops';

// openingHours uses the same structured day/range model Attractions
// already uses (lib/openingHours.js) — reused, not a new concept, per
// Phase 3 Chunk 4. Earlier shops stored a plain free-text string here;
// see normalizeShop() below for how that's preserved, not discarded.
export function emptyShop() {
  return { shoppingItemId: null, place: emptyPlace(), openingHours: emptyOpeningHours(), openingHoursLegacyText: '', notes: '', priceInfo: '' };
}

export function listShopsForItem(shoppingItemId) {
  return getAll(STORE, 'shoppingItemId', shoppingItemId).then(all => all.filter(s => !s.deletedAt));
}

export function listShopsForDestination(destinationId) {
  return listActive(STORE, destinationId);
}

export function getShop(id) {
  return getActive(STORE, id);
}

export function createShop(destinationId, fields) {
  const record = { ...commonMetadata({ destinationId }), ...emptyShop(), ...fields };
  if (!record.shoppingItemId) throw new Error('A shop must belong to a shopping item.');
  if (!record.place?.name?.trim()) throw new Error('Shop name is required.');
  return save(STORE, record);
}

export function updateShop(id, fields) {
  return patch(STORE, id, fields);
}

export function deleteShop(id) {
  return softDelete(STORE, id);
}

// Backward compatibility: a shop saved before openingHours became a
// structured group array had it as a plain string (e.g. "10am-8pm").
// That string is preserved verbatim in openingHoursLegacyText for
// display, rather than lost or forced into the new structure — the
// person can still see it, and can optionally re-enter it in the
// structured picker next time they edit.
export function normalizeShop(record) {
  if (!record) return record;
  if (typeof record.openingHours === 'string') {
    return {
      ...record,
      openingHoursLegacyText: record.openingHours,
      openingHours: emptyOpeningHours(),
    };
  }
  return record;
}
