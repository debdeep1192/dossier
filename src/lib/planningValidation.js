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
function toMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
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
