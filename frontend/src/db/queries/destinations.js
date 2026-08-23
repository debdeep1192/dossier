import { getDb } from '../index.js';
import { isNonEmptyString, isValidUUID, ValidationError, NotFoundError, ConflictError } from './validate.js';

export async function listDestinations() {
  const db = await getDb();
  const result = await db.query(`
    SELECT d.id, d.name, d.overview, d.created_at, d.updated_at,
           COUNT(DISTINCT s.id) FILTER (WHERE s.id IS NOT NULL) AS section_count,
           COUNT(DISTINCT ri.id) FILTER (WHERE ri.id IS NOT NULL AND ri.deleted_at IS NULL) AS item_count,
           MAX(ri.updated_at) AS last_item_updated_at
    FROM destinations d
    LEFT JOIN sections s ON s.destination_id = d.id
    LEFT JOIN research_items ri ON ri.destination_id = d.id AND ri.deleted_at IS NULL
    WHERE d.deleted_at IS NULL
    GROUP BY d.id
    ORDER BY d.name ASC
  `);
  return result.rows;
}

export async function recentlyUpdatedItems(limit = 10) {
  const db = await getDb();
  const cappedLimit = Math.min(limit, 50);
  const result = await db.query(`
    SELECT ri.id, ri.title, ri.item_kind, ri.updated_at, ri.priority,
           d.id AS destination_id, d.name AS destination_name,
           sec.id AS section_id, sec.name AS section_name
    FROM research_items ri
    JOIN destinations d ON d.id = ri.destination_id AND d.deleted_at IS NULL
    LEFT JOIN sections sec ON sec.id = ri.section_id
    WHERE ri.deleted_at IS NULL
    ORDER BY ri.updated_at DESC
    LIMIT $1
  `, [cappedLimit]);
  return result.rows;
}

export async function searchResearch(q) {
  const query = (q || '').trim();
  if (!query) return [];
  const db = await getDb();
  const result = await db.query(`
    SELECT DISTINCT ri.id, ri.title, ri.item_kind, ri.content, ri.priority,
           d.id AS destination_id, d.name AS destination_name,
           sec.id AS section_id, sec.name AS section_name
    FROM research_items ri
    JOIN destinations d ON d.id = ri.destination_id AND d.deleted_at IS NULL
    LEFT JOIN sections sec ON sec.id = ri.section_id
    LEFT JOIN research_item_tags rit ON rit.research_item_id = ri.id
    LEFT JOIN tags t ON t.id = rit.tag_id
    WHERE ri.deleted_at IS NULL
      AND (ri.title ILIKE $1 OR ri.content ILIKE $1 OR t.label ILIKE $1)
    ORDER BY ri.title ASC
    LIMIT 50
  `, [`%${query}%`]);
  return result.rows;
}

