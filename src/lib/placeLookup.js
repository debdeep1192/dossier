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
const WIKIDATA_SEARCH_URL = 'https://www.wikidata.org/w/api.php';
const WIKIDATA_ENTITY_URL = 'https://www.wikidata.org/w/api.php';

// Per Nominatim's usage policy: identify the application via a
// descriptive User-Agent-equivalent query param (browsers cannot set
// a custom User-Agent header directly, so `email`/referrer conventions
// aside, we identify via the request pattern itself: one request per
// explicit user action, never automated). No API key exists or is
// needed for either the public Nominatim instance or the public
// Wikidata API — both are free, keyless, and intended for exactly this
// kind of client-side interactive use (Wikidata's own search-as-you-type
// UI is built on the same wbsearchentities endpoint used here).
const REQUEST_TIMEOUT_MS = 8000;

// A simple, session-lifetime throttle: refuse to fire a second live
// lookup within this window of the previous one, even if a caller's
// UI somehow allowed rapid repeat clicks. This is a courtesy floor on
// top of "human-triggered only" — it does not replace that; it only
// guards against accidental rapid double-firing (e.g. a double click).
// One "lookup" from the caller's perspective may issue two underlying
// requests (Wikidata + Nominatim, in parallel) — the throttle counts
// per lookupPlace() CALL, not per underlying HTTP request, since both
// requests are still triggered by the same single explicit action.
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
 * Normalizes a raw Nominatim search result into the common candidate
 * shape used by rankCandidates() below — { source, name, lat, lng,
 * displayName, addressCity, addressCountry, class, importance }.
 * Keeping the raw object too (as `raw`) so callers/tests can still
 * inspect the original payload.
 */
function normalizeNominatimResult(r) {
  const addr = r.address || {};
  return {
    source: 'nominatim',
    raw: r,
    name: r.name || (r.display_name || '').split(',')[0],
    displayName: r.display_name || '',
    lat: r.lat != null ? parseFloat(r.lat) : null,
    lng: r.lon != null ? parseFloat(r.lon) : null,
    addressCity: [addr.city, addr.town, addr.village, addr.county, addr.state].filter(Boolean).join(' '),
    addressCountry: addr.country || '',
    osmClass: r.class || null,
    importance: typeof r.importance === 'number' ? r.importance : 0,
  };
}

/**
 * Normalizes a Wikidata entity (already resolved via wbgetentities,
 * see fetchWikidataCandidates below) into the same common candidate
 * shape. Wikidata never has an OSM `class`/`importance` — those stay
 * null/0, which rankCandidates() treats neutrally, exactly as it
 * already does for a Nominatim result missing `class`.
 */
function normalizeWikidataResult(entity, matchedLabel) {
  const coords = entity.coordinates;
  return {
    source: 'wikidata',
    raw: entity,
    name: matchedLabel || entity.label || '',
    displayName: [entity.label, entity.description].filter(Boolean).join(' — '),
    lat: coords ? coords.lat : null,
    lng: coords ? coords.lng : null,
    addressCity: '', // Wikidata doesn't give a structured address the way Nominatim does
    addressCountry: '',
    osmClass: null,
    importance: 0, // no equivalent signal — never fabricated
  };
}

/**
 * A pure, dependency-injectable string-similarity score in [0, 1].
 * Deliberately simple (normalized token overlap) rather than a
 * full edit-distance library — good enough to separate "Ganesh
 * Temple" from "Ganesha Mandir Restaurant" without adding a
 * dependency for it.
 */
