require('dotenv').config();

// If no JWT_SECRET is configured (e.g. a fresh checkout without a .env),
// generate one for this process so local development works immediately.
// This must happen before any module that reads process.env.JWT_SECRET is
// required. Sessions won't survive a restart in this fallback case, since a
// new random secret is generated each time — set JWT_SECRET in .env for a
// fixed value across restarts.
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = require('crypto').randomBytes(32).toString('hex');
  console.warn('No JWT_SECRET set in environment — generated a temporary one for this run. Set JWT_SECRET in .env for persistent sessions across restarts.');
}

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { runMigrations } = require('./db/migrate');

const authRoutes = require('./routes/auth');
const destinationRoutes = require('./routes/destinations');
const sectionRoutes = require('./routes/sections');
const researchItemRoutes = require('./routes/researchItems');
const tagRoutes = require('./routes/tags');

const app = express();
const PORT = process.env.PORT || 3001;

if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
  console.warn(
    'WARNING: NODE_ENV=production but FRONTEND_URL is not set. CORS will block ' +
    'all cross-origin requests, so the Netlify frontend will not be able to reach ' +
    'this API. Set FRONTEND_URL to your Netlify site URL, e.g. https://your-app.netlify.app'
  );
}
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  console.warn(
    'WARNING: NODE_ENV=production but DATABASE_URL is not set. The server will ' +
    'fall back to local PGlite, which does NOT persist correctly on Render and ' +
    'must never be used as the production data store.'
  );
}

// In production, only allow the configured Netlify frontend origin to make
// credentialed requests. In development, allow any origin (reflects the
// request origin) purely for local convenience across ports.
const allowedOrigin = process.env.FRONTEND_URL;
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (allowedOrigin || false)
    : true,
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/destinations', destinationRoutes);
app.use('/api/sections', sectionRoutes);
app.use('/api/research-items', researchItemRoutes);
app.use('/api/tags', tagRoutes);

// Central error handler — never leak stack traces to the client,
// always return a structured, actionable error.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server_error', message: 'Something went wrong on our end. Please try again.' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: 'This endpoint does not exist.' });
});

async function start() {
  console.log('Running database migrations...');
  await runMigrations();
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
