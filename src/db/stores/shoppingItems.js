import { commonMetadata } from '../shared.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';

const STORE = 'shoppingItems';

// "What to buy" — the shops that sell it live in the separate `shops`
// store, linked by shoppingItemId (see shops.js). Kept as two stores
// rather than nesting shops inside the item record so a shop can be
// added/edited/removed independently without rewriting the whole item.
export function emptyShoppingItem() {
  return { name: '', notes: '' };
}

export function listShoppingItems(destinationId) {
  return listActive(STORE, destinationId);
}

export function getShoppingItem(id) {
  return getActive(STORE, id);
}

export function createShoppingItem(destinationId, fields) {
  const record = { ...commonMetadata({ destinationId }), ...emptyShoppingItem(), ...fields };
  if (!record.name?.trim()) throw new Error('Give this item a name.');
  return save(STORE, record);
}

export function updateShoppingItem(id, fields) {
  return patch(STORE, id, fields);
}

export function deleteShoppingItem(id) {
  return softDelete(STORE, id);
}
