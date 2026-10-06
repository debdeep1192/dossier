import { resolveOpeningHoursForWeekday, WEEKDAY_KEYS_BY_JS_DAY } from './openingHours.js';

// Pure, read-time validation for Tour Planning timeline items against
// their referenced Research record's opening hours, typical duration,
// and best-time-to-visit — Tour Planning, Chunk 4.
//
// Nothing here is persisted: every function takes the current
// timeline item + its resolved Research record + the Planning's
// current derived calendar date for that item's day, and returns a
// plain description of what (if anything) is worth flagging. Calling
// this again after startDate shifts, after the item's time changes, or
// after Research is edited always recomputes fresh — there is no
// stored warning to go stale, per the "no new warning/persistence
// store" instruction.
//
// This module is deliberately NOT aware of itinerary Options or Item
// Alternatives — it only ever validates ONE timeline item (or
// alternative) against ONE Research record. Whether that item counts
// as "currently included" (i.e. whether its Option is selected) is a
// separate question the caller (PlanningDetailPage.jsx) already
// answers for other purposes (Chunk 3) — see the design note there.
// Validation runs the same way regardless of inclusion state; the UI
// simply chooses where/whether to surface it (e.g. still shown, just
// less prominently, for an unselected Option's items).

// --- Weekday resolution ---------------------------------------------

// Given a YYYY-MM-DD date string (as returned by
// plannings.js's planningDayDate), returns the matching
// OPENING_HOURS_DAYS-style weekday key ('mon'..'sun'). Parsed as LOCAL
// midnight (matching planningDayDate's own construction), and reads
// getDay() — a LOCAL-time getter — so this is consistent with the same
// timezone-safety fix already applied to planningDayDate() itself
// (never toISOString()/getUTCDay(), which would reintroduce the same
// class of off-by-one-day bug across timezones).
export function weekdayKeyForDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  return WEEKDAY_KEYS_BY_JS_DAY[d.getDay()];
}

// --- Time arithmetic ---------------------------------------------

// 'HH:mm' -> minutes since midnight, or null if not a parseable time.
// Exported (Phase 1 — schedule-first timeline) so the UI layer can
// reuse the exact same parsing for end-time display and conflict
// detection, rather than re-implementing time math in the component.
export function toMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Minutes-since-midnight -> 'HH:mm'. The inverse of toMinutes, used to
// DERIVE and display an item's end time (startTime + plannedDuration)
// without ever storing a separate end-time field — per the explicit
// Phase 1 instruction not to persist a redundant derived value. Wraps
// past 24:00 using modulo, which is the correct, honest way to show an
// activity that runs past midnight (e.g. a 23:30 start + 90 min shows
// as 23:30 → 01:00) rather than clamping or erroring; a day boundary
// is not itself invalid for an item's duration.
export function minutesToTime(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) return null;
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// An item's displayed end time — startTime + plannedDuration only
// (buffer is deliberately excluded here: buffer is transition/travel
// time needed AFTER the activity, not part of the activity itself, so
// showing it inside the activity's own start→end would misrepresent
// how long the activity actually takes). Returns null when there's
// nothing to compute from (no startTime, or no plannedDuration — a
// bare start time with no duration has no derivable end).
export function itemEndTime(item) {
  const startMin = toMinutes(item?.startTime);
  if (startMin === null || !Number.isFinite(item?.plannedDuration)) return null;
  return minutesToTime(startMin + item.plannedDuration);
}

// An item's fully "occupied until" boundary for CONFLICT purposes —
// startTime + plannedDuration + buffer. This is deliberately different
// from itemEndTime: buffer IS relevant here, because the whole reason
// buffer exists is "how much room this item needs before the next one
// can reasonably start" (see the design note on checkItemOverlap
// below). Returns null under the same conditions as itemEndTime.
function occupiedUntilMinutes(item) {
  const startMin = toMinutes(item?.startTime);
  if (startMin === null || !Number.isFinite(item?.plannedDuration)) return null;
  const buffer = Number.isFinite(item?.buffer) ? item.buffer : 0;
  return startMin + item.plannedDuration + buffer;
}

// --- Opening-hours validation ---------------------------------------------

