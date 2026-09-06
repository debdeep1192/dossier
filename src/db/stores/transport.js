import { commonMetadata, emptyMoney } from '../shared.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';

const STORE = 'transport';

// An endpoint is always at least a label (e.g. "Colombo"); `place` is
// optional richer detail (address/coordinates/maps link) for when the
// endpoint is a specific point (a station, an airport) rather than just
// a city name.
export function emptyEndpoint() {
  return { label: '', place: null };
}

// travelType distinguishes two genuinely different kinds of transport
// record (item E of the spec):
//   'inter_city' - a trip from one city/location to another (Bangkok
//                   -> Phuket) — uses `from`/`to` as before.
//   'local'      - transport WITHIN a city/location (getting around
//                   Phuket: taxi, Grab, tuk-tuk, local bus, airport
//                   transfer) — does NOT need from/to at all; it's
//                   associated with a destination/location via the
//                   normal `locationId` field instead (see
//                   commonMetadata / LocationScopeField).
// Existing records (saved before this distinction existed) have no
// `travelType` key; they are always treated as 'inter_city' since they
// already have real from/to values — see normalizeTransportEntry().
export const TRAVEL_TYPES = ['inter_city', 'local'];

export function emptyTransportEntry() {
  return {
    travelType: 'inter_city',
    from: emptyEndpoint(),
    to: emptyEndpoint(),
    mode: '', // one of TRANSPORT_MODES, or 'Other'
    modeOther: '', // free-text explanation when mode === 'Other' — see components/OtherSelect.jsx
    price: emptyMoney(),
    duration: '',
    schedule: '', // frequency/timing notes
    bookingNotes: '',
    journeyId: null, // optional — links this specific transport option to a saved Journey (db/stores/journeys.js) between two locations, when the person has already defined one; independent of travelType, and independent of from/to (a journey link is extra context, not a replacement for the from/to labels).
  };
}

export function listTransportEntries(destinationId) {
  return listActive(STORE, destinationId);
}

export function getTransportEntry(id) {
  return getActive(STORE, id);
}

export function createTransportEntry(destinationId, fields) {
  const record = { ...commonMetadata({ destinationId }), ...emptyTransportEntry(), ...fields };
  // Local transport is associated with a destination/location instead
  // of a from/to pair — see travelType above — so from/to are only
  // required for inter-city records.
  if (record.travelType !== 'local') {
    if (!record.from?.label?.trim() || !record.to?.label?.trim()) throw new Error('Both "From" and "To" are required for inter-city transport.');
  }
  return save(STORE, record);
}

export function updateTransportEntry(id, fields) {
  return patch(STORE, id, fields);
}

export function deleteTransportEntry(id) {
  return softDelete(STORE, id);
}

// A record saved before travelType existed has no such key at all —
// it's always inter-city (it necessarily has real from/to values,
// since that was the only shape available). Nothing needs to be
// rewritten on disk; this just fills in the field for display/editing.
export function normalizeTransportEntry(record) {
  if (!record) return record;
  return { ...record, travelType: record.travelType || 'inter_city' };
}
