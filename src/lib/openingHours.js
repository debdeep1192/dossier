export const OPENING_HOURS_DAYS = [
  { key: 'mon', label: 'Mon' }, { key: 'tue', label: 'Tue' }, { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' }, { key: 'fri', label: 'Fri' }, { key: 'sat', label: 'Sat' }, { key: 'sun', label: 'Sun' },
];

export function emptyOpeningHours() {
  return [{ id: crypto.randomUUID(), days: ['daily'], ranges: [{ start: '', end: '' }] }];
}

export function isOpeningHoursEmpty(groups) {
  if (!groups || groups.length === 0) return true;
  return groups.every(g => g.ranges.every(r => !r.start && !r.end));
}

export function formatOpeningHours(groups) {
  if (isOpeningHoursEmpty(groups)) return null;
  return groups
    .filter(g => g.ranges.some(r => r.start || r.end))
    .map(g => {
      const dayLabel = g.days.includes('daily') ? 'Daily' : g.days.map(d => OPENING_HOURS_DAYS.find(x => x.key === d)?.label || d).join(', ');
      const rangesLabel = g.ranges.filter(r => r.start || r.end).map(r => `${r.start || '?'}–${r.end || '?'}`).join(', ');
      return `${dayLabel}: ${rangesLabel}`;
    })
    .join(' | ');
}