// Checks the ENTIRE planned interval (startTime -> startTime +
// plannedDuration), not merely the start time, against the referenced
// attraction's opening hours for the item's actual calendar weekday.
//
// Returns one of:
//   null                                    — nothing to check (see below) or fully within hours.
//   { level: 'critical', message }          — explicitly closed that day.
//   { level: 'warning', message }           — known hours, but the interval falls outside them.
//
// "Nothing to check" (returns null, no warning) covers every case the
// approved design requires to stay silent:
//   - no researchRefId / no resolved Research record
//   - the Research record has no usable openingHours info for that
//     weekday (status 'unknown' — never researched, as opposed to
//     researched-and-closed)
//   - the item has no startTime (nothing to compare against)
// This function NEVER moves, blocks, deletes, or alters the timeline
// item — it only describes what a caller might want to show.
export function checkOpeningHours({ item, record, weekdayKey }) {
  if (!item?.startTime || !record?.openingHours || !weekdayKey) return null;
  const resolved = resolveOpeningHoursForWeekday(record.openingHours, weekdayKey);
  if (resolved.status === 'unknown') return null;

  const placeLabel = record.place?.name || 'This place';

  if (resolved.status === 'closed') {
    return { level: 'critical', message: `${placeLabel} is closed on this day.` };
  }

  // resolved.status === 'open' — check the FULL planned interval, not
  // just the start time, per the explicit Chunk 4 requirement.
  const startMin = toMinutes(item.startTime);
  const durationMin = Number.isFinite(item.plannedDuration) ? item.plannedDuration : 0;
  const endMin = startMin + durationMin;

  const fitsAnyRange = resolved.ranges.some(r => {
    const rangeStart = toMinutes(r.start);
    const rangeEnd = toMinutes(r.end);
    if (rangeStart === null || rangeEnd === null) return false;
    return startMin >= rangeStart && endMin <= rangeEnd;
  });
  if (fitsAnyRange) return null;

  const hoursLabel = resolved.ranges.map(r => `${r.start}–${r.end}`).join(', ');
  return { level: 'warning', message: `Outside ${placeLabel}'s opening hours (${hoursLabel}).` };
}

// --- Typical duration validation ---------------------------------------------

// Compares a timeline item's plannedDuration against the referenced
// Research record's structured typicalDurationMin/Max. Informational
// only — never blocking, never auto-adjusts plannedDuration.
//
// Returns null when there's nothing to compare (no plannedDuration, or
// the Research record has no structured range set — an unfilled
// duration is treated exactly like unresearched opening hours: no
// warning, not an error).
export function checkDuration({ item, record }) {
  if (!Number.isFinite(item?.plannedDuration) || !record) return null;
  const min = record.typicalDurationMin;
  const max = record.typicalDurationMax;
  if (!Number.isFinite(min) && !Number.isFinite(max)) return null;

  const lower = Number.isFinite(min) ? min : max;
  const upper = Number.isFinite(max) ? max : min;
  if (item.plannedDuration >= lower && item.plannedDuration <= upper) return null;

  return {
    level: 'info',
    message: `Planned duration (${item.plannedDuration} min) is outside the typical range (${lower}–${upper} min).`,
  };
}

// --- Best-time hint (informational only, never a warning) ---------------------------------------------

// Compares a timeline item's startTime against the referenced
// attraction's structured bestTimeStart/bestTimeEnd. This is
// explicitly a HINT, never a warning-severity indicator, and never
// auto-adjusts the item's time — per the approved design, "best time"
// is a recommendation, not a restriction.
export function checkBestTime({ item, record }) {
  if (!item?.startTime || !record) return null;
  const { bestTimeStart, bestTimeEnd, bestTimeNote } = record;
  if (!bestTimeStart && !bestTimeEnd && !bestTimeNote) return null;

  const windowLabel = bestTimeStart && bestTimeEnd ? `${bestTimeStart}–${bestTimeEnd}` : (bestTimeStart || bestTimeEnd || '');
  const noteSuffix = bestTimeNote ? ` — ${bestTimeNote}` : '';

  if (!bestTimeStart || !bestTimeEnd) {
    // Only a note was provided, no actual window to compare the
    // scheduled time against — still worth surfacing as a hint.
    return { level: 'hint', message: `Best time to visit: ${windowLabel}${noteSuffix}`.trim().replace(/^: /, '') };
  }

  const startMin = toMinutes(item.startTime);
  const bestStartMin = toMinutes(bestTimeStart);
  const bestEndMin = toMinutes(bestTimeEnd);
  const withinBestWindow = startMin !== null && bestStartMin !== null && bestEndMin !== null && startMin >= bestStartMin && startMin <= bestEndMin;

  if (withinBestWindow) return null; // scheduled right in the recommended window — nothing to hint about

  return { level: 'hint', message: `Research suggests ${windowLabel} as the best time to visit.${noteSuffix}` };
}

