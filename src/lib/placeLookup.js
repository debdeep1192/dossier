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
 * Given the name as typed, returns progressively shorter fallback
 * variants by dropping ONE trailing word at a time — e.g. "Tiger Hill
 * Observatory" -> ["Tiger Hill"] (stops before reducing to a single
 * word only if there's already just one). This exists because both
 * providers match against their own indexed name/label text
 * (Nominatim: OSM name/alt_name tags; Wikidata's wbsearchentities: a
 * prefix match against labels/aliases — see fetchWikidataCandidates
 * above) rather than doing open-ended natural-language search: a
 * genuinely real, correctly-named place ("Tiger Hill") can return
 * ZERO results for a query that adds a plausible-sounding but
 * unindexed extra word ("Tiger Hill Observatory" — "Observatory" is a
 * colloquial description of the viewpoint atop the hill, not part of
 * its indexed name in either source).
 *
 * This is a controlled, well-reasoned fallback, not fuzzy matching:
 * every variant is still an exact, literal query sent to the same
 * real providers — nothing is invented, and the ranking step
 * afterwards still scores each real result against the FULL name the
 * person actually typed (see lookupPlace below), so an unrelated
 * result that happens to match a shortened query still has to earn
 * its rank normally; it is never accepted blindly.
 */
export function buildFallbackNames(name) {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  const variants = [];
  for (let end = words.length - 1; end >= 1; end--) {
    variants.push(words.slice(0, end).join(' '));
  }
  return variants;
}

/**
 * Builds the contextual query Nominatim uses: "<name>, <city/location>,
 * <country/destination>" — omitting any part that's blank, AND
 * collapsing a part that's the same place as one already included
 * (case-insensitively) so a destination and city that share a name
 * (e.g. destination "Darjeeling" + city "Darjeeling") don't produce a
 * redundant "Glenary's, Darjeeling, Darjeeling" query — a repeated
 * term adds nothing for Nominatim to match against and, in practice,
 * only risks diluting/confusing its matching versus the same query
 * written once. This is the ONE place this string is built.
 */
export function buildContextualQuery({ name, locationName, destinationName }) {
  const parts = [];
  const seen = new Set();
  for (const raw of [name, locationName, destinationName]) {
    const s = (raw || '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(s);
  }
  return parts.join(', ');
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
 * Turns a SELECTED candidate (already ranked/displayed by lookupPlace)
 * into the { name, locality, city, lat, lng } shape saved onto the
 * record's `place` field — this is a separate, deliberately narrow
 * step from ranking: ranking's `addressCity` (see
 * normalizeNominatimResult above) is an internal, intentionally loose
 * blob of every administrative level Nominatim returned (city, town,
 * village, county, state all concatenated) — good enough for a
 * "does this candidate look like it's roughly in the right place?"
 * ranking heuristic, but never meant to be shown or saved as a clean
 * city name. Using it directly as the saved city produced results
 * like "Rangli Rangliot Jorebunglow Sukiapokhri West Bengal" for a
 * remote hilltop with no city/town/village tag of its own — a
 * genuine bug, not a one-off.
 *
 * `knownCityName`, when provided, is the CITY ALREADY ESTABLISHED BY
 * THE USER'S CURRENT DOSSIER CONTEXT (the City the Add flow/section
 * page is already scoped to — see LocationScopeField.jsx and how
 * AttractionsPage.jsx passes `locationName` down to PlaceField ->
 * PlaceLookup). This is the generic mechanism the requirement asks
 * for: it works for ANY destination/city, not just Darjeeling,
 * because it's driven entirely by whatever city context the caller
 * already has — nothing here is hardcoded to a specific place name.
 * When known, it is ALWAYS preferred over the geocoder's own city
 * guess, preserving the Dossier hierarchy the user already selected;
 * only the provider's finer-grained locality detail (suburb,
 * neighbourhood, or — for Nominatim results with no such tag, like a
 * hilltop natural feature — the provider's own more specific address
 * component below city level) is taken from the candidate, and it
 * goes into `locality` (the existing "Area / locality" field), never
 * into `city`. This never creates a new Dossier City record — `city`
 * here is always the free-text field on the entry's `place` object,
 * completely separate from the record's real locationId (see
 * LocationScopeField.jsx) — so there's no risk of a provider string
 * silently becoming a Dossier City.
 *
 * When no city context is known yet (e.g. the record isn't scoped to
 * a specific city), this falls back to ONLY the genuine city-level
 * Nominatim tags (city/town/village) — never county/state — so the
 * saved city is either a real city-level place name or blank, never
 * the noisy multi-level concatenation.
 */
