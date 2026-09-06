// ============================================================
// Currency system — cross-cutting, reusable by every section and by
// future Trip Planning / cost calculation.
//
// Two separate concerns, kept deliberately separate per the "original
// currency must never be overwritten" requirement:
//
// 1. WHICH CURRENCIES ARE OFFERED for a destination — stored on the
//    destination record itself (`destination.currencies`, a plain
//    array of ISO codes). INR and USD are always available everywhere
//    regardless of what's stored — enforced in code (getCurrencyOptions
//    below), not by requiring every destination record to redundantly
//    list them.
//
// 2. EXCHANGE RATES — a small global store (`exchangeRates`), not tied
//    to any one destination or research record. A rate is looked up by
//    currency pair at DISPLAY time only. Nothing here ever touches a
//    research record's stored `amount`/`currency` — converting for
//    display is a pure read-side calculation that can change freely
//    (and safely) whenever a rate is updated, because the original
//    research value it reads from never changes.
// ============================================================

import { getAll, getOne, put } from './connection.js';
import { getDestination, updateDestination } from './stores/destinations.js';

export const CORE_CURRENCIES = ['INR', 'USD'];

// The destination's user-selected default currency — item 11/12 of the
// spec. This ONLY controls what a new monetary field defaults to; it
// never touches any already-saved record's own `price.currency` (a
// record's stored currency is a completely separate field, set once
// at entry and never rewritten by anything in this file — see
// convertAmount() below). A destination saved before this field
// existed has no `defaultCurrency` key at all; treated as 'INR' here,
// matching "INR is the default currency unless otherwise specified."
export function getDestinationDefaultCurrency(destination) {
  return destination?.defaultCurrency || 'INR';
}

export async function setDestinationDefaultCurrency(destinationId, code) {
  const normalized = code.trim().toUpperCase();
  if (!normalized) throw new Error('Choose a currency.');
  // Changing the default also ensures it's available as an option
  // going forward (a person choosing KGS as Kyrgyzstan's default
  // should not then have to separately "add" KGS as a usable currency).
  await addDestinationCurrency(destinationId, normalized);
  return updateDestination(destinationId, { defaultCurrency: normalized });
}

// Returns the full set of currency codes that should be offered for a
// given destination: the two core currencies (always present, always
// first) plus whatever the destination has added, deduplicated.
export function getCurrencyOptions(destination) {
  const extra = (destination?.currencies || []).filter(c => !CORE_CURRENCIES.includes(c));
  return [...CORE_CURRENCIES, ...extra];
}

export async function addDestinationCurrency(destinationId, code) {
  const normalized = code.trim().toUpperCase();
  if (!normalized || normalized.length > 6) throw new Error('Enter a valid currency code, e.g. THB.');
  const destination = await getDestination(destinationId);
  if (!destination) throw new Error('Destination not found.');
  const current = destination.currencies || [];
  if (CORE_CURRENCIES.includes(normalized) || current.includes(normalized)) return destination;
  return updateDestination(destinationId, { currencies: [...current, normalized] });
}

const RATES_STORE = 'exchangeRates';

function pairKey(from, to) {
  return `${from}_${to}`;
}

export async function listExchangeRates() {
  const all = await getAll(RATES_STORE);
  return all.sort((a, b) => a.pair.localeCompare(b.pair));
}

// Looks up a direct rate (from -> to) or, failing that, derives it from
// the inverse rate (to -> from) if that's what was actually recorded —
// a person is likely to only ever enter one direction of a pair.
export async function getExchangeRate(from, to) {
  if (from === to) return 1;
  const direct = await getOne(RATES_STORE, pairKey(from, to));
  if (direct) return direct.rate;
  const inverse = await getOne(RATES_STORE, pairKey(to, from));
  if (inverse && inverse.rate) return 1 / inverse.rate;
  return null;
}

export async function setExchangeRate(from, to, rate) {
  const numericRate = parseFloat(rate);
  if (!numericRate || numericRate <= 0) throw new Error('Enter a valid exchange rate greater than 0.');
  const now = new Date().toISOString();
  const record = { id: pairKey(from, to), pair: pairKey(from, to), from, to, rate: numericRate, updatedAt: now };
  await put(RATES_STORE, record);
  return record;
}

// Converts a stored amount for DISPLAY ONLY. Returns null when no rate
// is available rather than guessing — the caller decides how to show
// "no rate set yet" (never a fabricated number).
export async function convertAmount(amount, from, to) {
  if (amount === '' || amount === null || amount === undefined || !from || !to) return null;
  const rate = await getExchangeRate(from, to);
  if (rate === null) return null;
  return parseFloat(amount) * rate;
}
