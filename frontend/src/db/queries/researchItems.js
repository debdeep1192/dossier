import { getDb } from '../index';
import { ITEM_KINDS, PRIORITIES, isNonEmptyString, isValidUUID, ValidationError, NotFoundError } from './validate';

async function fetchFullItem(db, id) {
  const itemResult = await db.query('SELECT * FROM research_items WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (itemResult.rows.length === 0) return null;
  const item = itemResult.rows[0];

  const tagsResult = await db.query(`
    SELECT t.id, t.label FROM tags t
    JOIN research_item_tags rit ON rit.tag_id = t.id
    WHERE rit.research_item_id = $1
    ORDER BY t.label ASC
  `, [id]);

  const sourcesResult = await db.query(
    'SELECT * FROM sources WHERE research_item_id = $1 ORDER BY created_at ASC', [id]
  );

  const relationsResult = await db.query(`
    SELECT ri.id, ri.title, ri.item_kind, ri.destination_id
    FROM research_item_relations rel
    JOIN research_items ri ON (
      (rel.item_a_id = $1 AND ri.id = rel.item_b_id) OR
      (rel.item_b_id = $1 AND ri.id = rel.item_a_id)
    )
    WHERE ri.deleted_at IS NULL
    ORDER BY ri.title ASC
  `, [id]);

  return { ...item, tags: tagsResult.rows, sources: sourcesResult.rows, relatedItems: relationsResult.rows };
}

export async function getResearchItem(id) {
  if (!isValidUUID(id)) throw new ValidationError('invalid_id');
  const db = await getDb();
  const item = await fetchFullItem(db, id);
  if (!item) throw new NotFoundError('not_found');
  return item;
}

export async function createResearchItem(input) {
  const {
    destinationId, sectionId, itemKind, title, priority, content,
    entryFee, openingHours, visitDurationMinutes, priceRange, areaLocation, mapsUrl, lastVerifiedAt,
  } = input;

  if (!isValidUUID(destinationId)) throw new ValidationError('A valid destination is required.');
  if (!ITEM_KINDS.includes(itemKind)) throw new ValidationError(`Item kind must be one of: ${ITEM_KINDS.join(', ')}`);
  if (!isNonEmptyString(title)) throw new ValidationError('Title is required.');
  if (priority && !PRIORITIES.includes(priority)) throw new ValidationError(`Priority must be one of: ${PRIORITIES.join(', ')}`);

  const db = await getDb();
  const dest = await db.query('SELECT id FROM destinations WHERE id = $1 AND deleted_at IS NULL', [destinationId]);
  if (dest.rows.length === 0) throw new NotFoundError('Destination not found.');

  if (sectionId) {
    if (!isValidUUID(sectionId)) throw new ValidationError('Invalid section id.');
    const sec = await db.query('SELECT id FROM sections WHERE id = $1 AND destination_id = $2', [sectionId, destinationId]);
    if (sec.rows.length === 0) throw new NotFoundError('Section not found for this destination.');
  }

  const result = await db.query(`
    INSERT INTO research_items (
      destination_id, section_id, item_kind, title, priority, content,
      entry_fee, opening_hours, visit_duration_minutes, price_range, area_location, maps_url, last_verified_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING *
  `, [
    destinationId, sectionId || null, itemKind, title.trim(), priority || null, content || null,
    entryFee || null, openingHours || null, visitDurationMinutes || null, priceRange || null,
    areaLocation || null, mapsUrl || null, lastVerifiedAt || null,
  ]);

  return { ...result.rows[0], tags: [], sources: [], relatedItems: [] };
}

export async function updateResearchItem(id, input) {
  if (!isValidUUID(id)) throw new ValidationError('invalid_id');
  const db = await getDb();
  const existing = await db.query('SELECT * FROM research_items WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (existing.rows.length === 0) throw new NotFoundError('not_found');
  const current = existing.rows[0];

  const {
    sectionId, itemKind, title, priority, content,
    entryFee, openingHours, visitDurationMinutes, priceRange, areaLocation, mapsUrl, lastVerifiedAt,
  } = input;

  if (itemKind !== undefined && !ITEM_KINDS.includes(itemKind)) throw new ValidationError(`Item kind must be one of: ${ITEM_KINDS.join(', ')}`);
  if (title !== undefined && !isNonEmptyString(title)) throw new ValidationError('Title cannot be empty.');
  if (priority !== undefined && priority !== null && !PRIORITIES.includes(priority)) throw new ValidationError(`Priority must be one of: ${PRIORITIES.join(', ')}`);

  let newSectionId = current.section_id;
  if (sectionId !== undefined) {
    if (sectionId === null) {
      newSectionId = null;
    } else {
      if (!isValidUUID(sectionId)) throw new ValidationError('Invalid section id.');
      const sec = await db.query('SELECT id FROM sections WHERE id = $1 AND destination_id = $2', [sectionId, current.destination_id]);
      if (sec.rows.length === 0) throw new NotFoundError('Section not found for this destination.');
      newSectionId = sectionId;
    }
  }

  const result = await db.query(`
    UPDATE research_items SET
      section_id = $2,
      item_kind = COALESCE($3, item_kind),
      title = COALESCE($4, title),
      priority = CASE WHEN $5::boolean THEN $6 ELSE priority END,
      content = CASE WHEN $7::boolean THEN $8 ELSE content END,
      entry_fee = CASE WHEN $9::boolean THEN $10 ELSE entry_fee END,
      opening_hours = CASE WHEN $11::boolean THEN $12 ELSE opening_hours END,
      visit_duration_minutes = CASE WHEN $13::boolean THEN $14 ELSE visit_duration_minutes END,
      price_range = CASE WHEN $15::boolean THEN $16 ELSE price_range END,
      area_location = CASE WHEN $17::boolean THEN $18 ELSE area_location END,
      maps_url = CASE WHEN $19::boolean THEN $20 ELSE maps_url END,
      last_verified_at = CASE WHEN $21::boolean THEN $22 ELSE last_verified_at END,
      updated_at = now()
    WHERE id = $1
    RETURNING *
  `, [
    id, newSectionId, itemKind || null, title ? title.trim() : null,
    priority !== undefined, priority || null,
    content !== undefined, content,
    entryFee !== undefined, entryFee,
    openingHours !== undefined, openingHours,
    visitDurationMinutes !== undefined, visitDurationMinutes,
    priceRange !== undefined, priceRange,
    areaLocation !== undefined, areaLocation,
    mapsUrl !== undefined, mapsUrl,
    lastVerifiedAt !== undefined, lastVerifiedAt,
  ]);

  return fetchFullItem(db, result.rows[0].id);
}

// SOFT DELETE ONLY — research items are never hard-deleted, per the
// frozen zero-data-loss rule. Trip Items elsewhere may still reference
// this item for traceability ("view current research").
export async function deleteResearchItem(id) {
  if (!isValidUUID(id)) throw new ValidationError('invalid_id');
  const db = await getDb();
  const existing = await db.query('SELECT id FROM research_items WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (existing.rows.length === 0) throw new NotFoundError('not_found');
  await db.query('UPDATE research_items SET deleted_at = now() WHERE id = $1', [id]);
}

// ---- Tags ----

export async function addTag(itemId, label) {
  if (!isValidUUID(itemId)) throw new ValidationError('invalid_id');
  if (!isNonEmptyString(label)) throw new ValidationError('Tag label is required.');
  const db = await getDb();
  const item = await db.query('SELECT id FROM research_items WHERE id = $1 AND deleted_at IS NULL', [itemId]);
  if (item.rows.length === 0) throw new NotFoundError('not_found');

  const normalizedLabel = label.trim().toLowerCase();
  let tagResult = await db.query('SELECT * FROM tags WHERE label = $1', [normalizedLabel]);
  if (tagResult.rows.length === 0) {
    tagResult = await db.query('INSERT INTO tags (label) VALUES ($1) RETURNING *', [normalizedLabel]);
  }
  const tag = tagResult.rows[0];

  await db.query(
    'INSERT INTO research_item_tags (research_item_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [itemId, tag.id]
  );
  return tag;
}

export async function removeTag(itemId, tagId) {
  if (!isValidUUID(itemId) || !isValidUUID(tagId)) throw new ValidationError('invalid_id');
  const db = await getDb();
  await db.query('DELETE FROM research_item_tags WHERE research_item_id = $1 AND tag_id = $2', [itemId, tagId]);
}

export async function listTags() {
  const db = await getDb();
  const result = await db.query(`
    SELECT t.id, t.label, COUNT(rit.research_item_id) AS usage_count
    FROM tags t
    LEFT JOIN research_item_tags rit ON rit.tag_id = t.id
    LEFT JOIN research_items ri ON ri.id = rit.research_item_id AND ri.deleted_at IS NULL
    GROUP BY t.id
    HAVING COUNT(ri.id) > 0
    ORDER BY usage_count DESC, t.label ASC
  `);
  return result.rows;
}

// ---- Sources ----

export async function addSource(itemId, { url, title, sourceType, supportsNote, accessedAt }) {
  if (!isValidUUID(itemId)) throw new ValidationError('invalid_id');
  if (!isNonEmptyString(url)) throw new ValidationError('Source URL is required.');
  const db = await getDb();
  const item = await db.query('SELECT id FROM research_items WHERE id = $1 AND deleted_at IS NULL', [itemId]);
  if (item.rows.length === 0) throw new NotFoundError('not_found');

  const result = await db.query(`
    INSERT INTO sources (research_item_id, url, title, source_type, supports_note, accessed_at)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
  `, [itemId, url.trim(), title || null, sourceType || 'other', supportsNote || null, accessedAt || null]);
  return result.rows[0];
}

export async function removeSource(itemId, sourceId) {
  if (!isValidUUID(itemId) || !isValidUUID(sourceId)) throw new ValidationError('invalid_id');
  const db = await getDb();
  await db.query('DELETE FROM sources WHERE id = $1 AND research_item_id = $2', [sourceId, itemId]);
}

// ---- Relations ----

export async function addRelation(itemId, relatedItemId) {
  if (!isValidUUID(itemId)) throw new ValidationError('invalid_id');
  if (!isValidUUID(relatedItemId)) throw new ValidationError('A valid related item id is required.');
  if (itemId === relatedItemId) throw new ValidationError('An item cannot be related to itself.');

  const db = await getDb();
  const both = await db.query('SELECT id FROM research_items WHERE id IN ($1, $2) AND deleted_at IS NULL', [itemId, relatedItemId]);
  if (both.rows.length < 2) throw new NotFoundError('One or both research items were not found.');

  // Stored canonically (sorted pair) so the UNIQUE constraint dedupes
  // regardless of which order the two IDs were supplied in.
  const [a, b] = [itemId, relatedItemId].sort();
  await db.query(
    'INSERT INTO research_item_relations (item_a_id, item_b_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a, b]
  );
}

export async function removeRelation(itemId, relatedItemId) {
  if (!isValidUUID(itemId) || !isValidUUID(relatedItemId)) throw new ValidationError('invalid_id');
  const [a, b] = [itemId, relatedItemId].sort();
  const db = await getDb();
  await db.query('DELETE FROM research_item_relations WHERE item_a_id = $1 AND item_b_id = $2', [a, b]);
}
