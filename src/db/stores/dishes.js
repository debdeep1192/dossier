import { commonMetadata } from '../shared.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';

const STORE = 'dishes';

// A Dish is a food item worth remembering independently of any one
// restaurant — e.g. "Momos" in Darjeeling, associated with a
// location/destination and, optionally, with one or more specific
// restaurants that serve a good version of it (see item 8: "restaurants
// and dishes are related but separate... A dish may exist independently
// even before I know which restaurant serves the best version").
//
// `restaurantIds` is a plain array of restaurant record ids — a dish
// can have zero, one, or several. Nothing here requires a restaurant to
// exist first, and nothing here requires a dish to ever be linked to
// one — both directions of item 8's requirement.
export function emptyDish() {
  return {
    name: '',
    cuisine: '',
    price: null, // Money | null — approximate price where relevant
    notes: '',
    restaurantIds: [],
  };
}

export function listDishes(destinationId) {
  return listActive(STORE, destinationId);
}

export function getDish(id) {
  return getActive(STORE, id);
}

export async function createDish(destinationId, fields) {
  const record = { ...commonMetadata({ destinationId }), ...emptyDish(), ...fields };
  if (!record.name?.trim()) throw new Error('Give this dish a name.');
  return save(STORE, record);
}

export function updateDish(id, fields) {
  return patch(STORE, id, fields);
}

export function deleteDish(id) {
  return softDelete(STORE, id);
}

// Link/unlink helpers — kept as small, explicit operations rather than
// expecting every caller to hand-edit the restaurantIds array
// correctly (dedup, etc).
export async function linkDishToRestaurant(dishId, restaurantId) {
  const dish = await getActive(STORE, dishId);
  if (!dish) throw new Error('Dish not found.');
  if (dish.restaurantIds.includes(restaurantId)) return dish;
  return patch(STORE, dishId, { restaurantIds: [...dish.restaurantIds, restaurantId] });
}

export async function unlinkDishFromRestaurant(dishId, restaurantId) {
  const dish = await getActive(STORE, dishId);
  if (!dish) throw new Error('Dish not found.');
  return patch(STORE, dishId, { restaurantIds: dish.restaurantIds.filter(id => id !== restaurantId) });
}

// For a given restaurant, which dishes (if any) are linked to it — used
// by the Restaurants page to show "dishes known to be good here"
// without Dishes needing its own dedicated browsing page yet.
export async function listDishesForRestaurant(destinationId, restaurantId) {
  const all = await listDishes(destinationId);
  return all.filter(d => d.restaurantIds.includes(restaurantId));
}
