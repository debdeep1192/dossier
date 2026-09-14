// Pure logic backing components/AddEntry.jsx's routing decisions —
// kept in a plain .js file (not .jsx) specifically so it can be
// imported and tested directly by plain Node, matching every other
// test in this project (foundation.test.js, placeLookup.test.js) —
// Node cannot import a .jsx file without a build step, and this
// project intentionally has no React test harness/build step for
// tests.

// Not every section supports the `?new=1` auto-open — Practical Info
// (topic-first: there's no single "new entry" without picking a topic)
// and Packing (a category checklist, not a single add-form) are
// intentionally excluded from that behavior; selecting them in the Add
// flow still navigates to their page, just without pre-opening a
// form, which is the honest, correct behavior for their genuinely
// different UX (both are otherwise unchanged by Phase 3 Chunk 12).
export const SECTIONS_WITHOUT_AUTO_OPEN = new Set(['practicalInfo', 'packingNotes']);

// Builds the path the Add flow navigates to for a given
// section/destination/location. This is the ONE place that decides
// which sections get `?new=1` and how `?location=` context is carried
// — used by components/AddEntry.jsx.
export function buildAddDestinationPath(section, destinationId, locationId) {
  const params = new URLSearchParams();
  if (!SECTIONS_WITHOUT_AUTO_OPEN.has(section.key)) params.set('new', '1');
  if (locationId) params.set('location', locationId);
  const query = params.toString();
  return `/destinations/${destinationId}/${section.path}${query ? `?${query}` : ''}`;
}
