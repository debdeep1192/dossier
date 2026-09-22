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
 * A single, deterministic ALTERNATE-SPELLING variant: collapses a
 * doubled vowel ("oo") to its single-letter equivalent ("u") — e.g.
 * "Ghoom" -> "Ghum". This is not a guess: it is a real, well-attested
 * pattern in how Indian-subcontinent place names ended up with two
 * common English spellings (the Wikipedia article for the actual
 * place this was investigated against is titled "Ghum railway
 * station", with "Ghoom" documented across multiple independent
 * sources as the common alternate spelling of the same "oo"-sound
 * vowel) — the same pattern recurs elsewhere (Roorkee/Rurkee,
 * Coochbehar/Cuchbehar). It is deliberately narrow: ONLY "oo" -> "u",
 * not a general "collapse any doubled letter" rule (that mangles
 * unrelated real spellings, e.g. "Ghoom" -> "Ghom", which is not a
 * real spelling of anything) and not a general vowel-doubling rule
 * for "aa"/"ee"/"ii" (no concrete case in this codebase's own
 * investigation history justifies those; adding them speculatively
 * would be exactly the kind of unjustified generalization this
 * module avoids elsewhere).
 *
 * Returns null when the transform doesn't actually change anything
 * (no "oo" present) — callers use this to decide whether the extra
 * discovery request is worth making at all.
 */
export function buildSpellingVariant(name) {
  if (!name) return null;
  const variant = name.replace(/oo/gi, (m) => (m === m.toUpperCase() ? 'U' : 'u'));
  return variant !== name ? variant : null;
}

/**
 * A single, deterministic PUNCTUATION variant for a common, narrow
 * case: a name typed WITHOUT a possessive apostrophe that a real
 * place's indexed name actually has (e.g. "Glenarys" vs the real
 * "Glenary's"). This does NOT try every possible apostrophe insertion
 * position (which would be combinatorial — O(word length) variants
 * for a single word, most of them nonsensical) — it uses the ONE
 * structurally privileged position an English possessive apostrophe
 * can occur: immediately before a trailing "s". "Glenarys" matches
 * `<word ending in a letter><s>` and produces exactly ONE variant,
 * "Glenary's" — not seven.
 *
 * This is inherently imprecise in the other direction — plenty of
 * real place names ending in "s" are ordinary plurals, not missing
 * possessives (e.g. "Gardens", "Falls"), and this will generate a
 * grammatically-wrong variant for those too ("Garden's", "Fall's").
 * That is an accepted, bounded cost, not a correctness risk: a
 * variant that matches nothing simply returns zero candidates (same
 * as any other empty search), and a variant that happens to match
 * something still has to earn its rank normally through
 * nameSimilarity/categoryScore against the ORIGINAL query in
 * rankCandidates() — it can never masquerade as a false positive.
 *
 * Nominatim's own indexing is WHY this specific position is the
 * useful one to try: Nominatim's default term-normalization replaces
 * punctuation with a SPACE rather than removing it, so an indexed
 * name like "Glenary's" is tokenized internally as {"glenary", "s"} —
 * a query of "Glenarys" (one token, {"glenarys"}) cannot match that at
 * the index level no matter how well our own nameSimilarity() would
 * score the two strings once a candidate exists (it already scores
 * them as identical — the gap is entirely upstream of ranking).
 * Trying "Glenary's" as an actual query produces the SAME token split
 * {"glenary", "s"} the index was built from.
 *
 * Returns null when the name doesn't end in that specific pattern (no
 * extra request is generated for the common case).
 */
export function buildPunctuationVariant(name) {
  if (!name) return null;
  const match = name.match(/^(.*[A-Za-z])s$/);
  if (!match) return null;
  return `${match[1]}'s`;
}

// A SMALL, fixed map of entity-type words (see ENTITY_TYPE_WORDS
// below) to a more provider-friendly synonym, used only by
// buildEntityTypeSynonymVariant() for a bounded, deterministic
// discovery query — never for ranking/display, and never a general
// synonym/thesaurus mechanism. The only entry today is the one
// concretely investigated and confirmed: live provider testing showed
// Nominatim returns nothing useful for "zoo" as a query word, but
// does return the real place for "zoological park" — the formal term
// actually used in the real facility's own name/OSM tagging. Adding
// further entries requires the same kind of concrete, investigated
// justification — this is deliberately not a place to speculatively
// grow a general vocabulary.
const ENTITY_TYPE_DISCOVERY_SYNONYMS = {
  zoo: 'zoological park',
};

