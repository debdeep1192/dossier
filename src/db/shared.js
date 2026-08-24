// ============================================================
// Shared building blocks.
//
// IMPORTANT: these are shared UTILITY SHAPES embedded inside each
// section's own record — a Place lives at `attraction.place`, a Money
// lives at `accommodation.price`, etc. They are NOT a generic base
// record that every section extends, and there is no `kind`/`type` tag
// anywhere that says "this Place is actually an Attraction." Each
// section store (attractions, restaurants, accommodations, ...) defines
// its own complete field shape in db/stores/*.js; Place/Money/metadata
// are just the common vocabulary those shapes are written in, the same
// way multiple unrelated tables in a SQL schema might each have their
// own `price` column without that implying a shared "priceable" table.
// ============================================================

// A real-world place. Optional fields stay optional — most entries will
// only ever have `name` and maybe `city`.
export function emptyPlace() {
  return {
    name: '',
    placeType: '',
    address: '',
    locality: '',
    city: '',
    country: '',
    lat: null,
    lng: null,
    googleMapsUrl: '',
  };
}

export function isPlaceEmpty(place) {
  return !place || !place.name;
}

// A monetary amount. Original amount/currency are never overwritten —
// enforced by construction: nothing in this codebase performs currency
// conversion or rewrites `amount`/`currency` after entry.
export function emptyMoney() {
  return { amount: '', currency: '', unit: '', note: '' };
}

export function isMoneyEmpty(money) {
  return !money || (!money.amount && !money.currency && !money.unit && !money.note);
}

// Fields present on every section record, regardless of section —
// identity, organization, and provenance. Deliberately does NOT
// include `title` or `notes`: those are only added to a section's own
// shape (db/stores/*.js) when they're genuinely meaningful for that
// section, per the "no artificial fields" instruction. A caller spreads
// this alongside a section's own fields; it is metadata about the
// record, not the record's content.
export function commonMetadata({ destinationId }) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    destinationId,
    priority: null, // 'must_know' | 'useful' | 'optional' | 'reference' | null
    sourceIds: [],
    provenance: 'manual', // 'manual' | 'imported'
    candidateId: null, // set when provenance is 'imported' — links back to the review candidate for traceability
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

export function touchMetadata(record) {
  return { ...record, updatedAt: new Date().toISOString() };
}

const PRIORITIES = ['must_know', 'useful', 'optional', 'reference'];
export { PRIORITIES };
