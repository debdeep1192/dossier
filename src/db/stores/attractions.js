import { commonMetadata, emptyPlace, emptyMoney } from '../shared.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';

const STORE = 'attractions';

export function emptyAttraction() {
  return {
    place: emptyPlace(),
    category: '', // free text: "landmark", "hike", "museum", "tour" — not an enum
    description: '',
    price: emptyMoney(), // entry fee
    openingHours: '', // free text — real-world hours are too irregular for a rigid structure
    typicalDurationMinutes: '',
    bestTimeOfDay: '',
  };
}

export function listAttractions(destinationId) {
  return listActive(STORE, destinationId);
}

export function getAttraction(id) {
  return getActive(STORE, id);
}

export function createAttraction(destinationId, fields) {
  const record = { ...commonMetadata({ destinationId }), ...emptyAttraction(), ...fields };
  if (!record.place?.name?.trim()) throw new Error('Place name is required.');
  return save(STORE, record);
}

export function updateAttraction(id, fields) {
  return patch(STORE, id, fields);
}

export function deleteAttraction(id) {
  return softDelete(STORE, id);
}
