// Planning self-awareness — Tour Planning, Phase 2: "Is this trip in
// good shape, and what still needs my attention?"
//
// Everything here is PURE and DERIVED — no new persisted aggregate
// state, per the explicit instruction not to introduce a
// "planningHealth"/"planningIssues" store or to persist Needs
// Attention counts. The only genuinely new stored fact anywhere in
// this phase is planningReviewFlags (one row per attraction
// explicitly marked "reviewed, not visiting" for one Planning) — see
// db/stores/planningReviewFlags.js. Every function below is called
// fresh against already-loaded Planning data, the same architectural
// pattern lib/planningCosts.js and lib/planningValidation.js already
// established: recomputed on every read, never cached or stale.
//
// Reuses rather than duplicates:
//   - isTimelineItemCurrentlyIncluded / isAlternativeCurrentlyIncluded
//     (lib/planningCosts.js) for inclusion-context semantics
//   - checkItemOverlap (lib/planningValidation.js) for conflict detection

import { isTimelineItemCurrentlyIncluded, isAlternativeCurrentlyIncluded } from './planningCosts.js';
import { checkItemOverlap } from './planningValidation.js';

// --- Must-see audit ---------------------------------------------

// For one attraction (visitPriority === 'must_see'), determines its
// audit status against one Planning's current state. Mirrors exactly
// the state machine from the originally approved design:
//   1. selected (in the current itinerary, directly or via a
//      currently-included alternative) -> 'included', no warning
//   2. not selected, but planned/optional somewhere in the current
//      itinerary context -> 'included', no warning (matches the
//      approved "Planned alternative -> included" rule — being
//      scheduled at all, even without a final pick, still counts)
//   3. not included anywhere, but reviewed -> 'reviewed', no warning
//   4. not included anywhere, not reviewed -> 'unresolved', warning
//
// "Included" deliberately means CURRENTLY included — an item inside
// an unselected Option, or a non-selected alternative, never counts,
// matching isTimelineItemCurrentlyIncluded/isAlternativeCurrentlyIncluded
// exactly. If a Must-see was once included and is later deselected
// (an Option reselected away from it, or its one referencing item
// deleted), this status recomputes fresh on the next read and falls
// straight back to 'unresolved' unless a review flag already exists —
// there is no separate "was previously satisfied" state to update or
// forget to update.
function auditStatusForAttraction(attractionId, { timelineItems, alternativesByItemId, optionGroupsById, reviewedAttractionIds }) {
  const referencingItems = timelineItems.filter(i => i.researchRefType === 'attractions' && i.researchRefId === attractionId);
  const referencingAlternatives = timelineItems.flatMap(item =>
    (alternativesByItemId[item.id] || [])
      .filter(alt => alt.researchRefType === 'attractions' && alt.researchRefId === attractionId)
      .map(alt => ({ alt, parentItem: item })),
  );

  const isIncluded =
    referencingItems.some(item => isTimelineItemCurrentlyIncluded(item, optionGroupsById)) ||
    referencingAlternatives.some(({ alt, parentItem }) => isAlternativeCurrentlyIncluded(alt, parentItem, optionGroupsById));
  if (isIncluded) return 'included';

  if (reviewedAttractionIds.has(attractionId)) return 'reviewed';

  // Referenced anywhere at all (even inside an unselected Option, or
  // as a non-selected alternative) is still "known about" by the
  // Planning, but not actually included — still unresolved either way,
  // since the approved design only distinguishes included / reviewed /
  // neither. Whether it's referenced-but-unselected or never
  // referenced at all produces the same 'unresolved' status; callers
  // that want to distinguish those two for display can inspect
  // referencingItems.length themselves (see the day/attention summary,
  // which doesn't need to).
  return 'unresolved';
}

// Runs the audit across every Must-see attraction for the Planning's
// destination. `attractions` should be the full, already-loaded,
// soft-delete-excluded list for that destination (the existing
// listAttractions()/researchByTypeAndId.attractions already filters
// out soft-deleted records — see crud.js's listActive — so a
// soft-deleted attraction is never even in this list to begin with;
// nothing extra needs to happen here for that requirement).
export function auditMustSeeAttractions({ attractions, timelineItems, alternativesByItemId, optionGroupsById, reviewFlags }) {
  const reviewedAttractionIds = new Set(reviewFlags.map(f => f.researchRefId));
  return attractions
    .filter(a => a.visitPriority === 'must_see')
    .map(attraction => ({
      attraction,
      status: auditStatusForAttraction(attraction.id, { timelineItems, alternativesByItemId, optionGroupsById, reviewedAttractionIds }),
      reviewFlag: reviewFlags.find(f => f.researchRefId === attraction.id) || null,
    }));
}

// --- Needs Attention aggregation ---------------------------------------------

