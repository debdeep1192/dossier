export const ITEM_KINDS = ['attraction', 'hotel', 'restaurant', 'transport_option', 'practical_info', 'note'];
export const PRIORITIES = ['must_know', 'useful', 'optional', 'reference'];
export const SOURCE_TYPES = ['website', 'youtube', 'other'];

export function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

export function isValidUUID(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
  }
}
