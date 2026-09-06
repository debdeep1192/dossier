import { commonMetadata, emptyMoney } from '../shared.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';

const STORE = 'restaurants';

// A Restaurant is always place-based (has a place.name) — see
// db/stores/dishes.js for independent food/dish items, which are a
// separate entity with a many-to-many link to restaurants (item 10).
//
// REVERT NOTE: an earlier draft of the Dishes work changed this
// store's default from `place: null` to `place: emptyPlace()` while
// exploring the split. That change was never approved and has been
// reverted — `place: null` remains the default here, exactly as in
// the original Phase 1 shape, so no behavior changes for this store
// beyond what's described below.
//
// BACKWARD COMPATIBILITY: earlier versions of this store also allowed
// a "no place, just a dishName" record (a general food note with no
// restaurant, before Dishes existed as its own entity). Those older
// records are NOT migrated or deleted — they remain exactly as saved
// and still display correctly (see isPlaceBased() below, still used by
// the UI to tell the two shapes apart on read). New dish-only notes
// should be created as Dishes instead; `dishName`/`mustTryDishes` stay
// in this shape only so existing data keeps working unchanged.
export function emptyRestaurantEntry() {
  return {
    place: null,
    dishName: '', // legacy only — see note above; new records should use Dishes instead
    cuisine: '',
    price: emptyMoney(),
    mustTryDishes: [], // string[] — legacy free-text list; new dish-restaurant links belong in dishes.js instead
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
  if (!hasPlaceName && !hasDishName) throw new Error('Give this restaurant a name.');
  return save(STORE, record);
}

export function updateRestaurantEntry(id, fields) {
  return patch(STORE, id, fields);
}

export function deleteRestaurantEntry(id) {
  return softDelete(STORE, id);
}

// Still used to render older dish-only records (no place set)
// alongside proper place-based restaurants without treating them as
// broken — see the backward-compatibility note above.
export function isPlaceBased(entry) {
  return Boolean(entry.place && entry.place.name);
}