export function buildConfirmedPlace(candidate, knownCityName) {
  const addr = candidate.raw?.address || {};
  // The most specific sub-city detail Nominatim offers, in descending
  // specificity — whichever is present first. Falls through to the
  // county/state level ONLY as a locality/Area value (never as city),
  // since for a remote feature (a hilltop, a viewpoint) that may be
  // the only geographic detail available at all, and it's still more
  // useful there than nowhere.
  const fineLocality = addr.suburb || addr.neighbourhood || addr.village || addr.hamlet || addr.county || addr.state || '';
  const providerCityLevel = addr.city || addr.town || addr.village || '';

  const knownCity = (knownCityName || '').trim();
  const city = knownCity || providerCityLevel;

  // If we're using the known Dossier city, and the provider's
  // city-level guess is something different and more specific (e.g.
  // the provider found a town/village distinct from the broader city
  // context), surface that as locality too, so nothing the provider
  // told us is silently discarded — it just doesn't overwrite the
  // established City.
  const providerCityDiffersFromKnown = knownCity && providerCityLevel && providerCityLevel.toLowerCase() !== knownCity.toLowerCase();
  const locality = providerCityDiffersFromKnown && !fineLocality ? providerCityLevel : fineLocality;

  return {
    name: candidate.name,
    locality,
    city,
    lat: candidate.lat,
    lng: candidate.lng,
  };
}

// A small, conservative set of generic facility/category nouns that
// appear in MANY real, unrelated place names (any city has a
// "Railway Station", a "Temple", a "Market"...) — when a query shares
// only these words with a candidate, that overlap carries much less
// identifying information than sharing a distinctive word does (e.g.
// "Ghoom" or "Glenary's" or "Tiger"). Deliberately NOT a list of
// specific places (that would be exactly the kind of per-place
// hardcoding this module avoids elsewhere) and deliberately NOT
// including geographic-feature words like "hill", "peak", or
// "valley" — those are very often the actual distinctive part of a
// real proper name (e.g. "Tiger Hill" itself), so treating them as
// generic would be wrong in the opposite direction. Kept intentionally
// short: a small, defensible core of facility/institution nouns, not
// an attempt at an exhaustive dictionary.
const GENERIC_PLACE_WORDS = new Set([
  'station', 'railway', 'temple', 'hotel', 'restaurant', 'museum',
  'market', 'monastery', 'palace', 'fort', 'garden', 'zoo', 'bridge',
  'tower', 'monument', 'church', 'viewpoint', 'observatory',
]);

// How much a generic word (see GENERIC_PLACE_WORDS) counts toward the
// overlap score, relative to a distinctive word (which always counts
// as 1). Not 0 — a generic word matching is still a mild, real signal
// (a query for "Station" should still count a plausible station
// candidate a little higher than a completely unrelated one) — just
// not treated as equally informative as a distinctive word. This is a
// deliberately simple, fixed constant, not a tuned/derived threshold:
// it only needs to be small enough that one distinctive-word match
// outweighs several generic-word matches, which 0.25 comfortably is.
const GENERIC_WORD_WEIGHT = 0.25;