export async function getDestination(id) {
  if (!isValidUUID(id)) throw new ValidationError('invalid_id');
  const db = await getDb();

  const destResult = await db.query('SELECT * FROM destinations WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (destResult.rows.length === 0) throw new NotFoundError('Destination not found.');

  // Independent reads — run in parallel rather than sequentially, since
  // neither depends on the other's result. Small win locally, but real:
  // this is the query DestinationDetail fires on every navigation into a
  // destination, so it's worth not leaving latency on the table here.
  const [sectionsResult, itemsResult] = await Promise.all([
    db.query('SELECT * FROM sections WHERE destination_id = $1 ORDER BY sort_order ASC, name ASC', [id]),
    db.query('SELECT * FROM research_items WHERE destination_id = $1 AND deleted_at IS NULL ORDER BY title ASC', [id]),
  ]);

  return { destination: destResult.rows[0], sections: sectionsResult.rows, items: itemsResult.rows };
}

export async function createDestination({ name, overview }) {
  if (!isNonEmptyString(name)) throw new ValidationError('Destination name is required.');
  const db = await getDb();
  const result = await db.query(
    'INSERT INTO destinations (name, overview) VALUES ($1, $2) RETURNING *',
    [name.trim(), overview || null]
  );
  return result.rows[0];
}

export async function updateDestination(id, { name, overview }) {
  if (!isValidUUID(id)) throw new ValidationError('invalid_id');
  const db = await getDb();
  const existing = await db.query('SELECT * FROM destinations WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (existing.rows.length === 0) throw new NotFoundError('not_found');
  if (name !== undefined && !isNonEmptyString(name)) throw new ValidationError('Destination name cannot be empty.');

  const result = await db.query(
    `UPDATE destinations SET name = COALESCE($2, name), overview = COALESCE($3, overview), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, name ? name.trim() : null, overview !== undefined ? overview : null]
  );
  return result.rows[0];
}

// Soft-deletes a destination together with all of its (non-deleted)
// research items, in one operation. Not a hard delete, and no separate
// move/recycle-bin workflow — this is the same soft-delete mechanism
// deleteResearchItem() already uses, applied to every item under the
// destination as well as the destination itself.
//
// Sections are left in place, physically unchanged (sections have no
// deleted_at column). This is safe rather than an oversight: every read
// path (getDestination, list queries, search) only ever reaches a
// destination's sections after first confirming
// destinations.deleted_at IS NULL, so once the parent destination is
// soft-deleted, its sections become permanently unreachable through the
// app exactly like its items do — nothing is orphaned or exposed
// inconsistently. Hard-deleting the sections in the same step isn't
// possible regardless, since research_items.section_id is
// ON DELETE RESTRICT and the items still physically exist (soft-deleted,
// not removed).
export async function deleteDestination(id) {
  if (!isValidUUID(id)) throw new ValidationError('invalid_id');
  const db = await getDb();
  const existing = await db.query('SELECT id FROM destinations WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (existing.rows.length === 0) throw new NotFoundError('not_found');
  await db.query(
    'UPDATE research_items SET deleted_at = now(), section_id = NULL WHERE destination_id = $1 AND deleted_at IS NULL',
    [id]
  );
  await db.query('UPDATE destinations SET deleted_at = now() WHERE id = $1', [id]);
}

// ---- Sections ----

export async function createSection({ destinationId, name, sortOrder }) {
  if (!isValidUUID(destinationId)) throw new ValidationError('A valid destination is required.');
  if (!isNonEmptyString(name)) throw new ValidationError('Section name is required.');

  const db = await getDb();
  const dest = await db.query('SELECT id FROM destinations WHERE id = $1 AND deleted_at IS NULL', [destinationId]);
  if (dest.rows.length === 0) throw new NotFoundError('Destination not found.');

  const dup = await db.query('SELECT id FROM sections WHERE destination_id = $1 AND name = $2', [destinationId, name.trim()]);
  if (dup.rows.length > 0) throw new ConflictError('A section with this name already exists for this destination.');

  let order = sortOrder;
  if (order === undefined || order === null) {
    const maxResult = await db.query('SELECT COALESCE(MAX(sort_order), -1) AS max FROM sections WHERE destination_id = $1', [destinationId]);
    order = maxResult.rows[0].max + 1;
  }

  const result = await db.query(
    'INSERT INTO sections (destination_id, name, sort_order) VALUES ($1, $2, $3) RETURNING *',
    [destinationId, name.trim(), order]
  );
  return result.rows[0];
}

export async function updateSection(id, { name, sortOrder }) {
  if (!isValidUUID(id)) throw new ValidationError('invalid_id');
  const db = await getDb();
  const existing = await db.query('SELECT * FROM sections WHERE id = $1', [id]);
  if (existing.rows.length === 0) throw new NotFoundError('not_found');
  if (name !== undefined && !isNonEmptyString(name)) throw new ValidationError('Section name cannot be empty.');

  if (name) {
    const dup = await db.query(
      'SELECT id FROM sections WHERE destination_id = $1 AND name = $2 AND id != $3',
      [existing.rows[0].destination_id, name.trim(), id]
    );
    if (dup.rows.length > 0) throw new ConflictError('A section with this name already exists for this destination.');
  }

  const result = await db.query(
    `UPDATE sections SET name = COALESCE($2, name), sort_order = COALESCE($3, sort_order), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, name ? name.trim() : null, sortOrder !== undefined ? sortOrder : null]
  );
  return result.rows[0];
}

export async function deleteSection(id) {
  if (!isValidUUID(id)) throw new ValidationError('invalid_id');
  const db = await getDb();
  const existing = await db.query('SELECT * FROM sections WHERE id = $1', [id]);
  if (existing.rows.length === 0) throw new NotFoundError('not_found');

  const itemCount = await db.query(
    'SELECT COUNT(*) AS count FROM research_items WHERE section_id = $1 AND deleted_at IS NULL', [id]
  );
  if (parseInt(itemCount.rows[0].count) > 0) {
    throw new ConflictError('This section still contains research items. Move or delete them first before removing the section.');
  }
  await db.query('DELETE FROM sections WHERE id = $1', [id]);
}
