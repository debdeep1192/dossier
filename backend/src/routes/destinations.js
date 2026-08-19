const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { isNonEmptyString, isValidUUID } = require('../utils/validate');

const router = express.Router();
router.use(requireAuth);

// GET /api/destinations — list all (not soft-deleted), with item counts
router.get('/', async (req, res) => {
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
  res.json({ destinations: result.rows });
});

// GET /api/destinations/recently-updated?limit=10
router.get('/recently-updated', async (req, res) => {
  const db = await getDb();
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
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
  `, [limit]);
  res.json({ items: result.rows });
});

// GET /api/destinations/search?q=... — global search across items, notes, tags
router.get('/search', async (req, res) => {
  const db = await getDb();
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ results: [] });

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
  `, [`%${q}%`]);
  res.json({ results: result.rows });
});

// GET /api/destinations/:id — full detail incl. sections, items, notes
router.get('/:id', async (req, res) => {
  const db = await getDb();
  const { id } = req.params;
  if (!isValidUUID(id)) return res.status(400).json({ error: 'invalid_id' });

  const destResult = await db.query('SELECT * FROM destinations WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (destResult.rows.length === 0) {
    return res.status(404).json({ error: 'not_found', message: 'Destination not found.' });
  }

  const sectionsResult = await db.query(
    'SELECT * FROM sections WHERE destination_id = $1 ORDER BY sort_order ASC, name ASC',
    [id]
  );

  const itemsResult = await db.query(`
    SELECT * FROM research_items
    WHERE destination_id = $1 AND deleted_at IS NULL
    ORDER BY title ASC
  `, [id]);

  res.json({
    destination: destResult.rows[0],
    sections: sectionsResult.rows,
    items: itemsResult.rows,
  });
});

// POST /api/destinations
router.post('/', async (req, res) => {
  const { name, overview } = req.body;
  if (!isNonEmptyString(name)) {
    return res.status(400).json({ error: 'validation_error', message: 'Destination name is required.' });
  }
  const db = await getDb();
  const result = await db.query(
    'INSERT INTO destinations (name, overview) VALUES ($1, $2) RETURNING *',
    [name.trim(), overview || null]
  );
  res.status(201).json({ destination: result.rows[0] });
});

// PATCH /api/destinations/:id
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  if (!isValidUUID(id)) return res.status(400).json({ error: 'invalid_id' });
  const { name, overview } = req.body;

  const db = await getDb();
  const existing = await db.query('SELECT * FROM destinations WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (existing.rows.length === 0) {
    return res.status(404).json({ error: 'not_found' });
  }
  if (name !== undefined && !isNonEmptyString(name)) {
    return res.status(400).json({ error: 'validation_error', message: 'Destination name cannot be empty.' });
  }

  const result = await db.query(
    `UPDATE destinations SET name = COALESCE($2, name), overview = COALESCE($3, overview), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, name ? name.trim() : null, overview !== undefined ? overview : null]
  );
  res.json({ destination: result.rows[0] });
});

// DELETE /api/destinations/:id — soft delete
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  if (!isValidUUID(id)) return res.status(400).json({ error: 'invalid_id' });
  const db = await getDb();
  const existing = await db.query('SELECT id FROM destinations WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (existing.rows.length === 0) {
    return res.status(404).json({ error: 'not_found' });
  }
  await db.query('UPDATE destinations SET deleted_at = now() WHERE id = $1', [id]);
  res.json({ success: true });
});

module.exports = router;
