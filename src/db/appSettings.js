import { getOne, put } from './connection.js';

const STORE = 'appSettings';
// A single, fixed-id record — this store is deliberately not a
// key-per-setting or general settings system, per the explicit
// instruction not to build one. If a second genuinely global setting
// is ever needed, it can become a second field on this same record;
// this file's job is only ever "the few settings that apply across
// the whole app, not to one destination or one Planning."
const SETTINGS_ID = 'app';

// The default home currency for a fresh install, per the explicit
// requirement — INR, independent of any destination's own
// defaultCurrency (db/currency.js), which this deliberately never
// reads from or falls back to.
const DEFAULT_HOME_CURRENCY = 'INR';

export async function getHomeCurrency() {
  const record = await getOne(STORE, SETTINGS_ID);
  return record?.homeCurrency || DEFAULT_HOME_CURRENCY;
}

export async function setHomeCurrency(code) {
  const normalized = code?.trim().toUpperCase();
  if (!normalized) throw new Error('Choose a currency.');
  const existing = await getOne(STORE, SETTINGS_ID);
  const record = { ...(existing || {}), id: SETTINGS_ID, homeCurrency: normalized, updatedAt: new Date().toISOString() };
  await put(STORE, record);
  return record;
}
