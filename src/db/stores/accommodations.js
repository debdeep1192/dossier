import { commonMetadata, emptyPlace, emptyMoney } from '../shared.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';

const STORE = 'accommodations';

// The fixed amenity checklist (Phase 3 Chunk 5) — an explicit, closed
// list rather than free text, so it stays consistent across records
// and scannable at a glance. Deliberately excludes generic
// amenities that don't distinguish one stay from another for this
// person's actual research needs (e.g. Wi-Fi, kitchenette) — see
// DOSSIER_HANDOVER.md for the reasoning; this list is a deliberate
// product choice, not an oversight.
export const ACCOMMODATION_AMENITIES = [
  'Great location',
  'Near attractions',
  'Near public transport',
  'Airport transfer',
  'Pickup/drop facility',
  'Air conditioning',
  'Breakfast included',
  'Swimming pool',
  'Parking',
];

export function emptyAccommodation() {
  return {
    place: emptyPlace(),
    accommodationType: '', // one of ACCOMMODATION_TYPES, or 'Other'
    accommodationTypeOther: '', // free-text explanation when accommodationType === 'Other' — see components/OtherSelect.jsx
    price: emptyMoney(), // per night
    roomType: '',
    checkIn: '',
    checkOut: '',
    amenityNotes: '',
    amenities: [], // string[] — subset of ACCOMMODATION_AMENITIES; additive, defaults to none selected
    extraPersonCharges: [], // { label: string, price: Money }[] — e.g. "Extra adult" at ₹1,500/night; additive, defaults to empty
  };
}

export function emptyExtraPersonCharge() {
  return { label: '', price: emptyMoney() };
}

export function listAccommodations(destinationId) {
  return listActive(STORE, destinationId);
}

export function getAccommodation(id) {
  return getActive(STORE, id);
}

export function createAccommodation(destinationId, fields) {
  const record = { ...commonMetadata({ destinationId }), ...emptyAccommodation(), ...fields };
  if (!record.place?.name?.trim()) throw new Error('Place name is required.');
  return save(STORE, record);
}

export function updateAccommodation(id, fields) {
  return patch(STORE, id, fields);
}

export function deleteAccommodation(id) {
  return softDelete(STORE, id);
}

// A record saved before amenities/extraPersonCharges existed simply
// has no such keys — reading `record.amenities`/`record.extraPersonCharges`
// on such a record gives `undefined`. This normalizer fills in the
// empty defaults for display/editing without ever rewriting anything
// else about the record, and without requiring a DB version bump
// (these are plain optional fields on an existing store, not a new
// store or index).
export function normalizeAccommodation(record) {
  if (!record) return record;
  return {
    ...record,
    amenities: record.amenities || [],
    extraPersonCharges: record.extraPersonCharges || [],
  };
}
