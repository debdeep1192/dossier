import { commonMetadata } from '../shared.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';

const STORE = 'generalNotes';

// The deliberate escape hatch: title + content only, for anything
// genuinely not covered by the other 9 sections. Unlike every other
// section, "title" and "content" are meaningful here BY DEFINITION —
// this is the one place free-form title/content belongs.
export function emptyGeneralNote() {
  return { title: '', content: '' };
}

export function listGeneralNotes(destinationId) {
  return listActive(STORE, destinationId);
}

export function getGeneralNote(id) {
  return getActive(STORE, id);
}

export function createGeneralNote(destinationId, fields) {
  const record = { ...commonMetadata({ destinationId }), ...emptyGeneralNote(), ...fields };
  if (!record.title?.trim()) throw new Error('Give this note a title.');
  return save(STORE, record);
}

export function updateGeneralNote(id, fields) {
  return patch(STORE, id, fields);
}

export function deleteGeneralNote(id) {
  return softDelete(STORE, id);
}
