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
    categoryOther: '', // free-text explanation when category === 'Other' — see components/OtherSelect.jsx
    description: '', // UI label "Notes" — qualitative info that doesn't belong in a structured field
    feeBands: [emptyFeeBand()], // replaces the old single `price` field — see FeeBands.jsx
    cameraCharge: null, // Money, optional
    videographyCharge: null, // Money, optional
    openingHours: emptyOpeningHours(), // replaces the old free-text openingHours string
    typicallySpent: '', // free text, e.g. "1-2 hours" — kept as-is; see typicalDurationMin/Max below for the structured equivalent used by Planning validation (Chunk 4)
    typicalDurationMin: null, // minutes — structured, additive (Tour Planning, Chunk 4). Never required; a blank value simply means Planning cannot validate duration for this record yet.
    typicalDurationMax: null, // minutes — structured, additive (Tour Planning, Chunk 4)
    bestTimeOfDay: { option: '', note: '' }, // replaces the old free-text bestTimeOfDay string — kept as the coarse category; see bestTimeStart/End/Note below for the structured equivalent
    bestTimeStart: '', // 'HH:mm' — structured best-time-to-visit, additive (Tour Planning, Chunk 4). Informational only — see planningValidation.js: never a restriction, never auto-adjusts a scheduled time.
    bestTimeEnd: '', // 'HH:mm'
    bestTimeNote: '', // free-text elaboration on the structured best-time window (distinct from bestTimeOfDay.note, which annotates the coarse category)
    // Personal visit importance — replaces the generic shared `priority`
    // (commonMetadata) for this section, which was too generic to be
    // meaningful ("must_know"/"useful"/"optional"/"reference" applied
    // identically to every section). This is NOT a quality/rating
    // judgment about the place itself — it's the person's own plan:
    // 'must_see' | 'maybe' | 'skippable' | null. commonMetadata's
    // `priority` field still exists on every attraction record (it's
    // shared infrastructure) but is simply not shown/set by this
    // section's form going forward.
    visitPriority: null,
    journeyId: null, // optional — set when this attraction is "along the way" between two locations rather than at one; see db/stores/journeys.js and components/JourneyField.jsx. Deliberately NOT in commonMetadata(): only sections where journey context is useful declare this field on their own shape.
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
  const openingHoursRaw = Array.isArray(record.openingHours) && record.openingHours.length > 0
    ? record.openingHours
    : emptyOpeningHours();
  // A legacy group (saved before Chunk 4) has no `closed` key at all.
  // Reading it as `false` preserves its exact existing meaning — open
  // during `ranges` if filled in, otherwise simply unresearched —
  // since `closed` didn't exist yet to have been intentionally set.
  const openingHours = openingHoursRaw.map(g => ({ ...g, closed: g.closed ?? false }));
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
  // Structured duration/best-time (Chunk 4) are additive and never
  // present on a pre-Chunk-4 record — read as null/'' (never set),
  // which Planning's validation treats identically to "not researched
  // yet" (no warning), exactly like a brand-new record that simply
  // hasn't had these fields filled in.
  const typicalDurationMin = record.typicalDurationMin ?? null;
  const typicalDurationMax = record.typicalDurationMax ?? null;
  const bestTimeStart = record.bestTimeStart ?? '';
  const bestTimeEnd = record.bestTimeEnd ?? '';
  const bestTimeNote = record.bestTimeNote ?? '';

  return { ...record, feeBands, openingHours, bestTimeOfDay, typicallySpent, description, typicalDurationMin, typicalDurationMax, bestTimeStart, bestTimeEnd, bestTimeNote };
}
