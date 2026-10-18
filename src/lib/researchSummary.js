// Research ↔ Planning integration (Tour Planning, Phase 3) — pure,
// derived "what do I need to know about this Research record right
// now" helpers, shared by the Planning-side Research summary popup
// (components/ResearchSummary.jsx) and the Research picker's compact
// row previews (components/ResearchPicker.jsx).
//
// Kept in a plain .js file (not .jsx) so plain Node can import and
// test it, matching every other lib/ module here.
//
// Everything below READS an existing Research record and derives
// display strings from fields that record already has. Nothing here
// copies a Research record into Planning, invents a field, or writes
// anything — a Planning item still only stores researchRefType +
// researchRefId, resolved to the live record at read time. A field
// the record doesn't have simply produces nothing (no "Unknown" /
// "Not set" filler), per the "do not invent information" rule.
//
// Display-name rules deliberately mirror the per-section fallbacks
// each section page (and the previous picker) already used.

import { normalizeAttraction } from '../db/stores/attractions.js';
import { normalizeAccommodation } from '../db/stores/accommodations.js';
import { normalizeTransportEntry } from '../db/stores/transport.js';
import { isPlaceBased } from '../db/stores/restaurants.js';
import { formatFeeBands } from './feeBands.js';
import { formatOpeningHours } from './openingHours.js';
import { buildGoogleMapsUrl } from './googleMaps.js';

export const RESEARCH_TYPE_LABELS = {
  attractions: 'Attraction',
  restaurants: 'Restaurant',
  accommodations: 'Accommodation',
  transport: 'Transport',
};

// Same wording as components/Badge.jsx's VISIT_PRIORITY_LABELS /
// PRICE_TIER_LABELS — repeated here (not imported) only because
// Badge.jsx is a .jsx file plain Node cannot import for tests.
const VISIT_PRIORITY_LABELS = { must_see: 'Must see', maybe: 'Maybe', skippable: 'Skippable' };
const PRICE_TIER_LABELS = { budget: 'Budget-friendly', regular: 'Regular', fine_dining: 'Fine dining' };

// --- Small formatting helpers ---------------------------------------------

function toPositiveNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function formatMinutes(minutes) {
  const n = Math.round(minutes);
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const rest = n % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

// Structured typicalDurationMin/Max (minutes) -> "1 h–2 h" / "45 min",
// or null when neither is a usable positive number.
export function formatDurationRange(min, max) {
  const a = toPositiveNumber(min);
  const b = toPositiveNumber(max);
  if (a && b && a !== b) return `${formatMinutes(Math.min(a, b))}–${formatMinutes(Math.max(a, b))}`;
  const only = a || b;
  return only ? formatMinutes(only) : null;
}

// Mirrors components/Money.jsx's formatMoney (same output), repeated
// here only because that file is .jsx and cannot be imported by the
// plain-Node tests.
function moneyText(money) {
  if (!money) return null;
  const present = v => v !== '' && v !== undefined && v !== null;
  const parts = [];
  if (present(money.amount) || money.currency) {
    parts.push([money.currency, money.amount].filter(present).join(' '));
  }
  if (money.unit) parts.push(money.unit);
  let text = parts.join(' · ');
  if (money.note) text = text ? `${text} (${money.note})` : money.note;
  return text || null;
}

function otherAware(value, otherText) {
  if (!value) return '';
  return value === 'Other' ? (otherText || 'Other') : value;
}

function placeLocation(place) {
  if (!place) return '';
  if (place.address && place.address.trim()) return place.address.trim();
  return [place.locality, place.city].filter(Boolean).join(', ');
}

// A stored Maps link is only trusted if it is an http(s) URL; anything
// else (a half-pasted string, a non-web scheme) falls back to the same
// generated search URL used when no link is stored — never an invalid
// or unsafe href. Returns null when the place has neither a usable
// link nor a name.
export function safeMapsUrl(place, destinationName) {
  if (!place) return null;
  const stored = typeof place.googleMapsUrl === 'string' ? place.googleMapsUrl.trim() : '';
  if (stored && !/^https?:\/\//i.test(stored)) {
    return buildGoogleMapsUrl({ ...place, googleMapsUrl: '' }, destinationName);
  }
  return buildGoogleMapsUrl(place, destinationName);
}

// --- Display name ---------------------------------------------

export function describeResearchRecord(type, record) {
  if (!record) return 'Untitled';
  switch (type) {
    case 'attractions':
    case 'accommodations':
      return record.place?.name || 'Untitled';
    case 'restaurants':
      return isPlaceBased(record) ? (record.place?.name || 'Untitled') : (record.dishName || 'Food note');
    case 'transport': {
      if (record.travelType === 'local') return `Local transport${record.mode ? ` — ${record.mode}` : ''}`;
      const from = record.from?.label || '?';
      const to = record.to?.label || '?';
      return `${from} → ${to}`;
    }
    default:
      return 'Untitled';
  }
}

// --- Compact preview (Research picker rows) ---------------------------------------------

// { badge: {kind, value, label} | null, parts: string[] } — a short,
// scannable description of one record, built ONLY from fields the
// record actually has, and deliberately different per category:
//   attractions    category · typical duration · opening hours  (+ visit-priority badge)
//   restaurants    cuisine · typical price · locality           (+ price-tier badge)
//   accommodations type · locality/city · price
//   transport      mode · duration · price
// An unknown type, or a record missing every optional field, yields
// { badge: null, parts: [] } — never an error.
export function buildResearchPreview(type, rawRecord) {
  if (!rawRecord) return { badge: null, parts: [] };
  const parts = [];
  let badge = null;
  const add = text => { if (text) parts.push(text); };

  switch (type) {
    case 'attractions': {
      const r = normalizeAttraction(rawRecord);
      add(otherAware(r.category, r.categoryOther));
      add(formatDurationRange(r.typicalDurationMin, r.typicalDurationMax) || r.typicallySpent);
      add(formatOpeningHours(r.openingHours));
      if (r.visitPriority && VISIT_PRIORITY_LABELS[r.visitPriority]) {
        badge = { kind: 'visitPriority', value: r.visitPriority, label: VISIT_PRIORITY_LABELS[r.visitPriority] };
      }
      break;
    }
    case 'restaurants': {
      add(rawRecord.cuisine);
      add(moneyText(rawRecord.price));
      add(isPlaceBased(rawRecord) ? [rawRecord.place.locality, rawRecord.place.city].filter(Boolean).join(', ') : '');
      if (rawRecord.priceTier && PRICE_TIER_LABELS[rawRecord.priceTier]) {
        badge = { kind: 'priceTier', value: rawRecord.priceTier, label: PRICE_TIER_LABELS[rawRecord.priceTier] };
      }
      break;
    }
    case 'accommodations': {
      const r = normalizeAccommodation(rawRecord);
      add(otherAware(r.accommodationType, r.accommodationTypeOther));
      add([r.place?.locality, r.place?.city].filter(Boolean).join(', '));
      add(moneyText(r.price));
      break;
    }
    case 'transport': {
      const r = normalizeTransportEntry(rawRecord);
      add(otherAware(r.mode, r.modeOther));
      add(formatDurationRange(r.typicalDurationMin, r.typicalDurationMax) || r.duration);
      add(moneyText(r.price));
      break;
    }
    default:
      break;
  }
  return { badge, parts };
}

// --- Fuller summary (Planning-side Research popup) ---------------------------------------------

// { type, typeLabel, name, subtitle, badges[], location, facts[], mapLinks[] }
// or null when there is no record (soft-deleted / missing) — the
// caller shows its own "unavailable" state rather than this function
// guessing at a different record.
//
// `facts` is an ordered list of {label, value}; empty fields are
// omitted rather than shown as blanks. `mapLinks` is a list because a
// transport record can have up to two real endpoints with stored place
// details (From / To), where every other category has at most one.
export function buildResearchSummary(type, rawRecord, { destinationName } = {}) {
  if (!rawRecord) return null;
  const summary = {
    type,
    typeLabel: RESEARCH_TYPE_LABELS[type] || 'Research',
    name: describeResearchRecord(type, rawRecord),
    subtitle: '',
    badges: [],
    location: '',
    facts: [],
    mapLinks: [],
  };
  const fact = (label, value) => { if (value) summary.facts.push({ label, value }); };
  const addMapLink = (label, place) => {
    const url = safeMapsUrl(place, destinationName);
    if (url) summary.mapLinks.push({ label, url });
  };

  switch (type) {
    case 'attractions': {
      const r = normalizeAttraction(rawRecord);
      summary.subtitle = otherAware(r.category, r.categoryOther);
      if (r.visitPriority && VISIT_PRIORITY_LABELS[r.visitPriority]) {
        summary.badges.push({ kind: 'visitPriority', value: r.visitPriority, label: VISIT_PRIORITY_LABELS[r.visitPriority] });
      }
      summary.location = placeLocation(r.place);
      fact('Typical duration', formatDurationRange(r.typicalDurationMin, r.typicalDurationMax) || r.typicallySpent);
      fact('Opening hours', formatOpeningHours(r.openingHours));
      fact('Entry', formatFeeBands(r.feeBands));
      addMapLink('📍 Open in Google Maps', r.place);
      break;
    }
    case 'restaurants': {
      summary.subtitle = rawRecord.cuisine || '';
      if (rawRecord.priceTier && PRICE_TIER_LABELS[rawRecord.priceTier]) {
        summary.badges.push({ kind: 'priceTier', value: rawRecord.priceTier, label: PRICE_TIER_LABELS[rawRecord.priceTier] });
      }
      if (isPlaceBased(rawRecord)) {
        summary.location = placeLocation(rawRecord.place);
        addMapLink('📍 Open in Google Maps', rawRecord.place);
      }
      fact('Typical price', moneyText(rawRecord.price));
      fact('Typical meal duration', formatDurationRange(rawRecord.typicalDurationMin, rawRecord.typicalDurationMax));
      break;
    }
    case 'accommodations': {
      const r = normalizeAccommodation(rawRecord);
      summary.subtitle = otherAware(r.accommodationType, r.accommodationTypeOther);
      summary.location = placeLocation(r.place);
      fact('Price', moneyText(r.price));
      addMapLink('📍 Open in Google Maps', r.place);
      break;
    }
    case 'transport': {
      const r = normalizeTransportEntry(rawRecord);
      summary.subtitle = otherAware(r.mode, r.modeOther);
      fact('Duration', formatDurationRange(r.typicalDurationMin, r.typicalDurationMax) || r.duration);
      fact('Price', moneyText(r.price));
      // Only an endpoint with real stored place details gets a link —
      // a bare city label alone is not "valid map/location data".
      if (r.travelType !== 'local') {
        for (const [prefix, endpoint] of [['From', r.from], ['To', r.to]]) {
          if (endpoint?.place) {
            addMapLink(`📍 ${prefix}: ${endpoint.label || endpoint.place.name || 'Open in Google Maps'}`, { ...endpoint.place, name: endpoint.place.name || endpoint.label });
          }
        }
      }
      break;
    }
    default:
      break;
  }
  return summary;
}

// --- Research picker data model ---------------------------------------------

// sections: [{ type, label, items: Record[] }] (as loaded by the
// picker — one list per Research section, already soft-delete
// filtered by the store list functions). Returns the same sections
// with each item wrapped as { item, label, preview }. Computed once
// per data load, never per keystroke or per row render, and from the
// already-loaded records only (no extra database reads).
export function buildPickerSections(sections) {
  return (sections || []).map(section => ({
    ...section,
    rows: (section.items || []).map(item => ({
      item,
      label: describeResearchRecord(section.type, item),
      preview: buildResearchPreview(section.type, item),
    })),
  }));
}

// Name-only, case-insensitive substring filter — exactly the existing
// picker search behaviour, unchanged. Sections left with no matching
// rows are dropped.
export function filterPickerSections(pickerSections, query) {
  const q = (query || '').trim().toLowerCase();
  return pickerSections
    .map(section => ({ ...section, rows: section.rows.filter(row => !q || row.label.toLowerCase().includes(q)) }))
    .filter(section => section.rows.length > 0);
}

// The payload the picker hands back to its caller on selection —
// unchanged from before this phase: a plain reference (type + id) plus
// the display label, never a copy of the Research record.
export function pickerSelectionFor(sectionType, row) {
  return { researchRefType: sectionType, researchRefId: row.item.id, label: row.label };
}
