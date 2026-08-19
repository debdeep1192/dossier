const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { ITEM_KINDS, PRIORITIES, isNonEmptyString, isValidUUID } = require('../utils/validate');

const router = express.Router();
router.use(requireAuth);

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
    'SELECT * FROM sources WHERE research_item_id = $1 ORDER BY created_at ASC',
    [id]
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

// GET /api/research-items/:id — full detail
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  if (!isValidUUID(id)) return res.status(400).json({ error: 'invalid_id' });
  const db = await getDb();
  const item = await fetchFullItem(db, id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  res.json({ item });
});

// POST /api/research-items — create a Typed Item or a Research Note.
// section_id is nullable: omitting it (or passing null) creates a
// destination-level note, per the approved destination-level-notes design.
router.post('/', async (req, res) => {
  const {
    destinationId, sectionId, itemKind, title, priority, content,
    entryFee, openingHours, visitDurationMinutes, priceRange, areaLocation, mapsUrl, lastVerifiedAt,
  } = req.body;

  if (!isValidUUID(destinationId)) {
    return res.status(400).json({ error: 'validation_error', message: 'A valid destination is required.' });
  }
  if (!ITEM_KINDS.includes(itemKind)) {
    return res.status(400).json({ error: 'validation_error', message: `Item kind must be one of: ${ITEM_KINDS.join(', ')}` });
  }
  if (!isNonEmptyString(title)) {
    return res.status(400).json({ error: 'validation_error', message: 'Title is required.' });
  }
  if (priority && !PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: 'validation_error', message: `Priority must be one of: ${PRIORITIES.join(', ')}` });
  }

  const db = await getDb();
  const dest = await db.query('SELECT id FROM destinations WHERE id = $1 AND deleted_at IS NULL', [destinationId]);
  if (dest.rows.length === 0) {
    return res.status(404).json({ error: 'not_found', message: 'Destination not found.' });
  }

  if (sectionId) {
    if (!isValidUUID(sectionId)) return res.status(400).json({ error: 'validation_error', message: 'Invalid section id.' });
    const sec = await db.query('SELECT id FROM sections WHERE id = $1 AND destination_id = $2', [sectionId, destinationId]);
    if (sec.rows.length === 0) {
      return res.status(404).json({ error: 'not_found', message: 'Section not found for this destination.' });
    }
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

  res.status(201).json({ item: { ...result.rows[0], tags: [], sources: [], relatedItems: [] } });
});

// PATCH /api/research-items/:id — edit fields (including moving between sections,
// or promoting/demoting to a destination-level note by setting sectionId to null)
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  if (!isValidUUID(id)) return res.status(400).json({ error: 'invalid_id' });

  const db = await getDb();
  const existing = await db.query('SELECT * FROM research_items WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: 'not_found' });
  const current = existing.rows[0];

  const {
    sectionId, itemKind, title, priority, content,
    entryFee, openingHours, visitDurationMinutes, priceRange, areaLocation, mapsUrl, lastVerifiedAt,
  } = req.body;

  if (itemKind !== undefined && !ITEM_KINDS.includes(itemKind)) {
    return res.status(400).json({ error: 'validation_error', message: `Item kind must be one of: ${ITEM_KINDS.join(', ')}` });
  }
  if (title !== undefined && !isNonEmptyString(title)) {
    return res.status(400).json({ error: 'validation_error', message: 'Title cannot be empty.' });
  }
  if (priority !== undefined && priority !== null && !PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: 'validation_error', message: `Priority must be one of: ${PRIORITIES.join(', ')}` });
  }

  let newSectionId = current.section_id;
  if (sectionId !== undefined) {
    if (sectionId === null) {
      newSectionId = null; // demote to destination-level note
    } else {
      if (!isValidUUID(sectionId)) return res.status(400).json({ error: 'validation_error', message: 'Invalid section id.' });
      const sec = await db.query('SELECT id FROM sections WHERE id = $1 AND destination_id = $2', [sectionId, current.destination_id]);
      if (sec.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Section not found for this destination.' });
      }
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

  const full = await fetchFullItem(db, result.rows[0].id);
  res.json({ item: full });
});

// DELETE /api/research-items/:id — SOFT DELETE ONLY.
// Per the frozen architecture, Research Items are never hard-deleted in V1:
// Trip Items elsewhere may still reference this item for traceability
// ("view current research"), and hard-deleting would break that link's
// meaning even though the FK itself uses ON DELETE SET NULL as a safety net.
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  if (!isValidUUID(id)) return res.status(400).json({ error: 'invalid_id' });
  const db = await getDb();
  const existing = await db.query('SELECT id FROM research_items WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: 'not_found' });

  await db.query('UPDATE research_items SET deleted_at = now() WHERE id = $1', [id]);
  res.json({ success: true });
});

// ---- Tags ----

