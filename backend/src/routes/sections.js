const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { isNonEmptyString, isValidUUID } = require('../utils/validate');

const router = express.Router();
router.use(requireAuth);

// POST /api/sections — create a new (custom) section under a destination
router.post('/', async (req, res) => {
  const { destinationId, name, sortOrder } = req.body;
  if (!isValidUUID(destinationId)) {
    return res.status(400).json({ error: 'validation_error', message: 'A valid destination is required.' });
  }
  if (!isNonEmptyString(name)) {
    return res.status(400).json({ error: 'validation_error', message: 'Section name is required.' });
  }

  const db = await getDb();
  const dest = await db.query('SELECT id FROM destinations WHERE id = $1 AND deleted_at IS NULL', [destinationId]);
  if (dest.rows.length === 0) {
    return res.status(404).json({ error: 'not_found', message: 'Destination not found.' });
  }

  const dup = await db.query('SELECT id FROM sections WHERE destination_id = $1 AND name = $2', [destinationId, name.trim()]);
  if (dup.rows.length > 0) {
    return res.status(409).json({ error: 'duplicate_section', message: 'A section with this name already exists for this destination.' });
  }

  let order = sortOrder;
  if (order === undefined || order === null) {
    const maxResult = await db.query('SELECT COALESCE(MAX(sort_order), -1) AS max FROM sections WHERE destination_id = $1', [destinationId]);
    order = maxResult.rows[0].max + 1;
  }

  const result = await db.query(
    'INSERT INTO sections (destination_id, name, sort_order) VALUES ($1, $2, $3) RETURNING *',
    [destinationId, name.trim(), order]
  );
  res.status(201).json({ section: result.rows[0] });
});

// PATCH /api/sections/:id — rename or reorder
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  if (!isValidUUID(id)) return res.status(400).json({ error: 'invalid_id' });
  const { name, sortOrder } = req.body;

  const db = await getDb();
  const existing = await db.query('SELECT * FROM sections WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    return res.status(404).json({ error: 'not_found' });
  }
  if (name !== undefined && !isNonEmptyString(name)) {
    return res.status(400).json({ error: 'validation_error', message: 'Section name cannot be empty.' });
  }
  if (name) {
    const dup = await db.query(
      'SELECT id FROM sections WHERE destination_id = $1 AND name = $2 AND id != $3',
      [existing.rows[0].destination_id, name.trim(), id]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'duplicate_section', message: 'A section with this name already exists for this destination.' });
    }
  }

  const result = await db.query(
    `UPDATE sections SET name = COALESCE($2, name), sort_order = COALESCE($3, sort_order), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, name ? name.trim() : null, sortOrder !== undefined ? sortOrder : null]
  );
  res.json({ section: result.rows[0] });
});

// DELETE /api/sections/:id — RESTRICT if it still has research items (per frozen schema:
// sections use ON DELETE RESTRICT at the FK level to prevent silently orphaning content)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  if (!isValidUUID(id)) return res.status(400).json({ error: 'invalid_id' });
  const db = await getDb();

  const existing = await db.query('SELECT * FROM sections WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    return res.status(404).json({ error: 'not_found' });
  }

  const itemCount = await db.query(
    'SELECT COUNT(*) AS count FROM research_items WHERE section_id = $1 AND deleted_at IS NULL',
    [id]
  );
  if (parseInt(itemCount.rows[0].count) > 0) {
    return res.status(409).json({
      error: 'section_not_empty',
      message: 'This section still contains research items. Move or delete them first before removing the section.',
    });
  }

  await db.query('DELETE FROM sections WHERE id = $1', [id]);
  res.json({ success: true });
});

module.exports = router;
