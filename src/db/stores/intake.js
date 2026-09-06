import { newId, getAll, getOne } from '../connection.js';
import { save, patch } from './crud.js';
import { extractCandidates } from '../extraction.js';

// Section stores + their create functions — the only place accepting a
// candidate is wired to actual section storage. Adding an 11th section
// later means adding one line here, not touching the review flow itself.
import { createAttraction } from './attractions.js';
import { createRestaurantEntry } from './restaurants.js';
import { createDish } from './dishes.js';
import { createAccommodation } from './accommodations.js';
import { createTransportEntry } from './transport.js';
import { createPracticalInfoEntry } from './practicalInfo.js';
import { createWeatherNote } from './weatherNotes.js';
import { createPackingNote } from './packingNotes.js';
import { createGeneralNote } from './generalNotes.js';
import { createShoppingItem } from './shoppingItems.js';

// NOTE on Costs: intentionally NOT in this map. The Costs section was
// retired from the UI (see sectionRegistry.js) — ReviewPage.jsx's
// section dropdown already never offers 'costs' as a choice, but
// acceptCandidate() below trusts whatever `section` string it's given,
// so leaving a working 'costs' entry here would have been a second,
// independent way an invisible Cost record could still be created
// (e.g. by a future caller that didn't go through today's dropdown).
// Removing the entry closes that at its source rather than relying
// only on the caller's own discipline. createCostEntry, the `costs`
// store, and any data already saved there are completely unaffected —
// this only removes the wiring that let new ones be created silently.
const CREATORS = {
  attractions: createAttraction,
  restaurants: createRestaurantEntry,
  dishes: createDish,
  accommodations: createAccommodation,
  transport: createTransportEntry,
  practicalInfo: createPracticalInfoEntry,
  weatherNotes: createWeatherNote,
  packingNotes: createPackingNote,
  generalNotes: createGeneralNote,
  shoppingItems: createShoppingItem,
};

const INTAKE_STORE = 'intakeDocuments';
const CANDIDATE_STORE = 'candidates';

export async function createIntake({ destinationId, rawText, sourceLabel }) {
  if (!rawText || !rawText.trim()) throw new Error('Pasted text cannot be empty.');
  const now = new Date().toISOString();
  const intake = {
    id: newId(),
    destinationId,
    rawText,
    sourceLabel: sourceLabel || '',
    createdAt: now,
  };
  await save(INTAKE_STORE, intake);

  const extracted = extractCandidates(rawText);
  const candidates = [];
  for (const c of extracted) {
    const candidate = {
      id: newId(),
      intakeId: intake.id,
      destinationId,
      proposedSection: c.proposedSection,
      proposedFields: c.proposedFields,
      sourceExcerpt: c.sourceExcerpt,
      uncertaintyNote: c.uncertaintyNote,
      status: 'pending_review',
      resultingStore: null,
      resultingRecordId: null,
      createdAt: now,
      updatedAt: now,
    };
    await save(CANDIDATE_STORE, candidate);
    candidates.push(candidate);
  }

  return { intake, candidates };
}

export async function getIntake(id) {
  const intake = await getOne(INTAKE_STORE, id);
  if (!intake) return null;
  const allForIntake = await getAll(CANDIDATE_STORE, 'intakeId', id);
  return { intake, candidates: allForIntake.sort((a, b) => a.createdAt.localeCompare(b.createdAt)) };
}

export async function listIntakesForDestination(destinationId) {
  const all = await getAll(INTAKE_STORE, 'destinationId', destinationId);
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateCandidate(id, updates) {
  const existing = await getOne(CANDIDATE_STORE, id);
  if (!existing) throw new Error('Candidate not found.');
  if (existing.status !== 'pending_review') throw new Error('This candidate has already been reviewed.');
  return patch(CANDIDATE_STORE, id, updates);
}

export async function rejectCandidate(id) {
  const existing = await getOne(CANDIDATE_STORE, id);
  if (!existing) throw new Error('Candidate not found.');
  if (existing.status !== 'pending_review') throw new Error('This candidate has already been reviewed.');
  return patch(CANDIDATE_STORE, id, { status: 'rejected' });
}

export async function resetCandidateToPending(id) {
  const existing = await getOne(CANDIDATE_STORE, id);
  if (!existing) throw new Error('Candidate not found.');
  if (existing.status === 'accepted') throw new Error('This candidate already became a research record and cannot be reset.');
  return patch(CANDIDATE_STORE, id, { status: 'pending_review' });
}

// Accepting a candidate writes into the SAME creator function manual
// entry uses for that section — a parsed record and a manually-typed
// record are indistinguishable once saved. `sectionFields` is exactly
// the shape that section's create function expects (built by the
// review UI from the candidate's proposedFields plus whatever the
// person edited); this function does not interpret or reshape it.
export async function acceptCandidate(id, { section, sectionFields }) {
  const existing = await getOne(CANDIDATE_STORE, id);
  if (!existing) throw new Error('Candidate not found.');
  if (existing.status !== 'pending_review') throw new Error('This candidate has already been reviewed.');
  const creator = CREATORS[section];
  if (!creator) throw new Error('Choose a valid section before accepting.');

  const record = await creator(existing.destinationId, {
    ...sectionFields,
    provenance: 'imported',
    candidateId: id,
  });

  await patch(CANDIDATE_STORE, id, { status: 'accepted', resultingStore: section, resultingRecordId: record.id });
  return record;
}
