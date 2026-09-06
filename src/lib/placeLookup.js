// ============================================================
// Place lookup — free, explicit, OSM/Nominatim-based place
// resolution (item 9/6 of the spec). This is the ONE reusable
// module every place-based form should call rather than each
// section page embedding its own fetch/ranking logic.
//
// IMPORTANT LIMITS, stated plainly rather than papered over:
//   - Nominatim has NO review counts or star ratings — that data
//     simply does not exist in OpenStreetMap. Ranking here uses
//     name/location/category signals plus Nominatim's own
//     "importance" score, NEVER review volume. Dossier does not
//     claim otherwise anywhere in this module or its UI.
//   - This requires network access. It is never required to save
//     a research record — every caller must treat a failed,
//     empty, timed-out, or malformed lookup as a normal outcome,
//     not an error state that blocks saving.
//   - Per Nominatim's usage policy for the public instance, this
//     module is used ONLY for explicit, human-triggered lookups
//     (a person pressing "Find Place") — never on every keystroke,
//     never in a background/bulk loop. See lookupPlace() below.
// ============================================================

const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org/search';

// Per Nominatim's usage policy: identify the application via a
// descriptive User-Agent-equivalent query param (browsers cannot set
// a custom User-Agent header directly, so `email`/referrer conventions
// aside, we identify via the request pattern itself: one request per
// explicit user action, never automated). No API key exists or is
// needed for the public instance.
const REQUEST_TIMEOUT_MS = 8000;

// A simple, session-lifetime throttle: refuse to fire a second live
// request within this window of the previous one, even if a caller's
// UI somehow allowed rapid repeat clicks. This is a courtesy floor on
// top of "human-triggered only" — it does not replace that; it only
// guards against accidental rapid double-firing (e.g. a double click).
const MIN_MS_BETWEEN_REQUESTS = 1200;
let lastRequestAt = 0;

/**
 * Builds the contextual query Nominatim (and the Google Maps hand-off)
 * both use: "<name>, <city/location>, <country/destination>" — omitting
 * any part that's blank. This is the ONLY place this string is built,
 * so the two lookups (OSM candidates + "Open in Google Maps") always
 * search for exactly the same thing.
 */
export function buildContextualQuery({ name, locationName, destinationName }) {
  return [name, locationName, destinationName].map(s => (s || '').trim()).filter(Boolean).join(', ');
}

/**
 * A pure, dependency-injectable string-similarity score in [0, 1].
 * Deliberately simple (normalized token overlap) rather than a
 * full edit-distance library — good enough to separate "Ganesh
 * Temple" from "Ganesha Mandir Restaurant" without adding a
 * dependency for it.
 */
export function nameSimilarity(query, candidateName) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const qTokens = new Set(norm(query));
  const cTokens = new Set(norm(candidateName));
  if (qTokens.size === 0 || cTokens.size === 0) return 0;
  let overlap = 0;
  for (const t of qTokens) if (cTokens.has(t)) overlap++;
  return overlap / Math.max(qTokens.size, cTokens.size);
}

/**
 * Ranks raw Nominatim results using the approved, non-review-based
 * signals: name similarity, current location/city match, destination/
 * country match, category plausibility, and Nominatim's own
 * "importance" as a secondary tiebreaker. Returns candidates sorted
 * best-first, each annotated with its individual sub-scores for
 * transparency/debugging (not shown to the user, but makes the
 * ranking auditable/testable).
 */
export function rankCandidates(rawResults, { name, locationName, destinationName, expectedCategory } = {}) {
  return rawResults
    .map(r => {
      const displayName = r.display_name || '';
      const addr = r.address || {};
      const sim = nameSimilarity(name, r.name || displayName.split(',')[0]);

      const locationText = [addr.city, addr.town, addr.village, addr.county, addr.state].filter(Boolean).join(' ').toLowerCase();
      const locationMatch = locationName && locationText.includes(locationName.toLowerCase()) ? 1 : 0;

      const countryText = (addr.country || '').toLowerCase();
      const destinationMatch = destinationName && countryText.includes(destinationName.toLowerCase()) ? 1 : 0;

      // Category plausibility: only meaningfully scoreable when the
      // caller told us what kind of place this should be (e.g.
      // "attraction" shouldn't prefer a shop). Nominatim's `class`/
      // `type` are OSM tag values (e.g. class=amenity, type=place_of_worship).
      let categoryScore = 0.5; // neutral when we have no expectation to check against
      if (expectedCategory && r.class) {
        categoryScore = expectedCategory.classes.includes(r.class) ? 1 : 0.2;
      }

      const importance = typeof r.importance === 'number' ? r.importance : 0; // Nominatim's own 0-1ish relevance score — a SECONDARY signal only, never review-based

      // Weighted combination: name similarity dominates (it's the
      // strongest, most direct signal for "did we find the right
      // place"), location/destination match are strong positive
      // confirmations, category is a mild adjustment, importance is
      // the smallest-weighted tiebreaker.
      const score = sim * 0.45 + locationMatch * 0.2 + destinationMatch * 0.15 + categoryScore * 0.1 + importance * 0.1;

      return { raw: r, score, sim, locationMatch, destinationMatch, categoryScore, importance };
    })
    .sort((a, b) => b.score - a.score);
}

