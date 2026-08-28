import { commonMetadata } from '../shared.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';

const STORE = 'packingNotes';

export function emptyPackingNote() {
  return {
    category: 'Other',
    item: '',
    checked: false,
    essential: false,
    quantity: '', // optional — only shown once the person opens Edit
    remarks: '', // optional — only shown once the person opens Edit
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

export function togglePackingNoteChecked(id, checked) {
  return patch(STORE, id, { checked });
}

// Backward compatibility: earlier records used `notes` instead of
// `remarks`, and had no `checked`/`category` fields at all. Nothing is
// deleted — this only affects what's shown, and a subsequent save
// writes the new field names going forward.
export function normalizePackingNote(record) {
  if (!record) return record;
  return {
    ...record,
    category: record.category || 'Other',
    remarks: record.remarks || record.notes || '',
    checked: record.checked ?? false,
  };
}
