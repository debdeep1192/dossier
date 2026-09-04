// ============================================================
// Quick Add registry — configuration driving the universal
// "+ Add to Dossier" flow (see components/QuickAddModal.jsx).
//
// This deliberately reuses, rather than duplicates, what already
// exists:
//   - the same create* functions each section page already calls
//     (attractions.js, restaurants.js, ...) — a quick-captured record
//     and a record made from the full section form are created by the
//     exact same function, so they are indistinguishable once saved,
//     the same principle intake.js's acceptCandidate() already follows
//     for imported records (see CREATORS there).
//   - sectionRegistry.js's existing labels/icons, so the type picker
//     doesn't invent a second naming scheme.
//
// Each entry describes ONLY what quick capture needs: the 1-3 fields
// worth asking for up front, and how to turn what the person typed
// into the `fields` object the section's create function expects. It
// does NOT redefine or replace the section's full field shape — the
// full shape still lives entirely in db/stores/<section>.js.
// ============================================================
import { SECTIONS } from './sectionRegistry.js';
import { createAttraction } from './db/stores/attractions.js';
import { createRestaurantEntry } from './db/stores/restaurants.js';
import { createAccommodation } from './db/stores/accommodations.js';
import { createTransportEntry } from './db/stores/transport.js';
import { createCostEntry } from './db/stores/costs.js';
import { createPracticalInfoEntry } from './db/stores/practicalInfo.js';
import { createWeatherNote } from './db/stores/weatherNotes.js';
import { createPackingNote } from './db/stores/packingNotes.js';
import { createGeneralNote } from './db/stores/generalNotes.js';
import { createShoppingItem } from './db/stores/shoppingItems.js';
import { createSource } from './db/stores/sources.js';

const LABELS = Object.fromEntries(SECTIONS.map(s => [s.key, s.label]));
const ICONS = Object.fromEntries(SECTIONS.map(s => [s.key, s.icon]));