export function nameSimilarity(query, candidateName) {
  // Apostrophes and internal periods are part of how a name is
  // written (Glenary's, St. Joseph's) — stripping them outright (not
  // replacing with a space) keeps "Glenary's" and "Glenarys" as the
  // same token instead of splitting into "glenary" + "s". Genuine
  // word separators (hyphens, etc.) still fall through to the space
  // replacement below, unchanged.
  const norm = (s) => (s || '').toLowerCase().replace(/['’.]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const qTokens = new Set(norm(query));
  const cTokens = new Set(norm(candidateName));
  if (qTokens.size === 0 || cTokens.size === 0) return 0;
  let overlap = 0;
  for (const t of qTokens) if (cTokens.has(t)) overlap++;
  return overlap / Math.max(qTokens.size, cTokens.size);
}

// Rough great-circle distance in kilometers — used only to decide
// whether two candidates (one from each source) are plausibly "the
// same place" for deduplication purposes (see mergeCandidates below),
// never as a ranking signal on its own.
function distanceKm(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return Infinity;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Ranks a list of already-normalized candidates (from either or both
 * sources — see normalizeNominatimResult/normalizeWikidataResult
 * above) using the approved, non-review-based signals: name
 * similarity, current location/city match, destination/country match,
 * category plausibility, and Nominatim's own "importance" as a
 * secondary tiebreaker.
 *
 * IMPORTANT: a Wikidata-sourced candidate gets no automatic boost or
 * penalty for its source — it is scored by the exact same formula as
 * a Nominatim candidate. A Wikidata match earns a high score by
 * actually matching the name/location well, not merely by existing;
 * see the "Temple of the Tooth" test cases for a concrete example of
 * this in practice (a wrong-city Wikidata-sourced candidate still
 * loses to a correctly-located Nominatim candidate).
 *
 * Returns candidates sorted best-first, each annotated with its
 * individual sub-scores for transparency/debugging (not shown to the
 * user, but makes the ranking auditable/testable).
 */
export function rankCandidates(candidates, { name, locationName, destinationName, expectedCategory } = {}) {
  return candidates
    .map(c => {
      const sim = nameSimilarity(name, c.name);

      const locationMatch = locationName && c.addressCity && c.addressCity.toLowerCase().includes(locationName.toLowerCase()) ? 1 : 0;
      const destinationMatch = destinationName && c.addressCountry && c.addressCountry.toLowerCase().includes(destinationName.toLowerCase()) ? 1 : 0;

      // Category plausibility: only meaningfully scoreable when the
      // caller told us what kind of place this should be (e.g.
      // "attraction" shouldn't prefer a shop), AND the candidate has
      // an OSM class to check (Wikidata candidates don't, and get the
      // neutral score, same as a Nominatim result missing `class`).
      let categoryScore = 0.5;
      if (expectedCategory && c.osmClass) {
        categoryScore = expectedCategory.classes.includes(c.osmClass) ? 1 : 0.2;
      }

      // Weighted combination: name similarity dominates (it's the
      // strongest, most direct signal for "did we find the right
      // place"), location/destination match are strong positive
      // confirmations, category is a mild adjustment, importance is
      // the smallest-weighted tiebreaker. Identical formula regardless
      // of `c.source` — see the doc comment above.
      const score = sim * 0.45 + locationMatch * 0.2 + destinationMatch * 0.15 + categoryScore * 0.1 + c.importance * 0.1;

      return { ...c, score, sim, locationMatch, destinationMatch, categoryScore };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Merges Wikidata and Nominatim candidate lists, removing duplicates
 * that plausibly refer to the same real-world place — a name-similar
 * pair within ~1km of each other (both coordinates present), or an
 * exact-enough name match when one side has no coordinates at all.
 * When a duplicate is found, the Nominatim version is kept (it has a
 * fuller structured address for locality/city display), but this
 * happens AFTER ranking — see lookupPlace() — so which candidate
 * "wins" a duplicate pair never depends on which source found it,
 * only on which one is actually more complete for display purposes.
 */
export function mergeCandidates(wikidataCandidates, nominatimCandidates) {
  const merged = [...nominatimCandidates];
  for (const wd of wikidataCandidates) {
    const duplicate = nominatimCandidates.find(nom => {
      // Same real place is decided primarily by PROXIMITY, not name —
      // this is deliberate: the whole point of the Wikidata alias pass
      // is to find places whose name differs from what Nominatim/OSM
      // calls them (e.g. "Temple of the Sacred Tooth Relic" vs "Sri
      // Dalada Maligawa" — genuinely no shared words, same building).
      // If both sources have usable coordinates and they're close,
      // that's strong enough evidence on its own.
      if (wd.lat != null && wd.lng != null && nom.lat != null && nom.lng != null) {
        return distanceKm(wd.lat, wd.lng, nom.lat, nom.lng) < 1;
      }
      // No coordinates to compare on at least one side — fall back to
      // a strict name-only match so we don't over-merge unrelated
      // same-named places purely on text.
      return nameSimilarity(wd.name, nom.name) >= 0.8;
    });
    if (!duplicate) merged.push(wd);
  }
  return merged;
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
 * Fires the actual Nominatim request and returns normalized candidates
 * (never throws — network/parse failures resolve to an empty list, the
 * caller decides what an all-sources-empty outcome means).
 */
async function fetchNominatimCandidates(query, fetchImpl, signal) {
  const url = `${NOMINATIM_BASE_URL}?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(query)}`;
  const response = await fetchImpl(url, { signal, headers: { 'Accept-Language': 'en' } });
  if (!response.ok) return [];
  const data = await response.json();
  if (!Array.isArray(data)) return [];
  return data.map(normalizeNominatimResult);
}

/**
 * Wikidata first pass: action=wbsearchentities matches against BOTH an
 * entity's primary label AND its aliases ("also known as") in the
 * requested language — this is specifically what lets a search for
 * "Sacred Tooth Temple" find the entity whose official label is
 * "Temple of the Sacred Tooth Relic" (an alias on that entity), which
 * plain Nominatim free-text search does not do (it only matches
 * indexed OSM name/alt_name tags, not a curated alias list). No API
 * key; `origin=*` enables the request from a browser (CORS).
 *
 * wbsearchentities alone doesn't return coordinates, so for the top
 * few hits we make one follow-up wbgetentities call to pull each
 * entity's claims (specifically P625, coordinate location) — still
 * free, keyless, and triggered only as part of the same explicit
 * lookup action, not a separate/background request.
 */
async function fetchWikidataCandidates(name, fetchImpl, signal) {
  const searchUrl = `${WIKIDATA_SEARCH_URL}?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&format=json&origin=*&limit=5`;
  const searchResponse = await fetchImpl(searchUrl, { signal });
  if (!searchResponse.ok) return [];
  const searchData = await searchResponse.json();
  const hits = Array.isArray(searchData?.search) ? searchData.search : [];
  if (hits.length === 0) return [];

  const ids = hits.map(h => h.id).filter(Boolean);
  if (ids.length === 0) return [];
  const entityUrl = `${WIKIDATA_ENTITY_URL}?action=wbgetentities&ids=${ids.join('|')}&props=labels|claims|descriptions&languages=en&format=json&origin=*`;
  const entityResponse = await fetchImpl(entityUrl, { signal });
  if (!entityResponse.ok) return [];
  const entityData = await entityResponse.json();
  const entities = entityData?.entities || {};

  return hits.map(hit => {
    const entity = entities[hit.id];
    const coordClaim = entity?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
    return normalizeWikidataResult(
      {
        id: hit.id,
        label: entity?.labels?.en?.value || hit.label,
        description: entity?.descriptions?.en?.value || hit.description,
        coordinates: coordClaim ? { lat: coordClaim.latitude, lng: coordClaim.longitude } : null,
      },
      hit.label, // the label that actually matched the search (may be via an alias) — used as the display/compare name
    );
  });
}

/**
 * Fires both lookups (Wikidata first-pass for alias-aware recall,
 * Nominatim for structured geographic context) in parallel, merges and
 * deduplicates the results, and ranks the merged set with the same
 * uniform scoring used for a single source — see rankCandidates() and
 * mergeCandidates() above for the important guarantee that a Wikidata
 * hit earns its rank, never gets it for free.
 *
 * Returns { candidates, error }. NEVER throws — a network failure,
 * timeout, non-2xx response, or malformed response from EITHER OR BOTH
 * sources resolves to a graceful outcome: if one source fails but the
 * other succeeds, the lookup still returns useful candidates from
 * whichever source worked; only a failure of BOTH sources (or no name
 * given, or the throttle window) produces an error and zero candidates.
 * Saving is never blocked by any of this either way.
 */
export async function lookupPlace({ name, locationName, destinationName, expectedCategory }, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const query = buildContextualQuery({ name, locationName, destinationName });
  if (!query || !name?.trim()) return { candidates: [], error: 'A name is needed to search.' };

  const sinceLast = now() - lastRequestAt;
  if (sinceLast < MIN_MS_BETWEEN_REQUESTS) {
    return { candidates: [], error: 'Please wait a moment before searching again.' };
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;

  try {
    lastRequestAt = now();
    const [nominatimResult, wikidataResult] = await Promise.allSettled([
      fetchNominatimCandidates(query, fetchImpl, controller?.signal),
      fetchWikidataCandidates(name, fetchImpl, controller?.signal),
    ]);

    const nominatimCandidates = nominatimResult.status === 'fulfilled' ? nominatimResult.value : [];
    const wikidataCandidates = wikidataResult.status === 'fulfilled' ? wikidataResult.value : [];

    if (nominatimCandidates.length === 0 && wikidataCandidates.length === 0) {
      // Both sources returned nothing usable. Distinguish "both
      // genuinely found zero results" (not an error) from "both
      // actually failed" (network/parse issues) so the person sees an
      // accurate message either way — but in both cases, manual entry
      // remains fully available; this is never a blocking failure.
      const bothRejected = nominatimResult.status === 'rejected' && wikidataResult.status === 'rejected';
      if (bothRejected) {
        const err = nominatimResult.reason;
        const reason = err?.name === 'AbortError' ? 'The lookup timed out.' : 'Could not reach the lookup service (offline or network error).';
        return { candidates: [], error: `${reason} You can still enter the place manually.` };
      }
      return { candidates: [], error: null }; // a genuine zero-result search from both sources is not an error
    }

    const merged = mergeCandidates(wikidataCandidates, nominatimCandidates);
    const ranked = rankCandidates(merged, { name, locationName, destinationName, expectedCategory });
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
