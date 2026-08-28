import { commonMetadata, emptyPlace } from '../shared.js';
import { getAll } from '../connection.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';

const STORE = 'shops';

export function emptyShop() {
  return { shoppingItemId: null, place: emptyPlace(), openingHours: '', notes: '', priceInfo: '' };
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
