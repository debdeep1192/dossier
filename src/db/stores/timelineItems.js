import { getAll, newId } from '../connection.js';
import { getActive, save, patch, softDelete } from './crud.js';

const STORE = 'timelineItems';

// The scheduled content of one Planning day — Tour Planning, Chunk 2,
// extended in Chunk 3 with itinerary Options.
//
// Every timeline item belongs to exactly one Planning and one
// dayNumber; there are no floating/unscheduled items, per the approved
// design. dayNumber is the Planning's derived day number (see
// db/stores/plannings.js's listPlanningDays) — never a calendar date —
// which is what keeps an item attached to "Day 1" even when the
// Planning's startDate later shifts.
//
// researchRefType/researchRefId are a plain reference to an existing
// Research record (attractions/restaurants/accommodations/transport),
// resolved at read time by the caller — this store never copies or
// caches any field from that record. A custom/general item (no
// Research reference) uses `title` instead; researchRefType/
// researchRefId stay null.
//
// Chunk 3: partLabel/optionGroupId/optionLabel are additive fields
// (v7 -> v8). A pre-Chunk-3 item simply has all three absent/null,
// which means "an ordinary, current itinerary item with no competing
// option" — exactly the same meaning an item created after Chunk 3
// has if it's never placed in an Option. Nothing about an existing
// item's meaning changes; migration never touches these fields.
//   - partLabel: a free-form label for a portion of the day (e.g.
//     'Morning', 'Afternoon', or any custom string) — NOT a fixed
//     enum, since a day can have any number of independently-labelled
//     parts, per the approved design.
//   - optionGroupId: which planningOptionGroups row (see
//     planningOptionGroups.js) this item's Option belongs to, if this
//     part of the day currently has more than one competing sequence.
//     null means this item isn't part of any competing-Option
//     structure — it's just an ordinary item on that day/part.
//   - optionLabel: which Option within that group ('A', 'B', ...) this
//     item belongs to. Only meaningful together with optionGroupId.
//
// rank/selected exist on the record from Chunk 2 onward. From Chunk 3
// onward `selected` is used at the Option level (see
// planningOptionGroups.selectedOptionLabel) to determine which
// sequence is current — an individual timelineItems row's own
// selected/rank fields remain inert for THIS record's own purposes
// (they matter for itemAlternatives — see itemAlternatives.js — which
// rank/select among alternatives FOR one timelineItems row).
export const TIMELINE_ITEM_TYPES = ['travel', 'attraction', 'meal', 'accommodation', 'free_time', 'custom'];

// Which Research sections are meaningful to reference from a timeline
// item, per the approved Chunk 2 scope — not every Research section
// (e.g. Practical Info, Weather, Packing, Shopping, General Notes are
// not itinerary content in the way an Attraction or a Restaurant is).
export const TIMELINE_RESEARCH_REF_TYPES = ['attractions', 'restaurants', 'accommodations', 'transport'];

export function emptyTimelineItem() {
  return {
    itemType: 'custom',
    researchRefType: null,
    researchRefId: null,
    title: '',
    startTime: '',
    plannedDuration: null,
    buffer: null,
    notes: '',
    status: 'planned', // 'planned' | 'optional'
    rank: null,
    selected: false,
    partLabel: null,
    optionGroupId: null,
    optionLabel: null,
  };
}

export async function listTimelineItems(planningId) {
  // Indexed by planningId, not destinationId — crud.js's generic
  // listActive() hardcodes the 'destinationId' index name (every other
  // store using it is a per-destination Research section), so it can't
  // be reused here. This queries the planningId index directly instead,
  // sorted the same way listActive's own results are (createdAt).
  const all = await getAll(STORE, 'planningId', planningId);
  return all.filter(r => !r.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getTimelineItem(id) {
  return getActive(STORE, id);
}

function assertValid(fields) {
  if (!fields.planningId) throw new Error('Planning is required.');
  if (!fields.dayNumber || fields.dayNumber < 1) throw new Error('A valid day is required.');
  if (!TIMELINE_ITEM_TYPES.includes(fields.itemType)) throw new Error('A valid item type is required.');
  // A Research-referenced item shows the Research record's own name
  // (resolved by the caller) and doesn't need its own title; a
  // custom/general item has nothing else to display, so it must have one.
  if (!fields.researchRefId && !fields.title?.trim()) throw new Error('Give this item a title, or attach it to a Research record.');
  if (fields.researchRefType && !TIMELINE_RESEARCH_REF_TYPES.includes(fields.researchRefType)) {
    throw new Error('That Research type cannot be referenced from a timeline item.');
  }
  // optionGroupId and optionLabel only make sense together — an item
  // that belongs to a competing Option must say which Option, and an
  // optionLabel with no group to belong to is meaningless.
  if (fields.optionGroupId && !fields.optionLabel) throw new Error('An item in an Option group needs an Option label.');
  if (fields.optionLabel && !fields.optionGroupId) throw new Error('An Option label needs an Option group.');
}

export async function createTimelineItem(planningId, dayNumber, fields) {
  const merged = { ...emptyTimelineItem(), ...fields, planningId, dayNumber };
  assertValid(merged);
  const now = new Date().toISOString();
  const record = {
    id: newId(),
    planningId,
    dayNumber,
    itemType: merged.itemType,
    researchRefType: merged.researchRefType || null,
    researchRefId: merged.researchRefId || null,
    title: merged.title?.trim() || '',
    startTime: merged.startTime || '',
    plannedDuration: merged.plannedDuration ?? null,
    buffer: merged.buffer ?? null,
    notes: merged.notes || '',
    status: merged.status || 'planned',
    rank: merged.rank ?? null,
    selected: merged.selected ?? false,
    partLabel: merged.partLabel || null,
    optionGroupId: merged.optionGroupId || null,
    optionLabel: merged.optionLabel || null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  return save(STORE, record);
}

export async function updateTimelineItem(id, fields) {
  const existing = await getActive(STORE, id);
  if (!existing) throw new Error('Timeline item not found.');
  const merged = { ...existing, ...fields };
  assertValid(merged);
  const updates = { ...fields };
  if (fields.title !== undefined) updates.title = fields.title.trim();
  return patch(STORE, id, updates);
}

export function deleteTimelineItem(id) {
  return softDelete(STORE, id);
}

// Items for one specific day, in time order — startTime is an 'HH:mm'
// string (or '') so plain string comparison sorts correctly; items with
// no startTime sort after every timed item (they still need a place in
// the list even though the day view can't order them chronologically),
// then fall back to createdAt so their relative order is at least
// stable rather than arbitrary.
export async function listTimelineItemsForDay(planningId, dayNumber) {
  const all = await listTimelineItems(planningId);
  return all
    .filter(item => item.dayNumber === dayNumber)
    .sort((a, b) => {
      if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
      if (a.startTime) return -1;
      if (b.startTime) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
}
