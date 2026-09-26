import { getAll, newId } from '../connection.js';
import { getActive, save, patch, softDelete } from './crud.js';
import { TIMELINE_RESEARCH_REF_TYPES } from './timelineItems.js';

const STORE = 'itemAlternatives';

// An Item Alternative — Tour Planning, Chunk 3. Represents an
// alternative Research choice (or custom entry) for one specific,
// already-placed timeline slot — e.g. Restaurant A / Restaurant B as
// alternatives for one Lunch item.
//
// This is deliberately a DIFFERENT mechanism from planningOptionGroups
// (see planningOptionGroups.js): an Item Alternative belongs to exactly
// one timelineItems row (via timelineItemId) and never has its own
// dayNumber/partLabel/optionGroupId — those all belong to its parent
// item. Nesting alternatives under the parent item (rather than under
// the day-part directly) is what lets two different Options have
// entirely different sets of alternatives for what is conceptually "the
// same slot", per the approved design's Restaurant A/B vs D/E example.
//
// Inclusion/option context is INHERITED from the parent timelineItems
// row, never stored redundantly here — an alternative has no meaning
// of its own about whether it's part of the "current" itinerary; that
// question is always "is the parent item's Option currently selected?"
// (see PlanningDetailPage.jsx's isTimelineItemCurrentlyIncluded-style
// logic), which is exactly why an alternative nested under an
// unselected Option correctly does NOT count as current itinerary
// inclusion, without this store needing to track that itself.
//
// costSelections is stored now (an object/null, shape TBD by the Chunk
// 6 cost-calculation design) so this store doesn't need a further
// migration once costs are implemented — it is not read or written by
// any UI in this chunk.
export function emptyItemAlternative() {
  return {
    researchRefType: null,
    researchRefId: null,
    title: '',
    notes: '',
    rank: null,
    selected: false,
    costSelections: null,
  };
}

export async function listAlternativesForItem(timelineItemId) {
  const all = await getAll(STORE, 'timelineItemId', timelineItemId);
  return all.filter(r => !r.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getItemAlternative(id) {
  return getActive(STORE, id);
}

function assertValid(fields) {
  if (!fields.timelineItemId) throw new Error('A parent timeline item is required.');
  if (!fields.researchRefId && !fields.title?.trim()) throw new Error('Give this alternative a title, or attach it to a Research record.');
  if (fields.researchRefType && !TIMELINE_RESEARCH_REF_TYPES.includes(fields.researchRefType)) {
    throw new Error('That Research type cannot be referenced from an item alternative.');
  }
}

export async function createItemAlternative(timelineItemId, fields) {
  const merged = { ...emptyItemAlternative(), ...fields, timelineItemId };
  assertValid(merged);
  const now = new Date().toISOString();
  const record = {
    id: newId(),
    timelineItemId,
    researchRefType: merged.researchRefType || null,
    researchRefId: merged.researchRefId || null,
    title: merged.title?.trim() || '',
    notes: merged.notes || '',
    rank: merged.rank ?? null,
    selected: merged.selected ?? false,
    costSelections: merged.costSelections ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  return save(STORE, record);
}

export async function updateItemAlternative(id, fields) {
  const existing = await getActive(STORE, id);
  if (!existing) throw new Error('Item alternative not found.');
  const merged = { ...existing, ...fields };
  assertValid(merged);
  const updates = { ...fields };
  if (fields.title !== undefined) updates.title = fields.title.trim();
  return patch(STORE, id, updates);
}

export function deleteItemAlternative(id) {
  return softDelete(STORE, id);
}
