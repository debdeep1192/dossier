import { getDb } from '../index';
import { isNonEmptyString, ValidationError } from './validate';

// owner_account holds a single local-profile row in this architecture —
// no login, no session, no password. It exists purely so the app has a
// display name to show, and so an imported backup's own profile row can
// be restored on a new device (see db/backup.js).

export async function getProfile() {
  const db = await getDb();
  const result = await db.query('SELECT id, display_name, created_at FROM owner_account LIMIT 1');
  return result.rows[0] || null;
}

export async function createProfile({ displayName }) {
  if (displayName !== undefined && displayName !== null && !isNonEmptyString(displayName)) {
    throw new ValidationError('Name cannot be blank if provided.');
  }
  const db = await getDb();
  const existing = await db.query('SELECT id FROM owner_account LIMIT 1');
  if (existing.rows.length > 0) {
    // Already set up (e.g. re-entering the welcome flow accidentally) —
    // treat as an update rather than erroring, since there's no real
    // "conflict" concept for a single local profile.
    const result = await db.query(
      'UPDATE owner_account SET display_name = $2, updated_at = now() WHERE id = $1 RETURNING id, display_name, created_at',
      [existing.rows[0].id, displayName ? displayName.trim() : null]
    );
    return result.rows[0];
  }
  const result = await db.query(
    'INSERT INTO owner_account (display_name) VALUES ($1) RETURNING id, display_name, created_at',
    [displayName ? displayName.trim() : null]
  );
  return result.rows[0];
}

export async function updateProfile({ displayName }) {
  if (!isNonEmptyString(displayName)) throw new ValidationError('Name cannot be blank.');
  const db = await getDb();
  const existing = await db.query('SELECT id FROM owner_account LIMIT 1');
  if (existing.rows.length === 0) return createProfile({ displayName });
  const result = await db.query(
    'UPDATE owner_account SET display_name = $2, updated_at = now() WHERE id = $1 RETURNING id, display_name, created_at',
    [existing.rows[0].id, displayName.trim()]
  );
  return result.rows[0];
}