// --- Schedule conflict detection (Phase 1 — two items, not one item vs. Research) ---------------------------------------------

// Whether two scheduled items genuinely conflict in time, accounting
// for duration AND buffer — Phase 1's "real schedule conflict
// detection" requirement. Pure and symmetric: checkItemOverlap(a, b)
// and checkItemOverlap(b, a) report the same conflict (or lack of
// one); the caller decides which one item to attach the resulting
// message to (see PlanningDetailPage.jsx, which attaches it to the
// LATER-starting item, so it reads naturally as "this clashes with
// the thing before it").
//
// Deliberately excluded from scope here (left to the caller to decide
// which items are even worth comparing, same separation of concerns
// checkOpeningHours already has from Option/Alternative inclusion):
//   - this function has no awareness of Option groups or Alternatives;
//     it only compares the two items it's given. Comparing two items
//     that belong to DIFFERENT (competing) Options would be a false
//     positive — they're alternatives to each other, never both
//     "real" at once — so the caller must only pass pairs of items
//     that are actually both part of the current itinerary.
//
// Semantics: item A conflicts with item B if A's occupied interval
// (start -> start+duration+buffer) overlaps B's SCHEDULED interval
// (start -> start+duration). Using the buffer-inclusive boundary on
// only one side (whichever item comes first) is what correctly makes
// "this item's buffer exists to protect the next item's start time"
// meaningful, without double-penalizing by inflating both sides.
// Two items that are simply adjacent — A ends exactly when B's
// scheduled interval begins, with no buffer eaten into — do NOT
// conflict; only genuine overlap does.
export function checkItemOverlap(itemA, itemB) {
  const aStart = toMinutes(itemA?.startTime);
  const bStart = toMinutes(itemB?.startTime);
  if (aStart === null || bStart === null) return null; // nothing to compare without both start times
  if (!Number.isFinite(itemA?.plannedDuration) || !Number.isFinite(itemB?.plannedDuration)) return null; // can't determine an interval without a duration — never guessed

  // Normalize so `first` is whichever item starts no later than the other.
  const [first, second] = aStart <= bStart ? [itemA, itemB] : [itemB, itemA];
  const firstOccupiedUntil = occupiedUntilMinutes(first);
  const secondStart = toMinutes(second.startTime);
  if (firstOccupiedUntil === null || secondStart === null) return null;

  if (secondStart >= firstOccupiedUntil) return null; // no conflict — second starts at or after first is fully clear (including buffer)

  const overlapMinutes = firstOccupiedUntil - secondStart;
  return {
    level: 'warning',
    message: `Overlaps with the previous item by about ${overlapMinutes} min (including buffer).`,
  };
}

// --- Combined check for one timeline item ---------------------------------------------

// Runs all three checks for one timeline item against its resolved
// Research record (or returns no findings at all if there's no
// reference, since a custom item has nothing to validate against).
// weekdayKey is the item's own day's ACTUAL current weekday, derived
// by the caller from the Planning's live startDate (see
// weekdayKeyForDate + plannings.js's planningDayDate) — never cached,
// so a startDate shift is picked up automatically on next render.
export function validateTimelineItem({ item, record, weekdayKey }) {
  if (!item || !record) return { openingHours: null, duration: null, bestTime: null };
  return {
    openingHours: checkOpeningHours({ item, record, weekdayKey }),
    duration: checkDuration({ item, record }),
    bestTime: checkBestTime({ item, record }),
  };
}
