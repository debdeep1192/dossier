// This is NAVIGATION METADATA (labels, icons, routes, count-fetchers)
// for the section table of contents on DestinationDetail — it does not
// define storage shape, and nothing here is a "kind" tag written onto
// a record. Each section's actual data shape lives entirely in its own
// db/stores/*.js file.
//
// NOTE on Costs: the standalone "Costs & Money" section was retired
// from the UI (no longer listed here, no longer reachable via
// navigation or Quick Add) because costs are now recorded on the
// record they belong to instead (an attraction's fee, a restaurant's
// price, a transport fare, etc.) — see db/stores/costs.js for the full
// rationale and status. The underlying `costs` store, its CRUD
// functions, and any data already saved there are UNTOUCHED and still
// fully readable — this is a UI-level retirement, not a data deletion.
import { listAttractions } from './db/stores/attractions.js';
import { listRestaurantEntries } from './db/stores/restaurants.js';
import { listDishes } from './db/stores/dishes.js';
import { listAccommodations } from './db/stores/accommodations.js';
import { listTransportEntries } from './db/stores/transport.js';
import { listPracticalInfoEntries } from './db/stores/practicalInfo.js';
import { listWeatherNotes } from './db/stores/weatherNotes.js';
import { listPackingNotes } from './db/stores/packingNotes.js';
import { listGeneralNotes } from './db/stores/generalNotes.js';
import { listShoppingItems } from './db/stores/shoppingItems.js';
import { listSources } from './db/stores/sources.js';

export const SECTIONS = [
  { key: 'attractions', label: 'Attractions & Activities', icon: '🏛️', path: 'attractions', list: listAttractions },
  { key: 'restaurants', label: 'Restaurants & Food', icon: '🍽️', path: 'restaurants', list: listRestaurantEntries },
  { key: 'dishes', label: 'Dishes', icon: '🍜', path: 'dishes', list: listDishes },
  { key: 'accommodations', label: 'Accommodation', icon: '🛏️', path: 'accommodations', list: listAccommodations },
  { key: 'transport', label: 'Transport', icon: '🚌', path: 'transport', list: listTransportEntries },
  { key: 'practicalInfo', label: 'Practical Info', icon: '🛂', path: 'practical-info', list: listPracticalInfoEntries },
  { key: 'weatherNotes', label: 'Weather & Best Time', icon: '☀️', path: 'weather', list: listWeatherNotes },
  { key: 'packingNotes', label: 'Packing & Preparation', icon: '🎒', path: 'packing', list: listPackingNotes },
  { key: 'shoppingItems', label: 'Shopping', icon: '🛍️', path: 'shopping', list: listShoppingItems },
  { key: 'generalNotes', label: 'General Notes', icon: '📝', path: 'notes', list: listGeneralNotes },
  { key: 'sources', label: 'Sources & References', icon: '🔗', path: 'sources', list: listSources },
];

export const SECTION_LABELS = Object.fromEntries(SECTIONS.map(s => [s.key, s.label]));
