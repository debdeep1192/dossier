import { getAll, getOne, newId, put } from '../connection.js';
import { softDelete } from './crud.js';

const STORE = 'planningReviewFlags';

// "Reviewed — intentionally not visiting" state for the Must-see audit
// — Tour Planning, Phase 2. One row per (planningId, researchRefId)
// pair the person has explicitly marked reviewed. Scoped implicitly to
// Attractions, per the approved design ("Must-see audit applies to
// Attractions only") — there is no researchRefType field because this
// store is never meant to hold anything else; adding one "just in
// case" would be exactly the kind of speculative generality this
// project avoids.
//
// Absence of a row is the normal, unresolved state — NOT "not
// reviewed yet" as a separate stored flag. This is deliberate: if a
// Must-see becomes included in the itinerary and is later deselected,
// the warning must reopen unless the person separately reviewed it —
// which naturally falls out of "no row = unresolved" without any
// extra state transition logic. See lib/planningAwareness.js for the
// actual audit logic that reads this store alongside Planning
// inclusion state.
export async function listReviewFlagsForPlanning(planningId) {
  const all = await getAll(STORE, 'planningId', planningId);
  return all.filter(r => !r.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Whether a specific attraction has been reviewed for a specific
// Planning. A thin convenience over listReviewFlagsForPlanning for
// call sites that only care about one attraction (e.g. the audit
// row's own "mark reviewed" toggle) — list-based reads remain the
// primary path for the actual Needs Attention aggregation, which
// needs every flag for a Planning at once rather than one at a time.
export async function getReviewFlag(planningId, researchRefId) {
  const flags = await listReviewFlagsForPlanning(planningId);
  return flags.find(f => f.researchRefId === researchRefId) || null;
}

export async function markReviewed(planningId, researchRefId) {
  if (!planningId) throw new Error('Planning is required.');
  if (!researchRefId) throw new Error('A Research attraction is required.');
  const existing = await getReviewFlag(planningId, researchRefId);
  if (existing) return existing; // already reviewed — idempotent, not a duplicate row
  const now = new Date().toISOString();
  const record = {
    id: newId(),
    planningId,
    researchRefId,
    reviewedAt: now,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await put(STORE, record);
  return record;
}

// Clears a review flag — used if the person wants to un-review an
// attraction (e.g. they change their mind and want the Must-see
// warning to apply again without first re-adding it to the
// itinerary). Soft-delete, same convention as every other store.
export async function clearReviewFlag(id) {
  return softDelete(STORE, id);
}

export async function getReviewFlagById(id) {
  const record = await getOne(STORE, id);
  if (!record || record.deletedAt) return null;
  return record;
}
