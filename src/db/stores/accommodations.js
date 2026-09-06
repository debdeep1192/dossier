import { commonMetadata, emptyPlace, emptyMoney } from '../shared.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';

const STORE = 'accommodations';

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
  };
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
