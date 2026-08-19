const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/tags — all tags currently in use, with usage counts
router.get('/', async (req, res) => {
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
  res.json({ tags: result.rows });
});

module.exports = router;
