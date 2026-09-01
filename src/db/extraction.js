// ============================================================
// Document/text extraction adapter — conservative record detection.
//
// CORE PRINCIPLE (revised): a heading match alone never makes the
// content under it a candidate. The extractor instead classifies each
// line as one of: heading, table header, table row, schedule/itinerary,
// document meta-commentary, narrative prose, or record. Only "record"
// and "table row" lines ever become candidates.
//
// This replaces an earlier, too-restrictive version of this file whose
// rule was "only bulleted/numbered lines can be candidates." That rule
// under-extracted (real hotel/attraction names without a bullet
// character — common after PDF text extraction strips list markup —
// were never surfaced), and separately, a bug in the PDF extraction
// layer (see lib/pdfText.js) meant entire pages arrived as one
// unbroken line, which produced the opposite failure: whole pages of
// narrative becoming a single giant "candidate". Both are fixed here:
// pdfText.js now reconstructs real lines, and this file no longer
// gates candidacy on bullet characters — it gates on actual content
// signals (see classifyLine below), because real-world documents
// (especially PDF-extracted ones) frequently lose bullet markup
// entirely while still containing genuine, discrete, one-per-line
// facts ("Tiger Hill", "Dekeling Hotel", etc).
//
// The full original text is always preserved verbatim in the intake
// record regardless of what does or doesn't become a candidate.
// ============================================================

const SECTION_KEYWORDS = [
  { section: 'attractions', words: ['attraction', 'sight', 'things to see', 'things to do', 'places to visit'] },
  { section: 'restaurants', words: ['restaurant', 'food', 'eat', 'dining', 'cuisine', 'where to eat', 'must-try dish', 'dishes'] },
  { section: 'accommodations', words: ['hotel', 'stay', 'accommodation', 'lodging', 'where to sleep', 'where to stay'] },
  { section: 'transport', words: ['transport', 'getting around', 'getting there', 'travel between', 'how to reach'] },
  { section: 'costs', words: ['cost', 'budget', 'money', 'price', 'expense'] },
  { section: 'practicalInfo', words: ['practical', 'visa', 'safety', 'tips', 'connectivity', 'health', 'emergency'] },
  { section: 'weatherNotes', words: ['weather', 'season', 'best time', 'climate'] },
  { section: 'packingNotes', words: ['pack', 'what to bring', 'what to wear', 'gear'] },
  { section: 'shoppingItems', words: ['shopping', 'what to buy', 'souvenir'] },
];

// Headings/topics that are clearly background/narrative, not a
// list-of-records section — a heading match here deliberately does NOT
// set a proposed section, so content under it (even short lines) isn't
// misrouted into, say, Attractions just because "About Darjeeling"
// happens to share a document with an attractions list.
const NARRATIVE_HEADING_WORDS = ['about ', 'history', 'geography', 'overview', 'introduction', 'background'];

const ITINERARY_HEADING_WORDS = ['itinerary', 'day 1', 'day 2', 'day 3', 'day 4', 'day 5', 'schedule', 'day-by-day', 'daily plan'];

// The full vocabulary of words/phrases this extractor recognizes as
// heading-worthy. Used below to gate the riskiest heading-detection
// branch (a short, capitalized, unpunctuated phrase with no colon and
// not ALL CAPS) — without this gate, a bare record name like "Tiger
// Hill" or "Batasia Loop" is structurally indistinguishable from a
// genuine short heading like "About Darjeeling", since both are just
// 1-3 capitalized words with no trailing punctuation. Requiring a
// recognized vocabulary match on this specific branch resolves the
// ambiguity in favor of treating unrecognized short phrases as
// potential records (checked later by classifyLine) rather than
// silently swallowing them as an unmatched heading that produces
// nothing. The ALL-CAPS and trailing-colon branches remain
// unrestricted, since those are much stronger, less ambiguous heading
// signals on their own.
const ALL_HEADING_KEYWORDS = [
  ...SECTION_KEYWORDS.flatMap(s => s.words),
  ...NARRATIVE_HEADING_WORDS,
  ...ITINERARY_HEADING_WORDS,
];
function matchesKnownHeadingVocabulary(text) {
  const lower = text.toLowerCase();
  return ALL_HEADING_KEYWORDS.some(w => lower.includes(w));
}

