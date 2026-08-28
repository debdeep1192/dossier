import { commonMetadata, emptyPlace } from '../shared.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';
import { emptyFeeBand } from '../../lib/feeBands.js';
import { emptyOpeningHours } from '../../lib/openingHours.js';

const STORE = 'attractions';

// Controlled category list — see ATTRACTION_CATEGORIES for the exact
// approved values; kept here only as the record shape default.
export function emptyAttraction() {
  return {
    place: emptyPlace(),
    category: '',
    description: '', // UI label "Notes" — qualitative info that doesn't belong in a structured field
    feeBands: [emptyFeeBand()], // replaces the old single `price` field — see FeeBands.jsx
    cameraCharge: null, // Money, optional
    videographyCharge: null, // Money, optional
    openingHours: emptyOpeningHours(), // replaces the old free-text openingHours string
    typicallySpent: '', // free text, e.g. "1-2 hours" — replaces typicalDurationMinutes
    bestTimeOfDay: { option: '', note: '' }, // replaces the old free-text bestTimeOfDay string
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

// Reads an attraction record and fills in the new-shape fields from
// their old-shape equivalents when the record predates this refinement
// (has a bare `price`/string `openingHours`/string `bestTimeOfDay`/
// numeric `typicalDurationMinutes` instead of the new structures). Old
// fields are never deleted — this only affects what's shown/edited, so
// nothing is destructively migrated.
export function normalizeAttraction(record) {
  if (!record) return record;
  const feeBands = record.feeBands && record.feeBands.length > 0
    ? record.feeBands
    : record.price
      ? [{ id: crypto.randomUUID(), label: '', minAge: '', maxAge: '', status: record.price.amount ? 'paid' : 'unknown', amount: record.price.amount || '', currency: record.price.currency || '' }]
      : [emptyFeeBand()];
  const openingHours = Array.isArray(record.openingHours) && record.openingHours.length > 0
    ? record.openingHours
    : emptyOpeningHours();
  const legacyOpeningHoursText = (typeof record.openingHours === 'string' && record.openingHours) ? record.openingHours : '';
  const bestTimeOfDay = typeof record.bestTimeOfDay === 'object' && record.bestTimeOfDay !== null
    ? record.bestTimeOfDay
    : { option: '', note: typeof record.bestTimeOfDay === 'string' ? record.bestTimeOfDay : '' };
  const typicallySpent = record.typicallySpent || (record.typicalDurationMinutes ? `${record.typicalDurationMinutes} minutes` : '');
  // A previously free-text openingHours value can't be safely mapped
  // into the new structured groups (it might say "check locally" or
  // similar), so rather than lose it, surface it inside Notes with a
  // clear label so the person can see it and re-enter it structurally.
  const description = record.description || (legacyOpeningHoursText ? `Previously recorded hours: ${legacyOpeningHoursText}` : '');

  return { ...record, feeBands, openingHours, bestTimeOfDay, typicallySpent, description };
}