// `quickFields` describes the minimal capture inputs, in display order.
// Each field is one of:
//   { kind: 'name', key, placeholder }   -> feeds a `{ name }` object
//                                            (e.g. place.name) or a
//                                            plain string field
//   { kind: 'note', key, placeholder }   -> a free-text note field
// `buildFields(values)` turns the raw { key: string } values from
// those inputs into the exact `fields` object the section's create
// function expects — this is the one place quick-capture's simple
// strings get reshaped into each section's real shape (e.g. wrapping a
// name into `{ place: { ...emptyPlace(), name } }`).
export const QUICK_ADD_TYPES = [
  {
    key: 'attractions',
    label: LABELS.attractions,
    icon: ICONS.attractions,
    create: createAttraction,
    quickFields: [
      { kind: 'name', key: 'placeName', placeholder: 'Place name, e.g. Batasia Loop' },
      { kind: 'note', key: 'note', placeholder: 'Quick note — what makes this worth remembering?' },
    ],
    buildFields: (v) => ({ place: { name: v.placeName || '' }, description: v.note || '' }),
  },
  {
    key: 'restaurants',
    label: LABELS.restaurants,
    icon: ICONS.restaurants,
    create: createRestaurantEntry,
    quickFields: [
      { kind: 'name', key: 'placeName', placeholder: 'Restaurant or dish name' },
      { kind: 'note', key: 'note', placeholder: 'Quick note — cuisine, must-try dish, etc.' },
    ],
    // restaurants.js accepts either a specific place (place.name set)
    // or a general food/dish note with no particular restaurant
    // (dishName set instead) — see isPlaceBased() there. Quick capture
    // doesn't force the person to pick which one up front: whatever
    // they typed into the single name field becomes place.name, since
    // "a specific place" is the more common case; a person adding a
    // dish-only note can leave the name field blank and use the note
    // field alone (createRestaurantEntry already requires one of the
    // two, matching this behaviour).
    buildFields: (v) => ({
      place: v.placeName ? { name: v.placeName } : null,
      dishName: v.placeName ? '' : (v.note || ''),
      dietaryNotes: v.placeName ? (v.note || '') : '',
    }),
  },
  {
    key: 'accommodations',
    label: LABELS.accommodations,
    icon: ICONS.accommodations,
    create: createAccommodation,
    quickFields: [
      { kind: 'name', key: 'placeName', placeholder: 'Hotel / guesthouse name' },
      { kind: 'note', key: 'note', placeholder: 'Quick note — room type, price, anything useful' },
    ],
    buildFields: (v) => ({ place: { name: v.placeName || '' }, amenityNotes: v.note || '' }),
  },
  {
    key: 'transport',
    label: LABELS.transport,
    icon: ICONS.transport,
    create: createTransportEntry,
    quickFields: [
      { kind: 'name', key: 'fromLabel', placeholder: 'From' },
      { kind: 'name', key: 'toLabel', placeholder: 'To' },
      { kind: 'note', key: 'note', placeholder: 'Quick note — mode, price, timing' },
    ],
    buildFields: (v) => ({ from: { label: v.fromLabel || '', place: null }, to: { label: v.toLabel || '', place: null }, bookingNotes: v.note || '' }),
  },
  {
    key: 'costs',
    label: LABELS.costs,
    icon: ICONS.costs,
    create: createCostEntry,
    quickFields: [
      { kind: 'name', key: 'item', placeholder: 'What is this cost for? e.g. Local SIM card' },
      { kind: 'note', key: 'note', placeholder: 'Quick note — amount, where, anything useful' },
    ],
    buildFields: (v) => ({ item: v.item || '', context: v.note || '' }),
  },
  {
    key: 'practicalInfo',
    label: LABELS.practicalInfo,
    icon: ICONS.practicalInfo,
    create: createPracticalInfoEntry,
    quickFields: [
      { kind: 'name', key: 'topic', placeholder: 'Topic, e.g. Visa, SIM cards, Emergency numbers' },
      { kind: 'note', key: 'note', placeholder: 'Quick note' },
    ],
    buildFields: (v) => ({ topic: v.topic || '', details: v.note || '' }),
  },
  {
    key: 'weatherNotes',
    label: LABELS.weatherNotes,
    icon: ICONS.weatherNotes,
    create: createWeatherNote,
    quickFields: [
      { kind: 'name', key: 'period', placeholder: 'Period, e.g. December–February' },
      { kind: 'note', key: 'note', placeholder: 'Quick note about the weather' },
    ],
    buildFields: (v) => ({ period: v.period || '', description: v.note || '' }),
  },
  {
    key: 'packingNotes',
    label: LABELS.packingNotes,
    icon: ICONS.packingNotes,
    create: createPackingNote,
    quickFields: [
      { kind: 'name', key: 'item', placeholder: 'Item, e.g. Warm jacket' },
      { kind: 'note', key: 'note', placeholder: 'Quick note (optional)' },
    ],
    buildFields: (v) => ({ item: v.item || '', remarks: v.note || '' }),
  },
  {
    key: 'shoppingItems',
    label: LABELS.shoppingItems,
    icon: ICONS.shoppingItems,
    create: createShoppingItem,
    quickFields: [
      { kind: 'name', key: 'name', placeholder: 'What to buy, e.g. Darjeeling tea' },
      { kind: 'note', key: 'note', placeholder: 'Quick note (optional)' },
    ],
    buildFields: (v) => ({ name: v.name || '', notes: v.note || '' }),
  },
  {
    key: 'generalNotes',
    label: LABELS.generalNotes,
    icon: ICONS.generalNotes,
    create: createGeneralNote,
    quickFields: [
      { kind: 'name', key: 'title', placeholder: 'Note title' },
      { kind: 'note', key: 'note', placeholder: 'Note content' },
    ],
    buildFields: (v) => ({ title: v.title || '', content: v.note || '' }),
  },
  {
    key: 'sources',
    label: LABELS.sources,
    icon: ICONS.sources,
    create: createSource,
    quickFields: [
      { kind: 'name', key: 'title', placeholder: 'Source title' },
      { kind: 'note', key: 'note', placeholder: 'URL or a quick note (optional)' },
    ],
    buildFields: (v) => ({ title: v.title || '', notes: v.note || '' }),
  },
];

export const QUICK_ADD_TYPES_BY_KEY = Object.fromEntries(QUICK_ADD_TYPES.map(t => [t.key, t]));
