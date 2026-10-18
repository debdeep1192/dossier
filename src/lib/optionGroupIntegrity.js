// Itinerary-manipulation integrity (Tour Planning, Phase 4) — pure
// helpers around the relationship between a timeline item and its
// Option group.
//
// BACKGROUND. A timeline item points at its Option group through
// optionGroupId (+ optionLabel). Deleting an Option group used to only
// soft-delete the group row, leaving its items active with an
// optionGroupId pointing at a group that no longer exists. Every part
// of the Planning page treats "an item with an optionGroupId" as
// "grouped", and a grouped item is only ever reached through an ACTIVE
// group — so those items became invisible, while still being active
// records. Because the inclusion rules (lib/planningCosts.js
// isTimelineItemCurrentlyIncluded — deliberately unchanged, and
// covered by existing tests) treat a missing group as "not current",
// they also silently dropped out of cost totals, the Must-see audit,
// schedule-conflict checks and Research reverse references.
//
// Two complementary fixes:
//   1. Going forward, deleting a group atomically turns its items into
//      ordinary items (db/stores/planningOptionGroups.js
//      deleteOptionGroup) — so no new orphan is ever left behind.
//   2. Records that were ALREADY orphaned by the old behaviour are
//      tolerated at READ time by detachOrphanedGroupItems() below, at
//      the places that load a Planning's items — nothing is written
//      during a read, nothing stored is rewritten, and no migration is
//      needed. An orphaned item simply reads as the ordinary item it
//      was always meant to revert to.
//
// Plain .js so plain Node can import and test it.

export function isOrphanedFromOptionGroup(item, optionGroupsById) {
  return Boolean(item?.optionGroupId) && !optionGroupsById?.[item.optionGroupId];
}

// Returns the items with any ORPHANED one (optionGroupId set, but no
// active group with that id) presented as an ordinary item
// (optionGroupId/optionLabel cleared). Everything else about the item
// is untouched, items that are not orphaned are returned as the very
// same objects, and the input array/items are never mutated. `optionGroups`
// is the Planning's ACTIVE groups (what listOptionGroupsForPlanning
// returns).
export function detachOrphanedGroupItems(items, optionGroups) {
  const groupsById = Object.fromEntries((optionGroups || []).map(g => [g.id, g]));
  return (items || []).map(item => (
    isOrphanedFromOptionGroup(item, groupsById)
      ? { ...item, optionGroupId: null, optionLabel: null }
      : item
  ));
}

// What the "Delete group" confirmation should tell the person.
// Deleting a group keeps EVERY item (nothing is deleted) as an
// ordinary itinerary item. For a group whose Options are all just the
// selected one, that changes nothing about the current itinerary. But
// items of Options that are NOT the selected one (or of every Option,
// while the selection is still pending) were only "considered
// possibilities" until now — as ordinary items they start counting
// toward the day's schedule, costs and Must-see coverage. The message
// says so plainly instead of hiding it.
export function describeOptionGroupDeletion(group, groupItems) {
  const items = groupItems || [];
  const itemCount = items.length;
  if (itemCount === 0) {
    return { message: 'Delete this Option group? It has no items.', itemCount: 0, newlyCurrentCount: 0, newlyCurrentOptionLabels: [] };
  }

  const selected = group?.selectedOptionLabel || null;
  const notCurrent = items.filter(i => i.optionLabel !== selected);
  const newlyCurrentOptionLabels = [...new Set(notCurrent.map(i => i.optionLabel).filter(Boolean))].sort();
  const noun = n => `${n} item${n === 1 ? '' : 's'}`;

  if (notCurrent.length === 0) {
    return {
      message: `Delete this Option group? Its ${noun(itemCount)} (Option ${selected}) will stay in the itinerary as regular items. Nothing is deleted.`,
      itemCount, newlyCurrentCount: 0, newlyCurrentOptionLabels: [],
    };
  }

  const which = newlyCurrentOptionLabels.length > 0 ? ` (${newlyCurrentOptionLabels.map(l => `Option ${l}`).join(', ')})` : '';
  const why = selected ? 'not currently selected' : 'not selected yet';
  return {
    message: `Delete this Option group? All ${noun(itemCount)} will stay as regular itinerary items, including ${noun(notCurrent.length)}${which} that ${notCurrent.length === 1 ? 'is' : 'are'} ${why}. Those will start counting toward the day's schedule and costs. Nothing is deleted.`,
    itemCount, newlyCurrentCount: notCurrent.length, newlyCurrentOptionLabels,
  };
}
