// Research ↔ Planning integration (Tour Planning, Phase 3) — reverse
// references: "which Plannings use this Research entry?"
//
// Entirely DERIVED, per the explicit instruction not to add a store or
// persisted reverse-reference records: the answer is computed from the
// existing plannings / timelineItems / planningOptionGroups /
// itemAlternatives stores every time it is asked for, so it can never
// go stale or disagree with the Planning itself.
//
// Two different questions are kept deliberately separate:
//   - REFERENCED: some active timeline item or item alternative in an
//     active Planning points at this Research record.
//   - INCLUDED:   at least one of those references is part of the
//     Planning's CURRENT itinerary, per the exact same rules the cost
//     summary and Must-see audit already use
//     (isTimelineItemCurrentlyIncluded / isAlternativeCurrentlyIncluded
//     in lib/planningCosts.js — reused, not re-implemented).
// An item inside an unselected / pending Option, or a non-selected
// item alternative, is a planned possibility: REFERENCED, not INCLUDED.
//
// What counts as an active reference:
//   - the Planning itself is active (soft-deleted Plannings never appear)
//   - the timeline item is active (soft-deleted items are filtered by
//     listTimelineItems / checked here)
//   - the alternative is active and its parent item is active
//     (alternatives are only collected for active items)
//   - an item left pointing at an Option group that no longer exists
//     (an orphan from before deleting a group started reverting its
//     items) is read as the ordinary item it reverts to — exactly how
//     the Planning page itself now presents it (see
//     lib/optionGroupIntegrity.js) — so a Research reference is never
//     counted for an item the person cannot see, nor missed for one
//     they can.
// One Planning appears once per Research entry, however many of its
// items/alternatives point at the same record.

import { listPlannings } from '../db/stores/plannings.js';
import { listTimelineItems } from '../db/stores/timelineItems.js';
import { listOptionGroupsForPlanning } from '../db/stores/planningOptionGroups.js';
import { listAlternativesForItem } from '../db/stores/itemAlternatives.js';
import { isTimelineItemCurrentlyIncluded, isAlternativeCurrentlyIncluded } from './planningCosts.js';
import { detachOrphanedGroupItems } from './optionGroupIntegrity.js';

// Loads, once for a whole destination, everything needed to answer
// reverse-reference questions for ANY Research entry in it. A Research
// entry belongs to exactly one destination and a Planning to exactly
// one destination, so only that destination's Plannings can reference
// it. Same N+1-per-small-data precedent as PlanningsPage's loader.
export async function loadPlanningReferenceData(destinationId) {
  const plannings = await listPlannings(destinationId);
  return Promise.all(plannings.map(async (planning) => {
    const [timelineItems, optionGroups] = await Promise.all([
      listTimelineItems(planning.id),
      listOptionGroupsForPlanning(planning.id),
    ]);
    const alternativesByItemId = {};
    await Promise.all(timelineItems.map(async (item) => {
      alternativesByItemId[item.id] = await listAlternativesForItem(item.id);
    }));
    return { planning, timelineItems, optionGroups, alternativesByItemId };
  }));
}

export const REFERENCE_REASON_LABELS = {
  option_not_selected: "in an Option that isn't selected",
  alternative_not_selected: 'as a non-selected alternative',
};

// -> [{ planning, status: 'included' | 'referenced', referenceCount,
//        reasons: ('option_not_selected' | 'alternative_not_selected')[] }]
// One entry per Planning, included Plannings first, then most recent
// start date, then name. `reasons` is only populated for 'referenced'
// (it explains why the references are not current inclusion).
export function deriveResearchReferences({ researchRefType, researchRefId, planningData }) {
  if (!researchRefType || !researchRefId) return [];
  const results = [];

  for (const { planning, timelineItems, optionGroups, alternativesByItemId } of planningData || []) {
    if (!planning || planning.deletedAt) continue;
    const groupsById = Object.fromEntries((optionGroups || []).filter(g => !g.deletedAt).map(g => [g.id, g]));
    const visibleItems = detachOrphanedGroupItems((timelineItems || []).filter(item => !item.deletedAt), Object.values(groupsById));

    let referenceCount = 0;
    let included = false;
    const reasons = new Set();

    for (const item of visibleItems) {
      const itemIncluded = isTimelineItemCurrentlyIncluded(item, groupsById);
      if (item.researchRefType === researchRefType && item.researchRefId === researchRefId) {
        referenceCount++;
        if (itemIncluded) included = true;
        else reasons.add('option_not_selected');
      }
      for (const alt of (alternativesByItemId?.[item.id] || [])) {
        if (alt.deletedAt) continue;
        if (alt.researchRefType !== researchRefType || alt.researchRefId !== researchRefId) continue;
        referenceCount++;
        if (isAlternativeCurrentlyIncluded(alt, item, groupsById)) included = true;
        else reasons.add(itemIncluded ? 'alternative_not_selected' : 'option_not_selected');
      }
    }

    if (referenceCount === 0) continue;
    results.push({
      planning,
      status: included ? 'included' : 'referenced',
      referenceCount,
      reasons: included ? [] : [...reasons],
    });
  }

  return results.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'included' ? -1 : 1;
    const byDate = (b.planning.startDate || '').localeCompare(a.planning.startDate || '');
    if (byDate !== 0) return byDate;
    return (a.planning.name || '').localeCompare(b.planning.name || '');
  });
}
