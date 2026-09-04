// Small, non-component form helpers — kept in their own file (rather
// than inside components/Disclosure.jsx) so that file only exports a
// component, matching the rest of the codebase's fast-refresh-friendly
// convention.

// Used by every retrofitted section form to decide whether its
// Disclosure ("Add more details") should default open: pass whether
// each field inside the disclosure has content, get back whether ANY
// of them do. Kept intentionally generic (works on any value) rather
// than per-section, since what counts as "has content" differs by
// field shape (a string, a Money object, an array of fee bands, ...)
// — each section page already knows how to check its own fields for
// emptiness (isMoneyEmpty, isPlaceEmpty, formatFeeBands, etc.) and
// just passes the booleans in.
export function hasAdvancedContent(...flags) {
  return flags.some(Boolean);
}