// One "attention item" — enough context to understand and (where
// practical) navigate to what it refers to. `kind` distinguishes the
// five categories named in the approved design; `severity` is one of
// 'warning' | 'info', deliberately never a fine-grained status system
// of its own — just enough to let the UI vary emphasis slightly,
// matching "critical/problem where appropriate, warning for
// unresolved decisions, informational where appropriate" without
// inventing a new taxonomy.
//
// Returns a flat array, already in a sensible display order (by day
// number where one applies, otherwise grouped by kind) — the caller
// renders it directly rather than re-sorting.
export function buildNeedsAttention({ timelineItems, optionGroups, alternativesByItemId, attractions, reviewFlags, currentDayCount }) {
  const items = [];
  const optionGroupsById = Object.fromEntries(optionGroups.map(g => [g.id, g]));

  // 1. Unresolved itinerary Option selections — a group with no
  // selectedOptionLabel yet. This is "pending", not an error; still
  // worth surfacing as something the person hasn't decided yet.
  for (const group of optionGroups) {
    if (group.selectedOptionLabel !== null) continue;
    items.push({
      kind: 'option_pending',
      severity: 'warning',
      dayNumber: group.dayNumber,
      title: group.partLabel,
      message: `${group.partLabel} — Option selection pending`,
      groupId: group.id,
    });
  }

  // 2. Unresolved item-level Alternatives — a timeline item that HAS
  // alternatives recorded, none of which is selected, AND the item
  // itself is currently included (an alternative set sitting under an
  // unselected Option is not itself an active decision right now —
  // nothing about it needs the person's attention until that Option
  // becomes selected; see the explicit inclusion-context requirement).
  for (const item of timelineItems) {
    const alts = alternativesByItemId[item.id] || [];
    if (alts.length === 0) continue;
    if (!isTimelineItemCurrentlyIncluded(item, optionGroupsById)) continue;
    const hasSelected = alts.some(a => a.selected);
    if (hasSelected) continue;
    items.push({
      kind: 'alternative_pending',
      severity: 'warning',
      dayNumber: item.dayNumber,
      title: item.title || '(Research item)',
      message: `${item.title || 'This item'} has ${alts.length} alternative${alts.length === 1 ? '' : 's'}, none selected`,
      itemId: item.id,
    });
  }

  // 3. Must-see attractions not included and not reviewed.
  const audit = auditMustSeeAttractions({ attractions, timelineItems, alternativesByItemId, optionGroupsById, reviewFlags });
  for (const { attraction, status } of audit) {
    if (status !== 'unresolved') continue;
    items.push({
      kind: 'must_see_unresolved',
      severity: 'warning',
      dayNumber: null,
      title: attraction.place?.name || 'Untitled attraction',
      message: `${attraction.place?.name || 'This Must-see attraction'} is not in the itinerary and hasn't been reviewed`,
      attractionId: attraction.id,
    });
  }

  // 4. Genuine schedule conflicts — reuses Phase 1's own
  // checkItemOverlap, run across each day's CURRENT sequence only
  // (ordinary items + whichever Option is actually selected), exactly
  // matching DaysTimeline's own per-day conflict logic so the two
  // never disagree.
  const itemsByDay = {};
  for (const item of timelineItems) (itemsByDay[item.dayNumber] ||= []).push(item);
  for (const [dayNumber, dayItems] of Object.entries(itemsByDay)) {
    const sequence = dayItems
      .filter(item => isTimelineItemCurrentlyIncluded(item, optionGroupsById))
      .filter(item => item.startTime)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < sequence.length; i++) {
      const finding = checkItemOverlap(sequence[i - 1], sequence[i]);
      if (!finding) continue;
      items.push({
        kind: 'schedule_conflict',
        severity: 'warning',
        dayNumber: Number(dayNumber),
        title: sequence[i].title || '(Research item)',
        message: `Day ${dayNumber}: ${sequence[i].title || 'this item'} ${finding.message.toLowerCase()}`,
        itemId: sequence[i].id,
      });
    }
  }

  // 5. Content on days outside the current trip dates (Phase 1's
  // "Outside current trip dates" retention) — informational, not a
  // warning: nothing is wrong with the data, it's just no longer
  // inside the trip's current date range, per the Phase 1 design
  // (shortening never deletes anything).
  const outOfRangeDayNumbers = new Set([
    ...timelineItems.map(i => i.dayNumber),
    ...optionGroups.map(g => g.dayNumber),
  ].filter(n => Number.isFinite(n) && n > currentDayCount));
  for (const dayNumber of [...outOfRangeDayNumbers].sort((a, b) => a - b)) {
    const count = timelineItems.filter(i => i.dayNumber === dayNumber).length;
    items.push({
      kind: 'out_of_range',
      severity: 'info',
      dayNumber,
      title: `Day ${dayNumber}`,
      message: `Day ${dayNumber} has ${count} item${count === 1 ? '' : 's'} outside the current trip dates`,
    });
  }

  return items;
}

// A compact breakdown for display — groups buildNeedsAttention's flat
// list into the counts the approved header design asks for ("2
// choices pending", "1 Must-see to review", etc.), without inventing
// a new status taxonomy: this is just Array.filter/length over the
// same flat list, computed fresh every time.
export function summarizeNeedsAttention(attentionItems) {
  const pendingOptions = attentionItems.filter(i => i.kind === 'option_pending').length;
  const pendingAlternatives = attentionItems.filter(i => i.kind === 'alternative_pending').length;
  const mustSeeUnresolved = attentionItems.filter(i => i.kind === 'must_see_unresolved').length;
  const conflicts = attentionItems.filter(i => i.kind === 'schedule_conflict').length;
  const outOfRange = attentionItems.filter(i => i.kind === 'out_of_range').length;
  const totalWarnings = pendingOptions + pendingAlternatives + mustSeeUnresolved + conflicts;
  return { pendingOptions, pendingAlternatives, mustSeeUnresolved, conflicts, outOfRange, totalWarnings };
}
