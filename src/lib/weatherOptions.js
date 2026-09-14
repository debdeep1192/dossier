export const WEATHER_PRECIPITATION_LEVELS = ['Rare', 'Moderate', 'Heavy'];
export const WEATHER_DEFAULT_PRECIPITATION = 'Rare';

export const WEATHER_RECOMMENDATIONS = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'very_good', label: 'Very good' },
  { value: 'good', label: 'Good' },
  { value: 'bad', label: 'Bad' },
  { value: 'must_avoid', label: 'Must avoid' },
];

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// A pure helper for the month-range quick-picker (Phase 3 Chunk 3):
// given a starting and ending month name, returns sensible default
// exact dates — the 1st of the start month through the last day of the
// end month, for a fixed reference year (2001, an arbitrary non-leap
// year — Dossier's weather notes describe a recurring yearly season,
// not a specific year, so the year in the stored date is never
// meaningful and is always ignored on display; only month/day matter).
// The person can always edit the resulting dates afterward.
export function defaultDateRangeForMonths(startMonthName, endMonthName) {
  const startIndex = MONTHS.indexOf(startMonthName);
  const endIndex = MONTHS.indexOf(endMonthName);
  if (startIndex === -1 || endIndex === -1) return { startDate: '', endDate: '' };
  const year = 2001; // arbitrary fixed non-leap reference year — see note above
  const pad = (n) => String(n).padStart(2, '0');
  const startDate = `${year}-${pad(startIndex + 1)}-01`;
  const lastDayOfEndMonth = new Date(year, endIndex + 1, 0).getDate();
  const endDate = `${year}-${pad(endIndex + 1)}-${pad(lastDayOfEndMonth)}`;
  return { startDate, endDate };
}
