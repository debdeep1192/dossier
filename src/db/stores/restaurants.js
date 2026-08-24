import { commonMetadata, emptyMoney } from '../shared.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';

const STORE = 'restaurants';

// place stays null for a general food/dish note with no specific
// restaurant (e.g. "try the hoppers here"). dishName is the identifying
// label in that case; when place is set, place.name is the identifying
// label instead. The UI decides which mode it's in based on whether
// place is set, not a separate "kind" flag.
export function emptyRestaurantEntry() {
  return {
    place: null,
    dishName: '',
    cuisine: '',
    price: emptyMoney(),
    mustTryDishes: [], // string[]
    dietaryNotes: '',
  };
}

export function listRestaurantEntries(destinationId) {
  return listActive(STORE, destinationId);
}

export function getRestaurantEntry(id) {
  return getActive(STORE, id);
}

export function createRestaurantEntry(destinationId, fields) {
  const record = { ...commonMetadata({ destinationId }), ...emptyRestaurantEntry(), ...fields };
  const hasPlaceName = record.place?.name?.trim();
  const hasDishName = record.dishName?.trim();
  if (!hasPlaceName && !hasDishName) throw new Error('Give this a place name or a dish/food note name.');
  return save(STORE, record);
}

export function updateRestaurantEntry(id, fields) {
  return patch(STORE, id, fields);
}

export function deleteRestaurantEntry(id) {
  return softDelete(STORE, id);
}

export function isPlaceBased(entry) {
  return Boolean(entry.place && entry.place.name);
}