/**
 * A pure, dependency-injectable string-similarity score in [0, 1].
 * Deliberately simple (normalized, genericness-aware token overlap)
 * rather than a full edit-distance library — good enough to separate
 * "Ganesh Temple" from "Ganesha Mandir Restaurant" without adding a
 * dependency for it.
 *
 * Generic facility/category words (see GENERIC_PLACE_WORDS above)
 * contribute less to the score than distinctive words — this is what
 * lets "Ghoom Railway Station" correctly prefer a candidate actually
 * named after Ghoom over an unrelated "Darjeeling railway station"
 * that only shares the generic "railway"/"station" tokens: sharing
 * just those two would previously score identically to sharing the
 * one distinctive word, an exact, reproducible tie that let raw
 * Nominatim "importance" (which has no idea which candidate the
 * person actually meant) decide instead.
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

  const weightOf = (t) => (GENERIC_PLACE_WORDS.has(t) ? GENERIC_WORD_WEIGHT : 1);
  let overlapWeight = 0;
  let qWeight = 0;
  let cWeight = 0;
  for (const t of qTokens) qWeight += weightOf(t);
  for (const t of cTokens) cWeight += weightOf(t);
  for (const t of qTokens) if (cTokens.has(t)) overlapWeight += weightOf(t);

  // Same shape as the original formula's `overlap / Math.max(qSize,
  // cSize)` — never rewarding a candidate purely for being short —
  // but computed in weighted terms on BOTH sides, so two identical
  // strings always score exactly 1 regardless of which of their words
  // happen to be generic (overlapWeight == qWeight == cWeight in that
  // case).
  return overlapWeight / Math.max(qWeight, cWeight);
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
 * Fires the lookups for ONE specific attempt: Wikidata (alias-aware
 * recall) and Nominatim using the CONTEXTUALIZED query, always — plus,
 * when `includeBareNominatim` is set, an ADDITIONAL, separate Nominatim
 * request using ONLY the bare place name, with no city/destination
 * appended, fired in parallel with the other two.
 *
 * Why a bare-name Nominatim request at all: Nominatim's own free-form
 * parser has to work out where one part of the query ends and the
 * next begins, and its maintainers have documented that for queries
 * with many plausible word-boundary splits it can "give up before it
 * gets to the right solution" for performance reasons (a real,
 * acknowledged Nominatim limitation, not a guess). Appending
 * ", <city>, <destination>" to an already multi-word place name only
 * adds to that boundary-splitting burden. A bare-name request removes
 * it entirely, giving Nominatim its best unobstructed shot at parsing
 * the name as a whole phrase — independent of, and in addition to,
 * the existing contextualized request (which stays, since it's often
 * exactly what correctly disambiguates a common name between cities).
 *
 * `includeBareNominatim` is only ever true for the FIRST attempt in
 * lookupPlace()'s retry sequence — see the comment there for why it
 * is deliberately not repeated for every fallback/broader-name
 * attempt (bounded request growth).
 *
 * Any bare-name results are merged straight into the SAME
 * `nominatimCandidates` array the contextualized request produces
 * (deduplicated against it with the normal candidate-dedup logic in
 * mergeCandidates — see below), so nothing downstream (ranking,
 * merging with Wikidata, the caller) needs to know or care that two
 * separate Nominatim requests happened; it's just a fuller Nominatim
 * candidate set for this one attempt.
 */
async function fetchRound(name, query, fetchImpl, signal, { includeBareNominatim = false } = {}) {
  const requests = [
    fetchNominatimCandidates(query, fetchImpl, signal),
    fetchWikidataCandidates(name, fetchImpl, signal),
  ];
  // Only fired when the bare name actually differs from the
  // contextualized query (i.e. there really was city/destination
  // context appended) — when there's no context at all, `query` IS
  // already just the bare name, and firing a second, identical
  // request would be pure waste for zero additional recall.
  const shouldFetchBareName = includeBareNominatim && name && name.trim() && name.trim() !== query;
  if (shouldFetchBareName) requests.push(fetchNominatimCandidates(name, fetchImpl, signal));

  const [nominatimResult, wikidataResult, bareNominatimResult] = await Promise.allSettled(requests);

  const nominatimCandidates = nominatimResult.status === 'fulfilled' ? nominatimResult.value : [];
  const bareNominatimCandidates = bareNominatimResult?.status === 'fulfilled' ? bareNominatimResult.value : [];
  // Merge the bare-name Nominatim candidates into the same list the
  // contextualized query produced, deduplicating with the exact same
  // proximity/name logic already used to merge Wikidata results —
  // mergeCandidates() only cares about (lat, lng, name), not which
  // request a candidate came from, so this reuses it as-is with no
  // new merge logic needed.
  const combinedNominatimCandidates = shouldFetchBareName
    ? mergeCandidates(bareNominatimCandidates, nominatimCandidates)
    : nominatimCandidates;

  return {
    nominatimResult,
    wikidataResult,
    nominatimCandidates: combinedNominatimCandidates,
    wikidataCandidates: wikidataResult.status === 'fulfilled' ? wikidataResult.value : [],
  };
}

