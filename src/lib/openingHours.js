export const OPENING_HOURS_DAYS = [
  { key: 'mon', label: 'Mon' }, { key: 'tue', label: 'Tue' }, { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' }, { key: 'fri', label: 'Fri' }, { key: 'sat', label: 'Sat' }, { key: 'sun', label: 'Sun' },
];

export function emptyOpeningHours() {
  return [{ id: crypto.randomUUID(), days: ['daily'], ranges: [{ start: '', end: '' }], closed: false }];
}

// Chunk 4 (Tour Planning — date/time validation): explicit `closed`
// per day-group, additive. Before this, "closed" could only be
// INFERRED from a day's absence across every group, which is
// genuinely ambiguous with "hours not yet researched for that day" —
// exactly the ambiguity Planning's validation must never guess at
// (unknown must never produce a warning). A group with `closed: true`
// unambiguously means "explicitly closed on these days," regardless of
// whether `ranges` holds any values. A group with `closed` absent or
// false is read exactly as before this chunk: open during `ranges` if
// any are filled in, or simply "no information yet" if not — nothing
// about that existing meaning changes. Existing records saved before
// this field existed have no `closed` key on any group; they are
// never rewritten, and every reader here treats a missing `closed` as
// `false`, so old data's meaning is completely unchanged by this
// addition (see normalizeAttraction() below for how a legacy group is
// read).
export function isOpeningHoursEmpty(groups) {
  if (!groups || groups.length === 0) return true;
  return groups.every(g => !g.closed && g.ranges.every(r => !r.start && !r.end));
}

export function formatOpeningHours(groups) {
  if (isOpeningHoursEmpty(groups)) return null;
  return groups
    .filter(g => g.closed || g.ranges.some(r => r.start || r.end))
    .map(g => {
      const dayLabel = g.days.includes('daily') ? 'Daily' : g.days.map(d => OPENING_HOURS_DAYS.find(x => x.key === d)?.label || d).join(', ');
      if (g.closed) return `${dayLabel}: Closed`;
      const rangesLabel = g.ranges.filter(r => r.start || r.end).map(r => `${r.start || '?'}–${r.end || '?'}`).join(', ');
      return `${dayLabel}: ${rangesLabel}`;
    })
    .join(' | ');
}

// Weekday key for a JS Date's getDay() (0 = Sunday ... 6 = Saturday),
// matching OPENING_HOURS_DAYS' keys — used by Planning's opening-hours
// validation (see db/planningValidation.js) to look up which group(s)
// cover a given calendar date.
export const WEEKDAY_KEYS_BY_JS_DAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Resolves the opening-hours status for one specific weekday from a
// record's openingHours groups. Returns one of:
//   - { status: 'closed' } — an explicit closed:true group covers this weekday.
//   - { status: 'open', ranges } — one or more groups with real ranges cover this weekday.
//   - { status: 'unknown' } — nothing usable covers this weekday (never researched).
// This is the single source of truth Planning's validation reads from
// — deliberately kept here, next to the rest of the opening-hours
// shape/logic, rather than duplicated in the Planning layer.
export function resolveOpeningHoursForWeekday(groups, weekdayKey) {
  if (!groups || groups.length === 0) return { status: 'unknown' };
  const covering = groups.filter(g => g.days.includes('daily') || g.days.includes(weekdayKey));
  if (covering.length === 0) return { status: 'unknown' };
  if (covering.some(g => g.closed)) return { status: 'closed' };
  const ranges = covering.flatMap(g => g.ranges).filter(r => r.start && r.end);
  if (ranges.length === 0) return { status: 'unknown' };
  return { status: 'open', ranges };
}
