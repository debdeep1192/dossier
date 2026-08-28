export const FEE_STATUS_OPTIONS = [
  { value: 'free', label: 'Free' },
  { value: 'paid', label: 'Paid' },
  { value: 'nominal', label: 'Nominal / donation' },
  { value: 'unknown', label: 'Unknown / not specified' },
];

export function emptyFeeBand() {
  return { id: crypto.randomUUID(), label: '', minAge: '', maxAge: '', status: 'unknown', amount: '', currency: '' };
}

// One band with just a status set (no label/amount) is the common case
// for a simple free/single-fee attraction — the UI doesn't force
// filling in age ranges when there's only one price for everyone.
export function isFeeBandEmpty(band) {
  return !band.label && !band.amount && band.status === 'unknown';
}

export function formatFeeBands(bands) {
  if (!bands || bands.length === 0) return null;
  const meaningful = bands.filter(b => !isFeeBandEmpty(b));
  if (meaningful.length === 0) return null;
  if (meaningful.length === 1 && !meaningful[0].label) {
    return formatSingleBand(meaningful[0]);
  }
  return meaningful.map(b => `${b.label || 'Fee'}: ${formatSingleBand(b)}`).join(' · ');
}

function formatSingleBand(band) {
  if (band.status === 'free') return 'Free';
  if (band.status === 'unknown') return 'Not specified';
  if (band.status === 'nominal') return band.amount ? `Nominal (${band.currency} ${band.amount})` : 'Nominal / donation';
  if (band.status === 'paid' && band.amount) return `${band.currency} ${band.amount}`;
  return 'Paid';
}
