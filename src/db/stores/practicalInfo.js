import { commonMetadata } from '../shared.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';

const STORE = 'practicalInfo';

export function emptyPracticalInfoEntry() {
  return {
    topic: '', // free text label, e.g. "Visa", "Connectivity", "Safety"
    details: '',
  };
}

export function listPracticalInfoEntries(destinationId) {
  return listActive(STORE, destinationId);
}

export function getPracticalInfoEntry(id) {
  return getActive(STORE, id);
}

export function createPracticalInfoEntry(destinationId, fields) {
  const record = { ...commonMetadata({ destinationId }), ...emptyPracticalInfoEntry(), ...fields };
  if (!record.topic?.trim()) throw new Error('Give this a topic.');
  return save(STORE, record);
}

export function updatePracticalInfoEntry(id, fields) {
  return patch(STORE, id, fields);
}

export function deletePracticalInfoEntry(id) {
  return softDelete(STORE, id);
}
