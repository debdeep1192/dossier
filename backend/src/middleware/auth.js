const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

function requireAuth(req, res, next) {
  const token = req.cookies?.session_token;
  if (!token) {
    return res.status(401).json({ error: 'not_authenticated', message: 'Sign in required.' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.ownerId = payload.ownerId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid_session', message: 'Session expired or invalid. Please sign in again.' });
  }
}

module.exports = { requireAuth, JWT_SECRET };