// POST /api/research-items/:id/tags — attach a tag (creating it if new)
router.post('/:id/tags', async (req, res) => {
  const { id } = req.params;
  if (!isValidUUID(id)) return res.status(400).json({ error: 'invalid_id' });
  const { label } = req.body;
  if (!isNonEmptyString(label)) {
    return res.status(400).json({ error: 'validation_error', message: 'Tag label is required.' });
  }

  const db = await getDb();
  const item = await db.query('SELECT id FROM research_items WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (item.rows.length === 0) return res.status(404).json({ error: 'not_found' });

  const normalizedLabel = label.trim().toLowerCase();
  let tagResult = await db.query('SELECT * FROM tags WHERE label = $1', [normalizedLabel]);
  let tag;
  if (tagResult.rows.length === 0) {
    tagResult = await db.query('INSERT INTO tags (label) VALUES ($1) RETURNING *', [normalizedLabel]);
  }
  tag = tagResult.rows[0];

  await db.query(
    'INSERT INTO research_item_tags (research_item_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [id, tag.id]
  );

  res.status(201).json({ tag });
});

// DELETE /api/research-items/:id/tags/:tagId
router.delete('/:id/tags/:tagId', async (req, res) => {
  const { id, tagId } = req.params;
  if (!isValidUUID(id) || !isValidUUID(tagId)) return res.status(400).json({ error: 'invalid_id' });
  const db = await getDb();
  await db.query('DELETE FROM research_item_tags WHERE research_item_id = $1 AND tag_id = $2', [id, tagId]);
  res.json({ success: true });
});

// ---- Sources ----

// POST /api/research-items/:id/sources
router.post('/:id/sources', async (req, res) => {
  const { id } = req.params;
  if (!isValidUUID(id)) return res.status(400).json({ error: 'invalid_id' });
  const { url, title, sourceType, supportsNote, accessedAt } = req.body;

  if (!isNonEmptyString(url)) {
    return res.status(400).json({ error: 'validation_error', message: 'Source URL is required.' });
  }

  const db = await getDb();
  const item = await db.query('SELECT id FROM research_items WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (item.rows.length === 0) return res.status(404).json({ error: 'not_found' });

  const result = await db.query(`
    INSERT INTO sources (research_item_id, url, title, source_type, supports_note, accessed_at)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
  `, [id, url.trim(), title || null, sourceType || 'other', supportsNote || null, accessedAt || null]);

  res.status(201).json({ source: result.rows[0] });
});

// PATCH /api/research-items/:itemId/sources/:sourceId
router.patch('/:itemId/sources/:sourceId', async (req, res) => {
  const { itemId, sourceId } = req.params;
  if (!isValidUUID(itemId) || !isValidUUID(sourceId)) return res.status(400).json({ error: 'invalid_id' });
  const { url, title, sourceType, supportsNote, accessedAt } = req.body;

  const db = await getDb();
  const existing = await db.query('SELECT * FROM sources WHERE id = $1 AND research_item_id = $2', [sourceId, itemId]);
  if (existing.rows.length === 0) return res.status(404).json({ error: 'not_found' });

  const result = await db.query(`
    UPDATE sources SET
      url = COALESCE($3, url), title = COALESCE($4, title),
      source_type = COALESCE($5, source_type), supports_note = COALESCE($6, supports_note),
      accessed_at = COALESCE($7, accessed_at), updated_at = now()
    WHERE id = $1 AND research_item_id = $2 RETURNING *
  `, [sourceId, itemId, url, title, sourceType, supportsNote, accessedAt]);

  res.json({ source: result.rows[0] });
});

// DELETE /api/research-items/:itemId/sources/:sourceId
router.delete('/:itemId/sources/:sourceId', async (req, res) => {
  const { itemId, sourceId } = req.params;
  if (!isValidUUID(itemId) || !isValidUUID(sourceId)) return res.status(400).json({ error: 'invalid_id' });
  const db = await getDb();
  await db.query('DELETE FROM sources WHERE id = $1 AND research_item_id = $2', [sourceId, itemId]);
  res.json({ success: true });
});

// ---- Relations ----

// POST /api/research-items/:id/relations — link two research items (symmetric)
router.post('/:id/relations', async (req, res) => {
  const { id } = req.params;
  if (!isValidUUID(id)) return res.status(400).json({ error: 'invalid_id' });
  const { relatedItemId } = req.body;
  if (!isValidUUID(relatedItemId)) {
    return res.status(400).json({ error: 'validation_error', message: 'A valid related item id is required.' });
  }
  if (id === relatedItemId) {
    return res.status(400).json({ error: 'validation_error', message: 'An item cannot be related to itself.' });
  }

  const db = await getDb();
  const both = await db.query(
    'SELECT id FROM research_items WHERE id IN ($1, $2) AND deleted_at IS NULL',
    [id, relatedItemId]
  );
  if (both.rows.length < 2) {
    return res.status(404).json({ error: 'not_found', message: 'One or both research items were not found.' });
  }

  // Store canonically to satisfy the UNIQUE(item_a_id, item_b_id) constraint
  // regardless of which order the two IDs were supplied in.
  const [a, b] = [id, relatedItemId].sort();
  await db.query(
    'INSERT INTO research_item_relations (item_a_id, item_b_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [a, b]
  );

  res.status(201).json({ success: true });
});

// DELETE /api/research-items/:id/relations/:relatedItemId
router.delete('/:id/relations/:relatedItemId', async (req, res) => {
  const { id, relatedItemId } = req.params;
  if (!isValidUUID(id) || !isValidUUID(relatedItemId)) return res.status(400).json({ error: 'invalid_id' });
  const [a, b] = [id, relatedItemId].sort();
  const db = await getDb();
  await db.query('DELETE FROM research_item_relations WHERE item_a_id = $1 AND item_b_id = $2', [a, b]);
  res.json({ success: true });
});

module.exports = router;
