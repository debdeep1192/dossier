import { commonMetadata } from '../shared.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';

const STORE = 'packingNotes';

export function emptyPackingNote() {
  return {
    item: '',
    notes: '',
    essential: false,
  };
}

export function listPackingNotes(destinationId) {
  return listActive(STORE, destinationId);
}

export function getPackingNote(id) {
  return getActive(STORE, id);
}

export function createPackingNote(destinationId, fields) {
  const record = { ...commonMetadata({ destinationId }), ...emptyPackingNote(), ...fields };
  if (!record.item?.trim()) throw new Error('Give this an item name.');
  return save(STORE, record);
}

export function updatePackingNote(id, fields) {
  return patch(STORE, id, fields);
}

export function deletePackingNote(id) {
  return softDelete(STORE, id);
}
