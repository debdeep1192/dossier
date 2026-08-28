// This is NAVIGATION METADATA (labels, icons, routes, count-fetchers)
// for the fixed 10-section table of contents on DestinationDetail — it
// does not define storage shape, and nothing here is a "kind" tag
// written onto a record. Each section's actual data shape lives
// entirely in its own db/stores/*.js file.
import { listAttractions } from './db/stores/attractions.js';
import { listRestaurantEntries } from './db/stores/restaurants.js';
import { listAccommodations } from './db/stores/accommodations.js';
import { listTransportEntries } from './db/stores/transport.js';
import { listCostEntries } from './db/stores/costs.js';
import { listPracticalInfoEntries } from './db/stores/practicalInfo.js';
import { listWeatherNotes } from './db/stores/weatherNotes.js';
import { listPackingNotes } from './db/stores/packingNotes.js';
import { listGeneralNotes } from './db/stores/generalNotes.js';
import { listShoppingItems } from './db/stores/shoppingItems.js';
import { listSources } from './db/stores/sources.js';

export const SECTIONS = [
  { key: 'attractions', label: 'Attractions & Activities', icon: '🏛️', path: 'attractions', list: listAttractions },
  { key: 'restaurants', label: 'Restaurants & Food', icon: '🍽️', path: 'restaurants', list: listRestaurantEntries },
  { key: 'accommodations', label: 'Accommodation', icon: '🛏️', path: 'accommodations', list: listAccommodations },
  { key: 'transport', label: 'Transport', icon: '🚌', path: 'transport', list: listTransportEntries },
  { key: 'costs', label: 'Costs & Money', icon: '💰', path: 'costs', list: listCostEntries },
  { key: 'practicalInfo', label: 'Practical Info', icon: '🛂', path: 'practical-info', list: listPracticalInfoEntries },
  { key: 'weatherNotes', label: 'Weather & Best Time', icon: '☀️', path: 'weather', list: listWeatherNotes },
  { key: 'packingNotes', label: 'Packing & Preparation', icon: '🎒', path: 'packing', list: listPackingNotes },
  { key: 'shoppingItems', label: 'Shopping', icon: '🛍️', path: 'shopping', list: listShoppingItems },
  { key: 'generalNotes', label: 'General Notes', icon: '📝', path: 'notes', list: listGeneralNotes },
  { key: 'sources', label: 'Sources & References', icon: '🔗', path: 'sources', list: listSources },
];

export const SECTION_LABELS = Object.fromEntries(SECTIONS.map(s => [s.key, s.label]));
