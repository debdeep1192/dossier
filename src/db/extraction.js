// ============================================================
// Document/text extraction adapter.
//
// Structured, not paragraph-splitting: recognizes headings (which set
// a "current proposed section" for the lines that follow), list items
// (bullets/numbered lines — usually one fact per line), and explicit
// "Label: value" or "Label — value" pairs within a line. This is
// intentionally conservative: it only proposes a section when a heading
// gives a real signal, and it only proposes a price when the text
// contains an unambiguous currency+amount pattern. It never fabricates
// coordinates, opening hours, or any field it can't actually see in the
// text. Every candidate still requires human review before becoming a
// real record — this adapter's job is to reduce reviewing effort, not
// to replace review.
// ============================================================

const SECTION_KEYWORDS = [
  { section: 'attractions', words: ['attraction', 'see', 'do', 'activit', 'sight', 'things to'] },
  { section: 'restaurants', words: ['restaurant', 'food', 'eat', 'dining', 'cuisine'] },
  { section: 'accommodations', words: ['hotel', 'stay', 'accommodation', 'lodging', 'where to sleep'] },
  { section: 'transport', words: ['transport', 'getting around', 'getting there', 'travel between'] },
  { section: 'costs', words: ['cost', 'budget', 'money', 'price', 'expense'] },
  { section: 'practicalInfo', words: ['practical', 'visa', 'safety', 'tips', 'connectivity', 'health'] },
  { section: 'weatherNotes', words: ['weather', 'season', 'best time', 'climate'] },
  { section: 'packingNotes', words: ['pack', 'bring', 'what to wear', 'gear'] },
];

function guessSectionFromHeading(headingText) {
  const lower = headingText.toLowerCase();
  for (const { section, words } of SECTION_KEYWORDS) {
    if (words.some(w => lower.includes(w))) return section;
  }
  return null;
}

function isHeadingLine(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('#')) return true;
  if (trimmed.length === 0 || trimmed.length > 60) return false;
  // Ends with ':' and isn't itself a "Label: value" pair (no long value
  // after the colon) — treat as a heading like "Attractions:" or "Food:".
  if (trimmed.endsWith(':') && trimmed.length < 40) return true;
  // Short, no terminal punctuation, no lowercase-starting continuation —
  // reads like a section title ("Getting Around", "Where To Stay").
  if (!/[.!?,]$/.test(trimmed) && /^[A-Z]/.test(trimmed) && trimmed.split(' ').length <= 6) return true;
  return false;
}

function isListItemLine(line) {
  return /^\s*([-*•]|\d+[.)])\s+/.test(line);
}

function stripListMarker(line) {
  return line.replace(/^\s*([-*•]|\d+[.)])\s+/, '').trim();
}

// Looks for an unambiguous currency+amount pattern. Deliberately narrow
// — this is meant to catch clear cases ("LKR 1,500", "$20", "free"),
// not to parse every possible price phrasing.
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

// Splits "Name: rest" or "Name — rest" or "Name - rest" into a proposed
// identifying label and the remaining descriptive text. Falls back to
// treating the whole line as the label with no remainder when no
// delimiter is present.
function splitLabelAndRest(text) {
  const match = text.match(/^(.{2,60}?)\s*(?::|—|--| - )\s*(.+)$/);
  if (match) return { label: match[1].trim(), rest: match[2].trim() };
  return { label: text.trim(), rest: '' };
}

// The free-text field each section's proposedFields should put
// "the rest of the line" into, when there is a remainder after the
// label — matches each section's own most appropriate descriptive
// field, never a fabricated one.
const REST_FIELD_BY_SECTION = {
  attractions: 'description',
  restaurants: 'dietaryNotes',
  accommodations: 'amenityNotes',
  transport: 'bookingNotes',
  costs: 'context',
  practicalInfo: 'details',
  weatherNotes: 'description',
  packingNotes: 'notes',
  generalNotes: 'content',
};

const PLACE_BASED_SECTIONS = new Set(['attractions', 'restaurants', 'accommodations']);

function buildProposedFields(section, text) {
  if (!section) return {};
  const { label, rest } = splitLabelAndRest(text);
  const price = extractPriceFromText(text);
  const fields = {};

  if (PLACE_BASED_SECTIONS.has(section)) {
    fields.placeName = label; // review UI turns this into place.name on accept
  } else if (section === 'transport') {
    // Endpoints are too unreliable to guess from a single line — left
    // for the person to fill in during review, not fabricated here.
  } else if (section === 'costs') {
    fields.item = label;
  } else if (section === 'practicalInfo') {
    fields.topic = label;
  } else if (section === 'weatherNotes') {
    fields.period = label;
  } else if (section === 'packingNotes') {
    fields.item = label;
  } else if (section === 'generalNotes') {
    fields.title = label;
  }

  if (price) fields.price = price;
  const restField = REST_FIELD_BY_SECTION[section];
  if (rest && restField) fields[restField] = rest;

  return fields;
}

export function extractCandidates(rawText) {
  const lines = rawText.split(/\n/);
  const candidates = [];
  let currentSection = null;
  let paragraphBuffer = [];

  function flushParagraph() {
    if (paragraphBuffer.length === 0) return;
    const text = paragraphBuffer.join(' ').trim();
    paragraphBuffer = [];
    if (!text) return;
    candidates.push({
      proposedSection: currentSection,
      sourceExcerpt: text,
      proposedFields: buildProposedFields(currentSection, text),
      uncertaintyNote: currentSection
        ? 'Grouped under a heading match — please confirm the section and fields.'
        : 'No heading match found — please choose a section.',
    });
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) { flushParagraph(); continue; }

    if (isHeadingLine(line)) {
      flushParagraph();
      const headingText = line.replace(/^#+\s*/, '').replace(/:$/, '');
      currentSection = guessSectionFromHeading(headingText);
      continue;
    }

    if (isListItemLine(line)) {
      flushParagraph();
      const text = stripListMarker(line);
      candidates.push({
        proposedSection: currentSection,
        sourceExcerpt: text,
        proposedFields: buildProposedFields(currentSection, text),
        uncertaintyNote: currentSection
          ? 'Extracted from a list under a heading match — please confirm.'
          : 'List item with no heading match — please choose a section.',
      });
      continue;
    }

    paragraphBuffer.push(line);
  }
  flushParagraph();

  return candidates;
}