/**
 * Fires both lookups (Wikidata first-pass for alias-aware recall,
 * Nominatim for structured geographic context) in parallel, merges and
 * deduplicates the results, and ranks the merged set with the same
 * uniform scoring used for a single source — see rankCandidates() and
 * mergeCandidates() above for the important guarantee that a Wikidata
 * hit earns its rank, never gets it for free.
 *
 * If the exact name as typed returns nothing from EITHER source (not a
 * failure — a genuine zero-result search), this retries with
 * progressively shorter fallback names (see buildFallbackNames above)
 * — e.g. "Tiger Hill Observatory" retries as "Tiger Hill" — stopping
 * at the first variant that returns any real candidates. This is a
 * controlled retry against the same two real providers, not fuzzy
 * matching: it never invents a result, and every candidate returned
 * this way is still ranked normally against the FULL original name
 * (see rankCandidates() below), so an unrelated place that happens to
 * share the shortened query's words still has to earn its rank on
 * name similarity/location/category like any other candidate —
 * matching a shortened query is not the same as being accepted. A
 * fallback round is skipped entirely once any round (primary or
 * fallback) succeeds.
 *
 * Returns { candidates, error, matchedName }. `matchedName` is the
 * exact name variant that actually produced results (the original
 * name, unless a fallback variant is what succeeded) — purely
 * informational for callers/tests; ranking and the returned
 * candidates are unaffected by which variant matched. Callers (see
 * PlaceLookup.jsx) can compare this to the name the person actually
 * typed to show a "broader search" indication rather than presenting
 * a fallback-sourced result as though it were an exact match. NEVER
 * throws — timeout, non-2xx response, or malformed response from
 * EITHER OR BOTH sources resolves to a graceful outcome: if one
 * source fails but the other succeeds, the lookup still returns
 * useful candidates from whichever source worked; only a failure of
 * BOTH sources (or no name given, or the throttle window) produces an
 * error and zero candidates. Saving is never blocked by any of this
 * either way.
 *
 * The FIRST attempt (the full name as typed) also fires an additional
 * bare-name-only Nominatim request alongside its normal contextualized
 * one — see fetchRound()'s doc comment above for why, and the loop
 * below for why this is never repeated on fallback attempts.
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

    // Try the exact name as typed first, then — only if that round is
    // a genuine zero-result outcome from both sources, not a failure
    // — progressively shorter fallback variants. See buildFallbackNames.
    const attempts = [{ attemptName: name, query }, ...buildFallbackNames(name).map(fallbackName => ({
      attemptName: fallbackName,
      query: buildContextualQuery({ name: fallbackName, locationName, destinationName }),
    }))];

    let lastRound = null;
    let matchedName = name;
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      // The bare-name Nominatim request (see fetchRound's own doc
      // comment for why it exists) is only ever fired on this FIRST
      // attempt (i === 0), never repeated for the progressively
      // shorter fallback names below it — a fallback name is already
      // a shortened, simpler string, so it doesn't carry the same
      // word-boundary-parsing risk the full name does, and firing an
      // extra Nominatim request per fallback tier would grow request
      // count with every additional word in the original name, which
      // is exactly the unbounded growth this stays deliberately clear
      // of.
      const round = await fetchRound(attempt.attemptName, attempt.query, fetchImpl, controller?.signal, { includeBareNominatim: i === 0 });
      lastRound = round;
      if (round.nominatimCandidates.length > 0 || round.wikidataCandidates.length > 0) {
        matchedName = attempt.attemptName;
        break;
      }
      // Both sources failed outright (not just empty) — stop retrying
      // with fallback variants; a real network/timeout failure won't
      // be fixed by trying a shorter name, and retrying would just
      // multiply the same failure across several requests.
      if (round.nominatimResult.status === 'rejected' && round.wikidataResult.status === 'rejected') break;
    }

    const { nominatimCandidates, wikidataCandidates, nominatimResult, wikidataResult } = lastRound;

    if (nominatimCandidates.length === 0 && wikidataCandidates.length === 0) {
      // Both sources returned nothing usable, even after any fallback
      // attempts. Distinguish "both genuinely found zero results" (not
      // an error) from "both actually failed" (network/parse issues)
      // so the person sees an accurate message either way — but in
      // both cases, manual entry remains fully available; this is
      // never a blocking failure.
      const bothRejected = nominatimResult.status === 'rejected' && wikidataResult.status === 'rejected';
      if (bothRejected) {
        const err = nominatimResult.reason;
        const reason = err?.name === 'AbortError' ? 'The lookup timed out.' : 'Could not reach the lookup service (offline or network error).';
        return { candidates: [], error: `${reason} You can still enter the place manually.` };
      }
      return { candidates: [], error: null }; // a genuine zero-result search from both sources is not an error
    }

    const merged = mergeCandidates(wikidataCandidates, nominatimCandidates);
    // Ranking always scores against the FULL name the person actually
    // typed, even when a shortened fallback variant is what produced
    // results — a candidate found via the "Tiger Hill" fallback still
    // has to earn its rank against "Tiger Hill Observatory" like any
    // other candidate, not get a free pass for matching a truncated
    // query.
    const ranked = rankCandidates(merged, { name, locationName, destinationName, expectedCategory });
    return { candidates: ranked, error: null, matchedName };
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
//
// VERSIONING: the cached value's SHAPE is produced by
// buildConfirmedPlace() — e.g. which field (city vs locality) a given
// piece of provider data lands in. When that shape/logic changes (as
// it did: earlier code could save a raw multi-level admin-area string
// like "Rangli Rangliot Jorebunglow Sukiapokhri West Bengal" directly
// into `city`; buildConfirmedPlace() now never does that), an entry
// written by the OLD logic is not just "possibly out of date" the way
// a normal cache entry is — it can actively reintroduce a bug that
// was already fixed in the code, silently, forever, since
// localStorage persists across app updates and isn't tied to any
// build/version identifier on its own.
//
// CACHE_VERSION exists specifically to invalidate entries like that:
// bumping it changes the key prefix, so every entry written under a
// previous version is simply never looked up again — it is NOT
// deleted (per the requirement to never touch unrelated localStorage
// data; an old-prefix entry is left alone, inert, and will eventually
// age out on its own as browsers reclaim storage, exactly like any
// other unreachable key would), and a lookup under the new prefix is
// a clean cache miss, which every caller already treats as a normal,
// harmless "re-fetch" case — there is no special-casing needed
// anywhere else for this to be safe. Bump this whenever
// buildConfirmedPlace()'s output shape changes in a way that could
// make an old cached value wrong under the CURRENT logic.
const CACHE_VERSION = 2; // v2: buildConfirmedPlace() preserves known Dossier City / routes admin detail to locality instead of overwriting city (see buildConfirmedPlace above)
const CONFIRMED_CACHE_KEY_PREFIX = `dossier:placeLookupConfirmed:v${CACHE_VERSION}:`;

function cacheKey(name, locationName, destinationName) {
  return CONFIRMED_CACHE_KEY_PREFIX + buildContextualQuery({ name, locationName, destinationName }).toLowerCase();
}

// A second, independent layer of defense alongside the versioned key
// prefix above: even if two different code versions ever shared a key
// prefix (e.g. a hotfix that didn't bump CACHE_VERSION), a cached
// value that doesn't carry ITS OWN matching version stamp, or that
// doesn't look like a real buildConfirmedPlace() output at all (e.g.
// hand-edited storage, a future format, or storage shared with
// something else entirely), is treated as a miss rather than trusted
// verbatim — the caller re-fetches exactly as if nothing were cached.
function isValidCachedPlace(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.__cacheVersion === CACHE_VERSION &&
    typeof value.name === 'string',
  );
}

export function getCachedConfirmedResult({ name, locationName, destinationName }, { storage = safeLocalStorage() } = {}) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(cacheKey(name, locationName, destinationName));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidCachedPlace(parsed)) return null; // stale/foreign shape — treat exactly like a cache miss, never trust it
    // Strip the internal version stamp before handing the place back
    // to callers — it's cache bookkeeping, not part of the actual
    // place data (name/locality/city/lat/lng) they expect.
    const { __cacheVersion, ...place } = parsed;
    return place;
  } catch {
    return null;
  }
}

export function setCachedConfirmedResult({ name, locationName, destinationName }, confirmedPlace, { storage = safeLocalStorage() } = {}) {
  if (!storage) return;
  try {
    storage.setItem(cacheKey(name, locationName, destinationName), JSON.stringify({ ...confirmedPlace, __cacheVersion: CACHE_VERSION }));
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