/**
 * A single, deterministic DISCOVERY-QUERY variant: replaces a whole,
 * standalone entity-type word (see ENTITY_TYPE_DISCOVERY_SYNONYMS
 * above) with a more provider-friendly synonym for the search request
 * only — e.g. "zoo" -> "zoological park", "Darjeeling zoo" ->
 * "Darjeeling zoological park". This exists for exactly the same
 * reason buildSpellingVariant/buildPunctuationVariant do: the
 * provider's own indexed text can differ from the word a person
 * naturally types, and trying the provider-preferred term as an
 * ADDITIONAL query (never a replacement of what's shown/ranked) can
 * surface a real result the original query alone would miss.
 *
 * Deliberately narrow and word-boundary-safe: only a whole word is
 * replaced (a regex word boundary on both sides), so this never
 * mangles a word that merely CONTAINS "zoo" as a substring (e.g. it
 * would not touch a hypothetical place name like "Zootopia Cafe").
 * Only ONE synonym per query is substituted per call — matching the
 * "small, deterministic, no explosion" discipline every other variant
 * builder in this file follows; this is not a general
 * find-and-replace-every-match utility.
 *
 * Returns null when no entity-type word from the synonym map appears
 * in the name at all — callers use this to decide whether the extra
 * discovery request is worth making.
 */
