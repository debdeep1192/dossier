const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// Netlify (frontend) and Render (backend) are different registrable
// domains — genuinely cross-site, not just cross-port like local dev
// (localhost:5173 -> localhost:3001 counts as same-site for cookie
// purposes since the site is still "localhost"). Cross-site cookies
// require SameSite=None + Secure; same-site local dev can keep the
// more restrictive Lax. NODE_ENV=production (set on Render) selects
// the cross-site-safe configuration.
const isProduction = process.env.NODE_ENV === 'production';
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: isProduction ? 'none' : 'lax',
  secure: isProduction, // required whenever sameSite is 'none'
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

// GET /api/auth/status — tells the frontend whether an owner account
// exists yet (drives whether to show Setup vs Login) and whether the
// current request is authenticated.
router.get('/status', async (req, res) => {
  const db = await getDb();
  const result = await db.query('SELECT id, email, display_name FROM owner_account LIMIT 1');
  const ownerExists = result.rows.length > 0;

  let authenticated = false;
  let owner = null;
  const token = req.cookies?.session_token;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (ownerExists && result.rows[0].id === payload.ownerId) {
        authenticated = true;
        owner = { email: result.rows[0].email, displayName: result.rows[0].display_name };
      }
    } catch (e) {
      // invalid/expired token — treat as unauthenticated, not an error
    }
  }

  res.json({ ownerExists, authenticated, owner });
});

// POST /api/auth/setup — one-time owner account creation.
// Rejected if an owner account already exists (single-owner architecture,
// no open registration).
router.post('/setup', async (req, res) => {
  const { email, password, displayName } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'validation_error', message: 'Email and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'validation_error', message: 'Password must be at least 8 characters.' });
  }

  const db = await getDb();
  const existing = await db.query('SELECT id FROM owner_account LIMIT 1');
  if (existing.rows.length > 0) {
    return res.status(403).json({ error: 'owner_exists', message: 'An owner account already exists. This application does not support additional registrations.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await db.query(
    'INSERT INTO owner_account (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, email, display_name',
    [email.trim().toLowerCase(), passwordHash, displayName || null]
  );

  const owner = result.rows[0];
  const token = jwt.sign({ ownerId: owner.id }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('session_token', token, COOKIE_OPTIONS);
  res.status(201).json({ owner: { email: owner.email, displayName: owner.display_name } });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'validation_error', message: 'Email and password are required.' });
  }

  const db = await getDb();
  const result = await db.query('SELECT * FROM owner_account WHERE email = $1', [email.trim().toLowerCase()]);
  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'invalid_credentials', message: 'Incorrect email or password.' });
  }

  const owner = result.rows[0];
  const valid = await bcrypt.compare(password, owner.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'invalid_credentials', message: 'Incorrect email or password.' });
  }

  const token = jwt.sign({ ownerId: owner.id }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('session_token', token, COOKIE_OPTIONS);
  res.json({ owner: { email: owner.email, displayName: owner.display_name } });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('session_token', COOKIE_OPTIONS);
  res.json({ success: true });
});

// GET /api/auth/me — current owner details (requires auth)
router.get('/me', requireAuth, async (req, res) => {
  const db = await getDb();
  const result = await db.query('SELECT email, display_name, created_at FROM owner_account WHERE id = $1', [req.ownerId]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'not_found' });
  }
  res.json({ owner: result.rows[0] });
});

module.exports = router;