function guessSectionFromHeading(headingText) {
  const lower = headingText.toLowerCase();
  if (ITINERARY_HEADING_WORDS.some(w => lower.includes(w))) return null;
  if (NARRATIVE_HEADING_WORDS.some(w => lower.includes(w))) return null;
  for (const { section, words } of SECTION_KEYWORDS) {
    if (words.some(w => lower.includes(w))) return section;
  }
  return null;
}

// A short label immediately followed by real content ("Emergency:
// Darjeeling Police, phone 0354-2254422", "Connectivity: Airtel and
// Jio both work reasonably well...") is a factual record, not a
// section heading, even though it's short and capitalized — this
// pattern is common for practical-info/cost/weather-style entries.
// Distinguished from a genuine heading ending in ':' ("Attractions:")
// by requiring real content after the colon, and from a narrative
// paragraph that merely happens to open with a label-like phrase
// ("Shopping commentary: Darjeeling tea is world famous and makes a
// wonderful gift...") by excluding labels that themselves name the
// text as commentary/narrative rather than a topic/fact.
const NON_RECORD_LABEL_WORDS = /\b(commentary|overview|summary|introduction|background|discussion|context|note)\b/i;
function hasShortLabelColonPattern(text) {
  const match = text.match(/^([A-Z][A-Za-z /]{1,25}):\s+\S/);
  if (!match) return false;
  return !NON_RECORD_LABEL_WORDS.test(match[1]);
}

// A heading in either conventional form ("Attractions & Activities",
// "Attractions:") or PDF-style ALL CAPS (which real PDF extraction
// commonly produces for section titles, e.g. "PRACTICAL INFORMATION" or
// descriptive sub-headings). ALL CAPS lines get a much more generous
// length allowance than mixed-case headings, since PDF sub-headings can
// run long ("NEAR MALL ROAD/CHOWRASTA UNDER 3,500/NIGHT FOR TWO
// ADULTS...") while still clearly not being a sentence of prose.
function isHeadingLine(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('#')) return true;
  if (trimmed.length === 0) return false;
  if (isAllCaps(trimmed) && trimmed.length <= 140) return true;
  if (trimmed.length > 60) return false;
  if (trimmed.endsWith(':') && trimmed.length < 40) return true;
  if (hasShortLabelColonPattern(trimmed)) return false;
  if (!/[.!?,]$/.test(trimmed) && /^[A-Z]/.test(trimmed) && trimmed.split(' ').length <= 6 && matchesKnownHeadingVocabulary(trimmed)) return true;
  return false;
}

function isAllCaps(text) {
  const letters = text.replace(/[^A-Za-z]/g, '');
  return letters.length >= 3 && letters === letters.toUpperCase();
}

function isListItemLine(line) {
  return /^\s*([-*•]|\d+[.)])\s+/.test(line);
}

function stripListMarker(line) {
  return line.replace(/^\s*([-*•]|\d+[.)])\s+/, '').trim();
}

// Separator-only line ("---", "===", "***", "___") — never a candidate,
// never a heading either.
function isSeparatorLine(line) {
  return /^[\s\-=*_]+$/.test(line) && line.trim().length > 0;
}

// Repeated PDF page header/footer that survived pdfText.js's own
// frequency-based stripping (defense in depth — also catches the same
// pattern in pasted plain text, e.g. someone pasting raw page-by-page
// copy). Matches things like "Darjeeling - The Complete Guide | 17/33"
// or "Page 4 of 12".
const PAGE_FOOTER_PATTERN = /\|\s*\d+\s*\/\s*\d+\s*$|^page\s+\d+\s+of\s+\d+$/i;
function isPageBoilerplate(line) {
  return PAGE_FOOTER_PATTERN.test(line.trim());
}

// Itinerary/schedule lines: start with a clock time or time range
// ("08:00–09:30 Breakfast", "6:00 AM Departure"), or are a bare
// "Morning" / "Lunch" / "Dinner" time-of-day slot line.
const TIME_PREFIX_PATTERN = /^\d{1,2}[:.]\d{2}\s*(am|pm|AM|PM)?\s*[–\-—]?\s*(\d{1,2}[:.]\d{2}\s*(am|pm|AM|PM)?)?/;
const TIME_SLOT_WORD_PATTERN = /^(morning|afternoon|evening|breakfast|lunch|dinner|night)\s*[:\-–]/i;
function looksLikeScheduleLine(text) {
  return TIME_PREFIX_PATTERN.test(text.trim()) || TIME_SLOT_WORD_PATTERN.test(text.trim());
}

