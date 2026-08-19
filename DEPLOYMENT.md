# Deploying Dossier — Netlify + Render + Neon

This replaces "run two local terminals" with a real deployed stack:
**Netlify** (frontend, static hosting) → **Render** (backend, Node/Express) →
**Neon** (production PostgreSQL). Nothing about the Phase 1 schema, routes,
or business logic changed to make this work — only the database driver
(now `pg` instead of PGlite when `DATABASE_URL` is set) and CORS/cookie
settings for cross-domain requests.

I cannot create these accounts or run these deployments for you — this
sandbox only has network access to package registries, not to Neon/Render/
Netlify's own sign-up or deploy APIs. The steps below are exact and in
order; each should take a few minutes.

---

## Step 1 — Create the Neon database

1. Go to neon.tech, sign up / log in, create a new project (any name, e.g. "dossier").
2. Neon gives you a connection string that looks like:
   ```
   postgresql://<user>:<password>@<endpoint>.neon.tech/<dbname>?sslmode=require
   ```
   Copy this — it's your `DATABASE_URL`. Keep it secret; it's a real credential.
3. You do **not** need to manually create tables — the backend runs the
   migration automatically on first boot (same as it does locally).

## Step 2 — Deploy the backend to Render

1. Push this repository to GitHub (Render deploys from a git repo).
2. On render.com: **New → Web Service**, connect the repo.
3. Configure:
   - **Root directory**: `backend`
   - **Build command**: `npm install`
   - **Start command**: `npm start`
   - **Runtime**: Node
4. Add these environment variables in Render's dashboard (Environment tab):

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | your Neon connection string from Step 1 |
   | `JWT_SECRET` | a long random string — generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and paste the output. Do this once; do not regenerate it later or all existing sessions will be invalidated. |
   | `FRONTEND_URL` | your Netlify URL from Step 3 below (you can add this after Step 3, then redeploy) |

   (A `render.yaml` blueprint is included in the repo root if you prefer
   Render's "Blueprint" deploy option, which pre-fills most of this.)
5. Deploy. Watch the logs — you should see `Migrations complete.` and
   `Server listening on port 3001` (Render maps this to its own public
   HTTPS URL automatically, e.g. `https://dossier-backend.onrender.com`).
6. Copy that Render URL — you'll need it for the frontend.

## Step 3 — Deploy the frontend to Netlify

1. On netlify.com: **Add new site → Import an existing project**, connect
   the same repo.
2. Netlify should auto-detect `netlify.toml` in the repo root, which sets:
   - Base directory: `frontend`
   - Build command: `npm run build`
   - Publish directory: `frontend/dist`
   - A redirect rule so client-side routing (React Router) works on refresh.
3. Add one environment variable in Netlify's dashboard (Site configuration → Environment variables):

   | Key | Value |
   |---|---|
   | `VITE_API_URL` | your Render backend URL + `/api`, e.g. `https://dossier-backend.onrender.com/api` |

4. Deploy. Netlify gives you a URL like `https://your-app-name.netlify.app`.

## Step 4 — Close the loop: tell the backend about the frontend

1. Go back to Render, set `FRONTEND_URL` to your actual Netlify URL from
   Step 3 (e.g. `https://your-app-name.netlify.app` — no trailing slash).
2. Redeploy the backend (Render redeploys automatically when you change an
   env var, or trigger it manually).

This step matters: without it, CORS blocks the Netlify frontend from
reaching the Render API at all (fails closed by design, not open —
see the warning the server logs if this is missing).

## Step 5 — Open it

Visit your Netlify URL on your phone or desktop, exactly like your other
Netlify apps. First visit prompts owner account setup, same as local testing.

---

## What was verified before handing this back to you

Since I can't literally deploy to Render/Netlify/Neon from here, I verified
the *code path* as rigorously as possible using a real Postgres
wire-protocol server running locally (not just PGlite's in-process API —
an actual TCP server speaking the Postgres wire protocol, which is what
Neon also speaks):

- The `pg` driver connects, runs the full migration, and performs
  parameterized queries correctly against a real Postgres-protocol
  connection (`npm run test:pg-driver`).
- All 41 existing API tests pass when the backend runs on the `pg` driver
  / `DATABASE_URL` path end-to-end, with an explicit check that it did
  **not** silently fall back to PGlite (`npm run test:pg-driver-full`).
- **Data survives a full backend process restart** on the same database
  connection — the specific property you asked me to confirm. A backend
  process created an owner account, a destination, and a research item;
  was killed entirely; a brand-new backend process started against the
  same database; login and all data were intact (`npm run test:persistence`).
- CORS correctly allows a configured `FRONTEND_URL` origin and (via normal
  browser same-origin enforcement) blocks others; cookies are configured
  `SameSite=None; Secure` in production, which is required for cross-site
  cookies to work between Netlify and Render (this is different from local
  dev, where `localhost:5173` → `localhost:3001` counts as same-site and
  the more restrictive `Lax` setting was sufficient).

What I could not verify directly: the actual live Netlify/Render/Neon
deployment, since I have no access to those services from this
environment. The local verification above exercises the identical code
paths (same driver, same wire protocol, same migration, same CORS/cookie
logic) that will run in production — but you'll want to run through the
acceptance checklist below once it's actually live, the same way you
planned for Phase 1 generally.

## Post-deployment acceptance checklist

Once deployed, please verify on the real Netlify URL (phone and desktop):

- [ ] Owner setup works
- [ ] Login/logout works, session persists across page reloads
- [ ] Create a Destination, Section, Research Item (typed + note)
- [ ] Edit and reorder Sections
- [ ] Tags, Sources, Related Items all work
- [ ] Search works
- [ ] Delete an item (soft-delete) and confirm it disappears from the UI
- [ ] **Trigger a Render redeploy (or just wait for it to sleep/wake on the
      free tier) and confirm all your data is still there afterward** —
      this is the live-environment version of the restart-persistence test
      above.

## Rollback / local development is unaffected

Local development still works exactly as before — `npm run dev` in both
`backend/` and `frontend/` with no `DATABASE_URL` set falls back to local
PGlite automatically, with a clear console warning that this is dev-only.
Nothing about the Phase 1 local testing workflow changed.
