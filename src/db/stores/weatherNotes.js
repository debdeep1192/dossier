import { commonMetadata } from '../shared.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';

const STORE = 'weatherNotes';

export function emptyWeatherNote() {
  return {
    period: '', // e.g. "December–February"
    description: '',
    recommendation: '',
  };
}

export function listWeatherNotes(destinationId) {
  return listActive(STORE, destinationId);
}

export function getWeatherNote(id) {
  return getActive(STORE, id);
}

export function createWeatherNote(destinationId, fields) {
  const record = { ...commonMetadata({ destinationId }), ...emptyWeatherNote(), ...fields };
  if (!record.period?.trim()) throw new Error('Give this a period.');
  return save(STORE, record);
}

export function updateWeatherNote(id, fields) {
  return patch(STORE, id, fields);
}

export function deleteWeatherNote(id) {
  return softDelete(STORE, id);
}