// Explicit meta-commentary about the document/guide itself — never
// real travel content, so never worth surfacing even for review.
const META_PATTERNS = [
  /closing note/i,
  /scheduling note/i,
  /from the original document/i,
  /original (introductory )?(note|caveat)/i,
  /^note:/i,
  /^disclaimer/i,
  /^source( document)?:/i,
  /^reference:/i,
  /the guide is (explicitly )?built around/i,
  /this (guide|document|itinerary) is/i,
  /this itinerary was compiled/i,
];
function isMetaCommentary(text) {
  return META_PATTERNS.some(p => p.test(text));
}

// Phrases that strongly suggest narrative/editorial prose rather than a
// factual record, wherever they appear in a line (not just at the
// start) — used as one signal among several in classifyLine, not a
// standalone filter, since a record's Note field can legitimately
// mention e.g. "history" in passing ("Reopened after historic renovation").
const NARRATIVE_MARKER_PATTERN = /\b(this guide|this document|this itinerary|the guide|the author|evolution of|essentials|overview of|background on)\b/i;

// Looks for an unambiguous currency+amount pattern. Deliberately narrow
// — meant to catch clear cases ("LKR 1,500", "$20", "free", "₹2,800–3,400"),
// not to parse every possible price phrasing. Word-based codes (INR,
// USD, Rs...) and symbols (₹, $, €, £) are matched via separate
// alternatives rather than a single \b-anchored group, because \b
// requires a word-character transition and never matches immediately
// before a symbol character — a pattern with \b in front of the whole
// alternation would silently never match a bare leading "₹2,800",
// which is by far the most common way Indian prices are written.
const CURRENCY_PATTERN = /(?:\b(INR|USD|LKR|EUR|GBP|THB|AED|SGD|JPY|Rs\.?)\b|(₹|\$|€|£))\s?([\d][\d,]*(?:\.\d+)?)/i;

export function extractPriceFromText(text) {
  if (/\bfree\b/i.test(text)) return { amount: 0, currency: '', unit: '', note: 'Free' };
  const match = text.match(CURRENCY_PATTERN);
  if (!match) return null;
  const codeMatch = match[1];
  const symbolMatch = match[2];
  const symbolMap = { '₹': 'INR', '$': 'USD', '€': 'EUR', '£': 'GBP' };
  const currency = symbolMatch ? symbolMap[symbolMatch] : codeMatch.toUpperCase().replace('RS.', 'INR').replace('RS', 'INR');
  const amount = parseFloat(match[3].replace(/,/g, ''));
  return { amount, currency, unit: '', note: '' };
}

const RATING_PATTERN = /\b\d(?:\.\d)?\s*\/\s*(?:5|10)\b/;

function splitLabelAndRest(text) {
  const match = text.match(/^(.{2,60}?)\s*(?::|—|--| - )\s*(.+)$/);
  if (match) return { label: match[1].trim(), rest: match[2].trim() };
  return { label: text.trim(), rest: '' };
}