export function buildEntityTypeSynonymVariant(name) {
  if (!name) return null;
  for (const [word, synonym] of Object.entries(ENTITY_TYPE_DISCOVERY_SYNONYMS)) {
    const pattern = new RegExp(`\\b${word}\\b`, 'i');
    if (pattern.test(name)) {
      return name.replace(pattern, synonym);
    }
  }
  return null;
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

// A small, deterministic set of entity-type/facility nouns — used
// ONLY to answer "did the fallback mechanism drop a word that changes
// what KIND of place was being asked for" (see the entity-type-drop
// detection in lookupPlace below) and to let CATEGORY_HINTS reason
// about a query's implied category. This is deliberately NOT used
// inside nameSimilarity — text similarity and category/entity-type
// matching are two different questions ("how similar are these
// names?" vs "is this the kind of place asked for?") and conflating
// them by deweighting these words inside name-similarity math was
// tried and found to be a genuine bug: it also weakens the penalty
// for a candidate that's MISSING the category information entirely,
// letting e.g. a bare locality named "Ghoom" score an inflated 0.667
// similarity against a query for "Ghoom Railway Station" (only one of
// three words actually shared) instead of the honest, plain ~0.333 —
// see nameSimilarity's own tests for the concrete regression case.
// Deliberately NOT a list of specific places (that would be exactly
// the kind of per-place hardcoding this module avoids elsewhere) and
// deliberately NOT including geographic-feature words like "hill",
// "peak", "valley", "lake", "river", or "mountain" — those are very
// often the actual distinctive part of a real proper name (e.g.
// "Tiger Hill" itself), so treating them as generic/entity-type would
// be wrong in the opposite direction. Kept intentionally short: a
// small, defensible core of facility/institution nouns, not an
// attempt at an exhaustive taxonomy.
const ENTITY_TYPE_WORDS = new Set([
  'station', 'railway', 'temple', 'hotel', 'restaurant', 'museum',
  'market', 'monastery', 'palace', 'fort', 'garden', 'zoo', 'bridge',
  'tower', 'monument', 'church', 'viewpoint', 'observatory',
]);

/**
 * True when `matchedName` is a genuine FALLBACK of `originalName`
 * (see buildFallbackNames — matchedName is always originalName with
 * zero or more TRAILING words dropped) AND at least one of the
 * dropped words is an entity-type word (see ENTITY_TYPE_WORDS above).
 * Used by lookupPlace to set matchedViaEntityTypeDrop — see its own
 * doc comment for what that flag means and how callers should use it.
 *
 * Deliberately simple: just a set difference on lowercased tokens, no
 * numeric threshold. "Tiger Hill Observatory" -> "Tiger Hill" drops
 * {"observatory"} — an entity-type word, so true. "Old Tiger Hill" ->
 * "Tiger Hill" drops {"old"} — not an entity-type word, so false.
 * "Tiger Hill" matched directly (matchedName === originalName) always
 * returns false, since nothing was dropped at all.
 */
function droppedAnEntityTypeWord(originalName, matchedName) {
  if (!originalName || !matchedName || originalName.trim().toLowerCase() === matchedName.trim().toLowerCase()) return false;
  const originalWords = originalName.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matchedWords = new Set(matchedName.trim().toLowerCase().split(/\s+/).filter(Boolean));
  const dropped = originalWords.filter(w => !matchedWords.has(w));
  return dropped.some(w => ENTITY_TYPE_WORDS.has(w));
}

/**
 * A pure, dependency-injectable string-similarity score in [0, 1].
 * Deliberately simple (normalized, plain token overlap) rather than a
 * full edit-distance library — good enough to separate "Ganesh
 * Temple" from "Ganesha Mandir Restaurant" without adding a
 * dependency for it.
 *
 * Every token counts equally, including entity-type/category words
 * (station, temple, museum...) — see ENTITY_TYPE_WORDS above for why
 * this is deliberate: whether a candidate is the RIGHT KIND of place
 * is categoryScore/osmClass's job (see rankCandidates below), not
 * this function's. A candidate that's missing a category word the
 * query asked for should score honestly lower here, not get a nearly
 * free pass because that word was pre-discounted.
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
 * When a duplicate is found, the NOMINATIM version is kept as the
 * base candidate (it has a fuller structured address for
 * locality/city display — see buildConfirmedPlace) — but its `name`
 * field is replaced with whichever of the two names is actually the
 * more informative match to what was searched (see `queryName`
 * below), so a real, structural difference in what each source
 * happened to call the place doesn't silently hide the more useful
 * one. Every other field (displayName, lat, lng, addressCity,
 * addressCountry, osmClass, importance) always stays Nominatim's,
 * unconditionally — this is a name-only substitution, never a
 * wholesale swap of which source's data is used.
 *
 * Concretely, this is what lets a station that Nominatim's own
 * address data calls "Ghoom" (its containing locality's spelling) but
 * whose real Wikidata label is "Ghum railway station" surface the
 * latter — the more specific, more informative name — as `name`,
 * while every geographic/category field the person actually depends
 * on (coordinates, address, category) still comes from Nominatim's
 * fuller structured data, unchanged.
 *
 * `queryName` (optional) is the original name the person typed — used
 * ONLY to judge "more informative" via the existing nameSimilarity()
 * (the same signal ranking itself uses, not a new heuristic). When
 * omitted (e.g. the fetchRound() call site below, which merges two
 * Nominatim-sourced lists and has no Wikidata side to compare against
 * at all), the Nominatim name is always kept exactly as before — this
 * substitution only ever applies to an actual Wikidata/Nominatim
 * duplicate pair.
 */
export function mergeCandidates(wikidataCandidates, nominatimCandidates, queryName) {
  const merged = [...nominatimCandidates];
  for (const wd of wikidataCandidates) {
    const duplicateIndex = merged.findIndex(nom => {
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
    if (duplicateIndex === -1) {
      merged.push(wd);
      continue;
    }
    // A real duplicate — keep the Nominatim candidate as the base
    // (unchanged structured data), but swap in whichever name is the
    // more informative match to the original query, when we have a
    // query to judge that against.
    if (queryName) {
      const nom = merged[duplicateIndex];
      if (nameSimilarity(queryName, wd.name) > nameSimilarity(queryName, nom.name)) {
        merged[duplicateIndex] = { ...nom, name: wd.name };
      }
    }
  }
  return merged;
}

// A rough category->OSM-class hint table, used only to mildly bias
// ranking (never to filter results out entirely) — kept intentionally
// small and forgiving, since OSM tagging is inconsistent in practice.
export const CATEGORY_HINTS = {
  // 'railway' added: a real railway station (e.g. a heritage/scenic
  // line station) is a legitimate, common tourist attraction — the
  // Ghum railway station investigation found this class was missing,
  // causing a genuine, correctly-tagged railway landmark to be scored
  // as "wrong category" (0.2) for an Attractions search, which is
  // simply incorrect independent of any specific place.
  attraction: { classes: ['tourism', 'historic', 'amenity', 'leisure', 'natural', 'railway'] },
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
 * when `includeExtraVariants` is set, ADDITIONAL, separate Nominatim
 * requests for a small, fixed set of deterministic query variants,
 * each fired in parallel with the others:
 *
 *   - the BARE place name, with no city/destination appended;
 *   - a SPELLING variant (see buildSpellingVariant) — a doubled-vowel
 *     collapse, e.g. "Ghoom" -> "Ghum";
 *   - a PUNCTUATION variant (see buildPunctuationVariant) — a missing
 *     possessive apostrophe restored in its one structurally-valid
 *     position, e.g. "Glenarys" -> "Glenary's";
 *   - an ENTITY-TYPE SYNONYM variant (see buildEntityTypeSynonymVariant)
 *     — a whole entity-type word swapped for a more provider-friendly
 *     synonym, e.g. "zoo" -> "zoological park". Unlike the bare-name
 *     variant, this ONE keeps the city/destination context (built via
 *     the same buildContextualQuery as the primary query) — the
 *     underlying problem here isn't word-boundary parsing, it's that
 *     the query word itself doesn't match what the provider's data
 *     actually calls the category of place.
 *
 * Every variant is generated from the NAME (not the already-built
 * contextualized `query` string) and then re-contextualized with
 * buildContextualQuery — this matters for the punctuation variant in
 * particular, whose pattern only makes sense checked against the
 * place name itself, not wherever the full "<name>, <city>,
 * <destination>" string happens to end. Each variant is skipped
 * entirely when it doesn't actually change the name (see each
 * builder's own null case), and the resulting queries are
 * deduplicated against the primary query and against each other — so
 * a query with no doubled vowel and no missing-possessive pattern
 * fires ZERO extra requests, and a query matching only one of the two
 * patterns fires exactly one extra request, never more than the
 * number of DISTINCT variants that actually apply.
 *
 * Why these exist at all: both providers match against their own
 * indexed name/label text, not open-ended natural language — see each
 * variant builder's own doc comment for the specific, evidence-based
 * reasoning behind each one (Nominatim's documented word-boundary
 * parsing limitation for the bare-name case; Nominatim's
 * punctuation-to-space normalization for the punctuation case; a
 * well-attested English-transliteration pattern for the spelling
 * case). None of this is fuzzy/approximate matching: every variant is
 * still an exact, literal query sent to the same real providers —
 * nothing is invented — and every candidate found this way still has
 * to earn its rank normally against the FULL original name in
 * rankCandidates() (see lookupPlace below).
 *
 * `includeExtraVariants` is only ever true for the FIRST attempt in
 * lookupPlace()'s retry sequence — see the comment there for why this
 * is deliberately not repeated for every fallback/broader-name
 * attempt (bounded request growth: a fallback name is already
 * shortened/simplified, so it doesn't carry the same discovery risk
 * the full name does, and repeating these per fallback tier would
 * grow request count with every word in the original name).
 *
 * All variant results are merged straight into the SAME
 * `nominatimCandidates` array the contextualized request produces
 * (deduplicated against it with the normal candidate-dedup logic in
 * mergeCandidates — see below), so nothing downstream (ranking,
 * merging with Wikidata, the caller) needs to know or care how many
 * separate Nominatim requests happened this attempt; it's just a
 * fuller Nominatim candidate set.
 */
async function fetchRound(name, query, fetchImpl, signal, { includeExtraVariants = false, locationName, destinationName } = {}) {
  const requests = [
    fetchNominatimCandidates(query, fetchImpl, signal),
    fetchWikidataCandidates(name, fetchImpl, signal),
  ];

  // Collect every candidate EXTRA query for this attempt, then
  // deduplicate (case-insensitively) against the primary query and
  // against each other, so a name matching more than one variant rule
  // still only ever fires each genuinely distinct string once.
  //
  // The spelling/punctuation variants are computed from the NAME
  // alone, then re-contextualized with buildContextualQuery — not
  // computed by transforming the already-built contextual `query`
  // string directly. This matters for the punctuation variant in
  // particular: its pattern (a trailing "s") must be checked against
  // the actual place name, not wherever the full "<name>, <city>,
  // <destination>" string happens to end (which is usually the city
  // or destination, not the name at all).
  const extraQueries = [];
  if (includeExtraVariants) {
    const trimmedName = (name || '').trim();
    const spellingVariantName = buildSpellingVariant(trimmedName);
    const punctuationVariantName = buildPunctuationVariant(trimmedName);
    const synonymVariantName = buildEntityTypeSynonymVariant(trimmedName);
    const candidates = [
      trimmedName, // the bare name, no city/destination context
      spellingVariantName ? buildContextualQuery({ name: spellingVariantName, locationName, destinationName }) : null,
      punctuationVariantName ? buildContextualQuery({ name: punctuationVariantName, locationName, destinationName }) : null,
      // The entity-type-synonym variant keeps context (unlike the
      // bare-name variant above) — it uses the EXISTING contextual
      // Nominatim mechanism, just with the query word swapped for a
      // more provider-friendly synonym (see
      // buildEntityTypeSynonymVariant's own doc comment for why: a
      // bare, unqualified "zoo" is ambiguous/underspecified for
      // Nominatim, but "zoological park" — the term the real facility
      // actually uses — combined with the SAME city/destination
      // context the primary query already carries, is what live
      // testing showed actually finds it).
      synonymVariantName ? buildContextualQuery({ name: synonymVariantName, locationName, destinationName }) : null,
    ].filter(Boolean);
    const seen = new Set([query.trim().toLowerCase()]);
    for (const c of candidates) {
      const key = c.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      extraQueries.push(c);
    }
  }
  for (const q of extraQueries) requests.push(fetchNominatimCandidates(q, fetchImpl, signal));

  const settled = await Promise.allSettled(requests);
  const [nominatimResult, wikidataResult, ...extraResults] = settled;

  const nominatimCandidates = nominatimResult.status === 'fulfilled' ? nominatimResult.value : [];
  // Merge every extra-variant Nominatim result into the same list the
  // contextualized query produced, one at a time, reusing the exact
  // proximity/name dedup logic already used for Wikidata results —
  // mergeCandidates() only cares about (lat, lng, name), not which
  // request or variant a candidate came from.
  let combinedNominatimCandidates = nominatimCandidates;
  for (const result of extraResults) {
    const extraCandidates = result.status === 'fulfilled' ? result.value : [];
    if (extraCandidates.length > 0) combinedNominatimCandidates = mergeCandidates(extraCandidates, combinedNominatimCandidates);
  }

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
 * Returns { candidates, error, matchedName, matchedViaEntityTypeDrop }.
 * `matchedName` is the exact name variant that actually produced
 * results (the original name, unless a fallback variant is what
 * succeeded) — purely informational for callers/tests; ranking and
 * the returned candidates are unaffected by which variant matched.
 * Callers (see PlaceLookup.jsx) can compare this to the name the
 * person actually typed to show a "broader search" indication rather
 * than presenting a fallback-sourced result as though it were an
 * exact match.
 *
 * `matchedViaEntityTypeDrop` is true specifically when matchedName
 * came from a FALLBACK attempt (word-dropping, see buildFallbackNames)
 * AND at least one of the words dropped between the original name and
 * matchedName is an entity-type/facility word (see ENTITY_TYPE_WORDS)
 * — e.g. "Tiger Hill Observatory" falling back to "Tiger Hill" drops
 * "observatory", a real entity-type word, so this is true; "Old Tiger
 * Hill" falling back to "Tiger Hill" drops only "old", so this is
 * false. This is never true when matchedName === name (nothing was
 * dropped), and never true when the extra-variant mechanism (bare
 * name / spelling / punctuation — see fetchRound above) is what found
 * the result rather than a fallback, since those are alternative
 * DISCOVERY of the SAME requested name, not a broadening to a
 * different one. Purely a presentation signal for the caller — it
 * never filters or re-ranks anything.
 *
 * NEVER throws — timeout, non-2xx response, or malformed response from
 * EITHER OR BOTH sources resolves to a graceful outcome: if one
 * source fails but the other succeeds, the lookup still returns
 * useful candidates from whichever source worked; only a failure of
 * BOTH sources (or no name given, or the throttle window) produces an
 * error and zero candidates. Saving is never blocked by any of this
 * either way.
 *
 * The FIRST attempt (the full name as typed) also fires additional
 * discovery-variant Nominatim requests alongside its normal
 * contextualized one — see fetchRound()'s doc comment above for why,
 * and the loop below for why these are never repeated on fallback
 * attempts.
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
      // The extra discovery-variant Nominatim requests (bare name,
      // spelling variant, punctuation variant — see fetchRound's own
      // doc comment for why each exists) are only ever fired on this
      // FIRST attempt (i === 0), never repeated for the progressively
      // shorter fallback names below it — a fallback name is already
      // a shortened, simpler string, so it doesn't carry the same
      // discovery risk the full name does, and firing these extra
      // requests per fallback tier would grow request count with
      // every additional word in the original name, which is exactly
      // the unbounded growth this stays deliberately clear of.
      const round = await fetchRound(attempt.attemptName, attempt.query, fetchImpl, controller?.signal, { includeExtraVariants: i === 0, locationName, destinationName });
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

    const merged = mergeCandidates(wikidataCandidates, nominatimCandidates, name);
    // Ranking always scores against the FULL name the person actually
    // typed, even when a shortened fallback variant is what produced
    // results — a candidate found via the "Tiger Hill" fallback still
    // has to earn its rank against "Tiger Hill Observatory" like any
    // other candidate, not get a free pass for matching a truncated
    // query.
    const ranked = rankCandidates(merged, { name, locationName, destinationName, expectedCategory });
    return { candidates: ranked, error: null, matchedName, matchedViaEntityTypeDrop: droppedAnEntityTypeWord(name, matchedName) };
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
