// ============================================================
// Document/text extraction adapter — conservative by design.
//
// CORE RULE: only LIST ITEMS (bulleted or numbered lines) ever become
// review candidates. Plain prose paragraphs — introductions, closing
// notes, historical background, cost-summary paragraphs, itinerary
// narration, cross-reference text, generic instructions — NEVER become
// candidates, regardless of what heading they sit under. This single
// rule eliminates almost the entire false-positive class this adapter
// used to produce (an earlier version turned every paragraph into a
// candidate). The full original text is always preserved verbatim in
// the intake record regardless of what does or doesn't become a
// candidate, so nothing is lost by being conservative here — a person
// can always open "View original pasted text" to see everything.
//
// Within list items, two further filters keep obvious noise out even
// as reviewable candidates:
//   - Lines that look like a schedule/itinerary entry (start with a
//     time or time range, e.g. "08:00–09:30 Breakfast") are skipped
//     entirely — itineraries are Trip Planning content, not Research.
//   - Lines that are clearly meta-commentary about the document itself
//     (e.g. "Closing note from the original document...") are skipped
//     entirely.
//
// A heading still sets which section a list item is PROPOSED to
// belong to, but a list item under no recognized heading is still
// surfaced (as "Unclassified", never silently dropped) rather than
// guessed — "if uncertain, keep it for review" per the data
// preservation principle.
// ============================================================

const SECTION_KEYWORDS = [
  { section: 'attractions', words: ['attraction', 'sight', 'things to see', 'things to do', 'places to visit'] },
  { section: 'restaurants', words: ['restaurant', 'food', 'eat', 'dining', 'cuisine', 'where to eat'] },
  { section: 'accommodations', words: ['hotel', 'stay', 'accommodation', 'lodging', 'where to sleep', 'where to stay'] },
  { section: 'transport', words: ['transport', 'getting around', 'getting there', 'travel between', 'how to reach'] },
  { section: 'costs', words: ['cost', 'budget', 'money', 'price', 'expense'] },
  { section: 'practicalInfo', words: ['practical', 'visa', 'safety', 'tips', 'connectivity', 'health'] },
  { section: 'weatherNotes', words: ['weather', 'season', 'best time', 'climate'] },
  { section: 'packingNotes', words: ['pack', 'what to bring', 'what to wear', 'gear'] },
  { section: 'shoppingItems', words: ['shopping', 'what to buy', 'souvenir'] },
];

// Headings that explicitly signal itinerary/schedule content — list
// items under these are handled by the time-pattern filter below
// regardless, but recognizing the heading itself means we also never
// misclassify it into a research section.
const ITINERARY_HEADING_WORDS = ['itinerary', 'day 1', 'day 2', 'day 3', 'schedule', 'day-by-day', 'daily plan'];

function guessSectionFromHeading(headingText) {
  const lower = headingText.toLowerCase();
  if (ITINERARY_HEADING_WORDS.some(w => lower.includes(w))) return null;
  for (const { section, words } of SECTION_KEYWORDS) {
    if (words.some(w => lower.includes(w))) return section;
  }
  return null;
}

function isHeadingLine(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('#')) return true;
  if (trimmed.length === 0 || trimmed.length > 60) return false;
  if (trimmed.endsWith(':') && trimmed.length < 40) return true;
  if (!/[.!?,]$/.test(trimmed) && /^[A-Z]/.test(trimmed) && trimmed.split(' ').length <= 6) return true;
  return false;
}

function isListItemLine(line) {
  return /^\s*([-*•]|\d+[.)])\s+/.test(line);
}

function stripListMarker(line) {
  return line.replace(/^\s*([-*•]|\d+[.)])\s+/, '').trim();
}

// A separator-only line ("---", "===", "***", "___") — never a
// candidate, never even considered a heading.
function isSeparatorLine(line) {
  return /^[\s\-=*_]+$/.test(line) && line.trim().length > 0;
}

// Itinerary/schedule lines: start with a clock time or time range
// ("08:00–09:30 Breakfast", "6:00 AM Departure"). This is the single
// biggest source of false attraction/activity candidates from
// day-by-day itinerary content, so it's checked before anything else.
const TIME_PREFIX_PATTERN = /^\d{1,2}[:.]\d{2}\s*(am|pm|AM|PM)?\s*[–\-—]?\s*(\d{1,2}[:.]\d{2}\s*(am|pm|AM|PM)?)?/;
function looksLikeScheduleLine(text) {
  return TIME_PREFIX_PATTERN.test(text.trim());
}

// Explicit meta-commentary about the document/guide itself — never
// real travel content, so never worth surfacing even for review.
const META_PATTERNS = [
  /closing note/i,
  /scheduling note/i,
  /from the original document/i,
  /^note:/i,
  /^disclaimer/i,
  /^source:/i,
  /^reference:/i,
  /the guide is (explicitly )?built around/i,
];
function isMetaCommentary(text) {
  return META_PATTERNS.some(p => p.test(text));
}

// Looks for an unambiguous currency+amount pattern. Deliberately narrow
// — meant to catch clear cases ("LKR 1,500", "$20", "free"), not to
// parse every possible price phrasing, and never applied to lines that
// have already been filtered out as schedule/meta content.
const CURRENCY_PATTERN = /\b(INR|USD|LKR|EUR|GBP|THB|AED|SGD|JPY|Rs\.?|₹|\$|€|£)\s?([\d][\d,]*(?:\.\d+)?)\b/i;

export function extractPriceFromText(text) {
  if (/\bfree\b/i.test(text)) return { amount: 0, currency: '', unit: '', note: 'Free' };
  const match = text.match(CURRENCY_PATTERN);
  if (!match) return null;
  const currencyRaw = match[1].toUpperCase().replace('RS.', 'INR').replace('RS', 'INR');
  const symbolMap = { '₹': 'INR', '$': 'USD', '€': 'EUR', '£': 'GBP' };
  const currency = symbolMap[match[1]] || currencyRaw;
  const amount = parseFloat(match[2].replace(/,/g, ''));
  return { amount, currency, unit: '', note: '' };
}

function splitLabelAndRest(text) {
  const match = text.match(/^(.{2,60}?)\s*(?::|—|--| - )\s*(.+)$/);
  if (match) return { label: match[1].trim(), rest: match[2].trim() };
  return { label: text.trim(), rest: '' };
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

export function extractCandidates(rawText) {
  const lines = rawText.split(/\n/);
  const candidates = [];
  let currentSection = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || isSeparatorLine(line)) continue;

    if (isHeadingLine(line)) {
      const headingText = line.replace(/^#+\s*/, '').replace(/:$/, '');
      currentSection = guessSectionFromHeading(headingText);
      continue;
    }

    // Prose paragraphs are never candidates — this is the core
    // conservatism rule. Only list items proceed past this point.
    if (!isListItemLine(line)) continue;

    const text = stripListMarker(line);
    if (!text) continue;
    if (looksLikeScheduleLine(text)) continue; // itinerary content, not Research
    if (isMetaCommentary(text)) continue; // document meta-commentary, not travel content

    candidates.push({
      proposedSection: currentSection,
      sourceExcerpt: text,
      proposedFields: buildProposedFields(currentSection, text),
      uncertaintyNote: currentSection
        ? 'Extracted from a list under a heading match — please confirm the section and fields.'
        : 'List item with no heading match — please choose a section.',
    });
  }

  return candidates;
}