// ---- Narrative vs. record classification ----
//
// A line is treated as a candidate-worthy RECORD only when it shows a
// real signal of being a discrete factual item, not prose. No single
// signal is trusted alone — length and sentence structure work
// together with the presence of price/rating/label patterns, matching
// the instruction to use several signals together rather than one
// heuristic.
function classifyLine(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const sentenceEnders = (text.match(/[.!?]/g) || []).length;
  const hasNarrativeMarker = NARRATIVE_MARKER_PATTERN.test(text);
  const price = extractPriceFromText(text);
  const hasRating = RATING_PATTERN.test(text);
  const hasLabelPattern = /\b(address|price|rating|hours?|fee|location|area|phone|website|email)\s*[:=]/i.test(text)
    || hasShortLabelColonPattern(text);
  const hasTableDelimiters = splitTableRowCells(text) !== null;
  const hasStrongRecordSignal = Boolean(price) || hasRating || hasLabelPattern || hasTableDelimiters;

  // Long and/or multi-sentence and/or explicitly narrative-flavored
  // text is prose — UNLESS it also carries a strong record signal (a
  // compact table-style row can be a longer single line and still be a
  // genuine record, e.g. a hotel row with name/area/rating/price/note
  // all on one line).
  const looksNarrative = (wordCount > 28 || sentenceEnders >= 2 || hasNarrativeMarker) && !hasStrongRecordSignal;
  if (looksNarrative) return 'narrative';

  if (hasStrongRecordSignal) return 'record';

  // A short, capitalized, single-clause phrase with no sentence-ending
  // punctuation reads like a bare name ("Tiger Hill", "Windamere
  // Hotel") — the common case for a list that lost its bullet
  // character during PDF extraction.
  if (wordCount <= 12 && sentenceEnders === 0 && /^["'(]?[A-Z]/.test(text.trim())) return 'record';

  // Default: when there's no positive evidence either way, do not
  // create a candidate — conservative by design.
  return 'narrative';
}

// ---- Table row detection and column mapping ----

// Splits a line into cells if it shows clear tabular structure: either
// pipe-delimited (the strong, unambiguous signal) or, more loosely,
// three or more chunks separated by runs of 2+ spaces (common when a
// PDF loses its table borders but keeps column spacing). Returns null
// when the line doesn't look tabular at all — callers must not invent
// a table from ordinary prose that happens to have a double space.
function splitTableRowCells(text) {
  if ((text.match(/\s\|\s|\|/g) || []).length >= 2) {
    const cells = text.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 3) return cells;
  }
  const spaceCells = text.split(/\s{2,}/).map(c => c.trim()).filter(Boolean);
  if (spaceCells.length >= 3) return spaceCells;
  return null;
}

const COLUMN_ROLE_PATTERNS = [
  { role: 'name', pattern: /\b(hotel|restaurant|name|place|item|shop)\b/i },
  { role: 'area', pattern: /\b(area|location|locality|address|where)\b/i },
  { role: 'rating', pattern: /\b(rating|stars?)\b/i },
  { role: 'price', pattern: /\b(price|cost|fee|night|per)\b/i },
  { role: 'note', pattern: /\b(why|notes?|description|remarks?|comment|consider)\b/i },
];

function classifyColumns(headerCells) {
  return headerCells.map(cell => {
    for (const { role, pattern } of COLUMN_ROLE_PATTERNS) {
      if (pattern.test(cell)) return role;
    }
    return 'unknown';
  });
}

// A header row is short cells collectively covering several DIFFERENT
// recognized column roles — e.g. "Hotel | Area | Rating | Price/Night |
// Why Consider It" matches 5 distinct roles. Requiring more than one
// distinct role (not just any single keyword match anywhere) is what
// keeps this from misfiring on an actual data row whose own name
// happens to contain a column keyword — e.g. a hotel literally named
// "Hotel Seven Seventeen" would otherwise match the 'name' role pattern
// via substring and get mistaken for a header, silently swallowing that
// hotel's own row as if it were column labels.
function looksLikeTableHeaderRow(cells) {
  const allShort = cells.every(c => c.split(/\s+/).length <= 4);
  if (!allShort) return false;
  const roles = classifyColumns(cells);
  const distinctKnownRoles = new Set(roles.filter(r => r !== 'unknown'));
  return distinctKnownRoles.size >= 2;
}

function mapTableRowToFields(cells, columnRoles) {
  const roles = columnRoles && columnRoles.length === cells.length ? columnRoles : null;
  let name, area, rating, price, noteParts = [];

  if (roles) {
    cells.forEach((cell, i) => {
      const role = roles[i];
      if (role === 'name' && !name) name = cell;
      else if (role === 'area' && !area) area = cell;
      else if (role === 'rating' && !rating) rating = cell;
      else if (role === 'price' && !price) price = extractPriceFromText(cell) ? cell : (price || cell);
      else if (cell) noteParts.push(cell);
    });
  }

  // Fallback when there's no recognized header (or a cell-count
  // mismatch against one seen earlier): first cell is the name, the
  // first cell containing a price pattern is the price, everything
  // else is preserved as a note rather than discarded — per the "never
  // silently lose information" requirement.
  if (!name) name = cells[0];
  if (!price) {
    const priceCell = cells.find(c => extractPriceFromText(c));
    if (priceCell) price = priceCell;
  }
  if (!roles) {
    noteParts = cells.filter(c => c !== name && c !== price);
  }
  if (rating && !RATING_PATTERN.test(rating)) { noteParts.unshift(rating); rating = null; }

  return {
    name,
    area: area || null,
    rating: rating || null,
    price: price ? extractPriceFromText(price) : null,
    note: noteParts.filter(Boolean).join('; '),
  };
}

const REST_FIELD_BY_SECTION = {
  attractions: 'description',
  restaurants: 'dietaryNotes',
  accommodations: 'amenityNotes',
  transport: 'bookingNotes',
  costs: 'context',
  practicalInfo: 'details',
  weatherNotes: 'description',
  packingNotes: 'remarks',
  shoppingItems: 'notes',
  generalNotes: 'content',
};

const PLACE_BASED_SECTIONS = new Set(['attractions', 'restaurants', 'accommodations']);

function buildProposedFields(section, text) {
  if (!section) return {};
  const { label, rest } = splitLabelAndRest(text);
  const price = extractPriceFromText(text);
  const fields = {};

  if (PLACE_BASED_SECTIONS.has(section)) {
    fields.placeName = label;
  } else if (section === 'costs') {
    fields.item = label;
  } else if (section === 'practicalInfo') {
    fields.topic = label;
  } else if (section === 'weatherNotes') {
    fields.period = label;
  } else if (section === 'packingNotes') {
    fields.item = label;
  } else if (section === 'shoppingItems') {
    fields.name = label;
  } else if (section === 'generalNotes') {
    fields.title = label;
  }
  // transport: endpoints are too unreliable to guess from a single
  // line — deliberately left blank for the person to fill in.

  if (price) fields.price = price;
  const restField = REST_FIELD_BY_SECTION[section];
  if (rest && restField) fields[restField] = rest;

  return fields;
}

function buildProposedFieldsFromTableRow(section, mapped) {
  const fields = {};
  if (PLACE_BASED_SECTIONS.has(section)) {
    fields.placeName = mapped.name;
    if (mapped.area) fields.placeArea = mapped.area;
  } else {
    fields.item = mapped.name;
  }
  if (mapped.price) fields.price = mapped.price;
  const restField = REST_FIELD_BY_SECTION[section] || 'notes';
  const noteWithRating = [mapped.rating ? `Rating: ${mapped.rating}` : null, mapped.note].filter(Boolean).join(' — ');
  if (noteWithRating) fields[restField] = noteWithRating;
  return fields;
}

export function extractCandidates(rawText) {
  const lines = rawText.split(/\n/);
  const candidates = [];
  let currentSection = null;
  let activeColumnRoles = null;
  let consecutiveNonTableLines = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (isSeparatorLine(line)) continue;
    if (isPageBoilerplate(line)) continue;

    if (isHeadingLine(line)) {
      const headingText = line.replace(/^#+\s*/, '').replace(/:$/, '');
      currentSection = guessSectionFromHeading(headingText);
      activeColumnRoles = null;
      continue;
    }

    if (looksLikeScheduleLine(line)) continue; // itinerary content, not Research
    if (isMetaCommentary(line)) continue; // document meta-commentary, not travel content

    // ---- Table handling ----
    const cells = splitTableRowCells(line);
    if (cells) {
      if (looksLikeTableHeaderRow(cells)) {
        activeColumnRoles = classifyColumns(cells);
        consecutiveNonTableLines = 0;
        continue; // the header row itself is never a candidate
      }
      const mapped = mapTableRowToFields(cells, activeColumnRoles);
      consecutiveNonTableLines = 0;
      candidates.push({
        proposedSection: currentSection,
        sourceExcerpt: line,
        proposedFields: buildProposedFieldsFromTableRow(currentSection, mapped),
        uncertaintyNote: currentSection
          ? 'Extracted from a table row — please confirm the section and fields.'
          : 'Table row with no heading match — please choose a section.',
      });
      continue;
    }
    consecutiveNonTableLines++;
    if (consecutiveNonTableLines >= 2) activeColumnRoles = null; // table context has ended

    // ---- List items ----
    if (isListItemLine(line)) {
      const text = stripListMarker(line);
      if (!text) continue;
      if (looksLikeScheduleLine(text) || isMetaCommentary(text)) continue;
      candidates.push({
        proposedSection: currentSection,
        sourceExcerpt: text,
        proposedFields: buildProposedFields(currentSection, text),
        uncertaintyNote: currentSection
          ? 'Extracted from a list under a heading match — please confirm the section and fields.'
          : 'List item with no heading match — please choose a section.',
      });
      continue;
    }

    // ---- Plain lines: narrative-vs-record classification ----
    if (classifyLine(line) !== 'record') continue;

    candidates.push({
      proposedSection: currentSection,
      sourceExcerpt: line,
      proposedFields: buildProposedFields(currentSection, line),
      uncertaintyNote: currentSection
        ? 'Extracted as a likely factual record under a heading match — please confirm the section and fields.'
        : 'Looked like a discrete record but had no heading match — please choose a section.',
    });
  }

  return candidates;
}