// A rough category->OSM-class hint table, used only to mildly bias
// ranking (never to filter results out entirely) — kept intentionally
// small and forgiving, since OSM tagging is inconsistent in practice.
export const CATEGORY_HINTS = {
  attraction: { classes: ['tourism', 'historic', 'amenity', 'leisure', 'natural'] },
  restaurant: { classes: ['amenity', 'shop'] },
  accommodation: { classes: ['tourism', 'building'] },
};

/**
 * Fires the actual Nominatim request. Deliberately a thin, mockable
 * function (tests replace `fetchImpl`) — all query-building and
 * ranking logic above is pure and needs no network at all.
 *
 * Returns { candidates, error }. NEVER throws — a network failure,
 * timeout, non-2xx response, or malformed JSON all resolve to
 * { candidates: [], error: <reason> } so callers can treat every
 * outcome uniformly and never block saving on this.
 */
export async function lookupPlace({ name, locationName, destinationName, expectedCategory }, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const query = buildContextualQuery({ name, locationName, destinationName });
  if (!query) return { candidates: [], error: 'A name is needed to search.' };

  const sinceLast = now() - lastRequestAt;
  if (sinceLast < MIN_MS_BETWEEN_REQUESTS) {
    return { candidates: [], error: 'Please wait a moment before searching again.' };
  }

  const url = `${NOMINATIM_BASE_URL}?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(query)}`;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;

  try {
    lastRequestAt = now();
    const response = await fetchImpl(url, {
      signal: controller?.signal,
      headers: { 'Accept-Language': 'en' },
    });
    if (!response.ok) {
      return { candidates: [], error: `Lookup failed (${response.status}). You can still enter the place manually.` };
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      return { candidates: [], error: 'Unexpected response from the lookup service. You can still enter the place manually.' };
    }
    if (data.length === 0) {
      return { candidates: [], error: null }; // a genuine zero-result search is not an "error" — just nothing found
    }
    const ranked = rankCandidates(data, { name, locationName, destinationName, expectedCategory });
    return { candidates: ranked, error: null };
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'The lookup timed out.' : 'Could not reach the lookup service (offline or network error).';
    return { candidates: [], error: `${reason} You can still enter the place manually.` };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// ============================================================
// Local cache of CONFIRMED results only — never raw search
// results. A person confirming a candidate means "yes, this is the
// place" — remembering that avoids re-querying Nominatim for the
// exact same name+context next time the same record is reopened.
// Deliberately NOT a general query cache (which would risk serving
// stale/wrong candidates); only ever populated by an explicit user
// confirmation, read by callers that want to skip a redundant lookup.
// ============================================================
const CONFIRMED_CACHE_KEY_PREFIX = 'dossier:placeLookupConfirmed:';

function cacheKey(name, locationName, destinationName) {
  return CONFIRMED_CACHE_KEY_PREFIX + buildContextualQuery({ name, locationName, destinationName }).toLowerCase();
}

export function getCachedConfirmedResult({ name, locationName, destinationName }, { storage = safeLocalStorage() } = {}) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(cacheKey(name, locationName, destinationName));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setCachedConfirmedResult({ name, locationName, destinationName }, confirmedPlace, { storage = safeLocalStorage() } = {}) {
  if (!storage) return;
  try {
    storage.setItem(cacheKey(name, locationName, destinationName), JSON.stringify(confirmedPlace));
  } catch {
    // Storage full/unavailable — caching is a convenience, never required. Fail silently.
  }
}

function safeLocalStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // some environments throw on access (privacy modes, sandboxed contexts, this Node test runner)
  }
}
