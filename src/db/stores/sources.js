import { newId } from '../connection.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';

const STORE = 'sources';

export function emptySource() {
  return { title: '', url: '', type: 'website', accessedAt: '', notes: '' };
}

export function listSources(destinationId) {
  return listActive(STORE, destinationId);
}

export function getSource(id) {
  return getActive(STORE, id);
}

export async function createSource(destinationId, fields) {
  const now = new Date().toISOString();
  const record = {
    id: newId(),
    destinationId,
    locationId: null, // sources are destination-wide by convention; not currently location-scoped
    ...emptySource(),
    ...fields,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  return save(STORE, record);
}

export function updateSource(id, fields) {
  return patch(STORE, id, fields);
}

export function deleteSource(id) {
  return softDelete(STORE, id);
}
