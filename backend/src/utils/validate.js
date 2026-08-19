const ITEM_KINDS = ['attraction', 'hotel', 'restaurant', 'transport_option', 'practical_info', 'note'];
const PRIORITIES = ['must_know', 'useful', 'optional', 'reference'];
const SOURCE_TYPES = ['website', 'youtube', 'other'];

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isValidUUID(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

module.exports = { ITEM_KINDS, PRIORITIES, SOURCE_TYPES, isNonEmptyString, isValidUUID };
