# Dossier — Project Handover

**Prepared:** end of a long implementation/architecture conversation, at the explicit request of the product owner to pause all work and hand over the current state cleanly.

**Read this whole document before touching the code.** The project is mid-transition between two different architectures, and the frontend currently **does not build**. This is explained precisely in Section D and F — it is not hidden or glossed over.

---

## A. Product

**What Dossier is intended to do:** a personal, single-user, local-first travel research and trip-planning PWA. Three intended purposes: (1) a structured, searchable "Master Research" knowledge base per destination — attractions, hotels, restaurants, practical info, sources; (2) "Trips" built from that research plus the owner's own decisions (hotel choice, itinerary, budget, group logistics) — not implemented yet, schema only; (3) a lightweight "Live Trip Mode" for on-the-ground use during travel — not implemented at all yet, placeholder only.

**Currently implemented functionality (Research module only):**
- Destinations, with overview text
- Sections within a Destination (user-created, reorderable, renameable)
- Research Items — two kinds: "Typed Items" (Attraction/Hotel/Restaurant/Transport/Practical Info, with structured fields like entry fee, opening hours, visit duration) and general "Research Notes" (freeform, title + content only)
- Destination-level notes (a Research Item with no Section — a general note about the whole destination)
- Tags (freeform, many-to-many, case-normalized, deduplicated)
- Sources (URL/title/type per Research Item)
- Related Items (symmetric linking between two Research Items)
- Global search across items and tags
- "Recently updated" list
- Soft-delete for Research Items (never hard-deleted)

**Planned but not implemented:** Trips, Itinerary, AI itinerary parsing, Families/Logistics, Budget, Expenses, Bookings/Documents, Trip Contacts, Trip Preparation checklist, Live Trip Mode, any form of cloud sync. All of this has a complete, frozen database schema (see Section C) but **zero UI or query logic** built against it.

---

## B. Current architecture

**This section is intentionally split into IMPLEMENTED vs. PROPOSED, because the project changed direction mid-build.**

### IMPLEMENTED (what actually exists in the code right now)

- **Frontend:** React 19 + Vite, structured as a PWA (manifest present, service worker **not yet configured** — see below).
- **Database:** PostgreSQL-compatible schema (27 tables), currently existing in **two parallel places**:
  1. `backend/src/db/migrations/001_initial_schema.sql` — the original, still-intact schema, used by the old Express backend.
  2. `frontend/src/db/schema.sql` — an identical copy (one intentional diff: `owner_account.email`/`password_hash` made nullable — see Section C), intended for the new browser-based PGlite database.
- **Backend:** a complete, working Node/Express + PGlite (server-mode) REST API still exists in `backend/`, untouched since it was last verified working. It is **no longer the intended architecture** (see below) but has not been deleted.
- **Local-first browser database code:** partially built in `frontend/src/db/` — PGlite Web Worker setup (`pglite-worker.js`, `index.js`), and ported query logic for Destinations/Sections/Research Items/Tags/Sources/Relations/Profile (`db/queries/*.js`). **This code has not been tested at all** — see Section D.
- **PWA offline capability:** **not implemented.** `vite-plugin-pwa` is installed as a dependency but never configured in a `vite.config.js` (no such file exists yet with PWA plugin wiring). No service worker is generated. The app cannot currently load offline.
- **Export/Import (backup):** code written (`frontend/src/db/backup.js`) implementing versioned export, validation, and replace-on-import — **never tested, never wired to any UI button.**

### PROPOSED / architecture direction agreed but not fully realized

The product owner and I agreed, late in this conversation, to abandon the original cloud architecture (Netlify frontend + Render backend + Neon hosted Postgres) in favor of a **local-first architecture**: React PWA + PGlite running inside the browser via a Web Worker, persisted to IndexedDB, no server, no hosted database, no login/session system — just a local one-time "welcome" profile screen. Export/import to a portable JSON file is the sole mechanism for backup and moving data between devices, saved/restored manually (e.g., via Google Drive) — no direct cloud integration.

**This is the target architecture, not the current one.** The transition was roughly 60–70% done (schema copied, query logic ported, backup logic written, new Welcome/Profile screens written) when work was stopped. The old server-auth code (`AuthContext.jsx`, `AuthPage.jsx`, `api/client.js`) was already deleted as part of this transition, but the two files that referenced them (`App.jsx`, `MorePage.jsx`) were **not yet updated** to stop referencing them — this is the specific, exact cause of the current build failure (Section D/F).

### Deployment status
- **Netlify:** never successfully deployed. Netlify configuration (`netlify.toml`) exists but reflects the **old** cloud architecture (it has no PWA-specific config yet, though it also has no server dependency left in it — it's essentially a generic static-site config at this point).
- **GitHub:** a private repo `debdeep1192/dossier` was created and had an earlier, now-outdated snapshot of the project uploaded via a workaround (tar-archive-upload + GitHub Actions extraction) during the cloud-architecture phase. **It has not been updated with any of the local-first work done in this conversation.** Per explicit instruction, no further GitHub action was taken in this handover.
- **Render / Neon:** were set up conceptually and code was written/tested to support them (see `DEPLOYMENT.md`, `render.yaml`), but **no actual Render service or Neon database was ever created** — this was all preparation, verified locally against a simulated Postgres-wire-protocol server, never against real Render/Neon infrastructure. This entire direction is now superseded by the local-first decision and should likely be treated as historical/dead, though the files haven't been deleted (see Section G).

---

## C. Current database/schema

**Complete table list (27 tables, unchanged from the originally-frozen design, present in both `backend/src/db/migrations/001_initial_schema.sql` and `frontend/src/db/schema.sql`):**

Global/User scope: `owner_account`, `family_weight_presets`, `app_settings`
Research scope: `destinations`, `sections`, `research_items`, `tags`, `research_item_tags`, `sources`, `research_item_relations`
Trip scope: `trips`, `trip_destinations`, `itinerary_days`, `trip_items`, `parsed_itinerary_drafts`, `families`, `family_members`, `trip_logistics`, `budget_lines`, `budget_line_families`, `expenses`, `expense_allocations`, `booking_records`, `attachments`, `trip_contacts`, `trip_preparation_checklist`
Sync (dormant): `sync_operations`

**Migration files:**
- `backend/src/db/migrations/001_initial_schema.sql` — original, used by the Express backend
- `frontend/src/db/schema.sql` — copy for the browser database, with one diff (below)

**The one intentional schema change made in this conversation:** `owner_account.email` and `owner_account.password_hash` were changed from `NOT NULL` to nullable, in `frontend/src/db/schema.sql` only (the backend copy is untouched). Reason: the local-first architecture has no login/password; a profile row needs to be insertable without them. This was discussed and approved during the conversation before being made. It is a real, if small, schema difference between the two copies — flagging clearly since they are meant to be the same schema.

**Important relationships/constraints (unchanged from the original frozen design):**
- Research Items: `section_id` is nullable (destination-level notes); soft-delete only (`deleted_at`), never hard-deleted; `item_kind` and `priority` are constrained via `CHECK`.
- Sections: `ON DELETE RESTRICT` from Research Items — a Section cannot be deleted while it still contains items.
- Trip Items: carry a full snapshot of relevant Research Item fields at import time (`snapshot_*` columns), plus a nullable `source_research_item_id` (`ON DELETE SET NULL`) for traceability only — snapshots are never live-updated from Research.
- Attachments: `booking_record_id` uses `ON DELETE RESTRICT` (not `CASCADE`) specifically so a Booking Record's file attachments are never silently hard-deleted.

**Dormant schema features (present, unused by any code, deliberately kept per explicit product-owner instruction):**
- `sync_operations` table — entirely empty, no code reads/writes it.
- `entity_version INTEGER NOT NULL DEFAULT 1` columns on `trip_items`, `families`, `family_members`, `trip_logistics`, `budget_lines`, `expenses`, `booking_records`, `attachments`, `trip_contacts` — present, unused, was originally designed for future multi-device sync conflict detection, explicitly not being implemented now.
- All Trip-scope tables generally — schema exists, no UI or query code exists against them yet (Trips were never built, in either architecture).

---

## D. Current code status

**Backend (`backend/`) — WORKING, but now architecturally obsolete**
Complete Express + PGlite/pg REST API implementing the Research module (Destinations, Sections, Research Items, Tags, Sources, Relations) plus auth (JWT/cookie session). Was last verified passing 41/41 automated tests earlier in this conversation. **I attempted to re-verify this at handover time and could not get a conclusive result** — the sandbox environment used for this conversation has a known issue where background/spawned server processes don't reliably persist or respond across separate tool invocations (this was documented and worked around multiple times earlier in the conversation using a same-process spawn+fetch pattern). A quick re-attempt using that same pattern also failed to connect, and per the explicit "stop troubleshooting" instruction I did not chase this further. **I did not modify any backend code after its last successful verified test run** — so there is no known code-level reason it should have stopped working, but I cannot certify it works at this exact moment without further testing, which I was told not to do. Treat backend status as "last known good, unverified at handover" rather than "confirmed good."

**Frontend (`frontend/`) — BROKEN, does not build**
Confirmed by actually running `npm run build` immediately before packaging this handover, with no changes made afterward:
```
[UNRESOLVED_IMPORT] Could not resolve './context/AuthContext' in src/App.jsx
[UNRESOLVED_IMPORT] Could not resolve './pages/AuthPage' in src/App.jsx
```
Cause: `AuthContext.jsx`, `AuthPage.jsx`, and `api/client.js` were deleted as part of the in-progress local-first migration, but `App.jsx` and `MorePage.jsx` (which both still `import` from the deleted files) were not yet updated to use the new `ProfileContext.jsx`/`WelcomePage.jsx` that were built to replace them. This is the **entire, exact cause** of the build failure — nothing else is known to be broken in the frontend beyond this.

**Frontend — partially implemented / untested (new local-first code)**
- `frontend/src/db/pglite-worker.js`, `frontend/src/db/index.js` — PGlite Web Worker + IndexedDB persistence setup. Written based on verified current PGlite API documentation, but **never actually run** — no browser environment was available in this sandbox to load the app and confirm the worker initializes, the migration runs, or data persists to IndexedDB.
- `frontend/src/db/queries/*.js` (destinations, researchItems, profile, validate) — business logic ported from the working Express routes (same SQL, same validation rules). **Never executed even once** — not against browser PGlite, not against a Node-based test harness (a test seam, `__setTestDb`, was added to `db/index.js` for this purpose but no test file was ever written before work stopped).
- `frontend/src/api/research.js` — rewritten to call the local query functions instead of HTTP. Same exported shape as before. Untested.
- `frontend/src/context/ProfileContext.jsx`, `frontend/src/pages/WelcomePage.jsx` (+ `.css`) — new no-password first-run flow. Untested, and **not yet wired into `App.jsx`** (this is part of why the build is broken).
- `frontend/src/db/backup.js` — export/import logic (versioned, validated, replace-on-import, table-ordered for FK safety). Written but **never executed or wired to any UI button** — no Export/Import section exists in `MorePage.jsx` yet.

**Frontend — untouched from the original (working) Phase 1 implementation**
All components (`Button`, `Card`, `Badge`, `Field`, `Modal`, `SearchBar`, `TagInput`, `States`, `AppShell`), all screens except the two broken files above (`ResearchHome`, `DestinationDetail`, `ItemDetail`, `PlaceholderPage`), design tokens/global styles, routing structure. These were working against the old HTTP API in the last fully-verified state and have not been modified — but since `App.jsx` itself won't build, none of this can currently be exercised either.

**Not implemented at all:** PWA service worker/offline caching (plugin installed, not configured), any Trip-scope feature, any UI for export/import.

---

## E. Changes actually made during this conversation (not proposals — things actually done to files)

1. Backend: added deployment-related code (pg driver adapter, CORS/cookie production config, `.env.example`, `render.yaml`, `DEPLOYMENT.md`) during the earlier cloud-deployment phase. Verified working via a real Postgres-wire-protocol local test at the time. Now superseded by the local-first decision but not removed.
2. Backend: fixed a genuine `.gitignore`/secret-leak issue (removed a committed `.env` with a real secret, added proper `.gitignore`, added JWT auto-generation fallback).
3. Backend: fixed a genuine `render.yaml` bug (wrong monorepo syntax) and a genuine `netlify.toml` bug (`publish` path was wrong relative to `base`) — found via documentation research, not assumption.
4. Root: initialized a git repository, prepared a GitHub Actions-based upload workaround (mobile-only workflow), diagnosed a workflow-not-listed issue (likely branch/mobile-keyboard-corruption).
5. **Architecture pivot:** per explicit product-owner decision, abandoned the cloud architecture in favor of local-first. This is a real, agreed, significant change, not a unilateral one.
6. Frontend: copied the schema into `frontend/src/db/schema.sql`, with the one intentional nullable-column change described in Section C.
7. Frontend: created `pglite-worker.js`, `db/index.js` (with a `__setTestDb` test seam), `db/queries/validate.js`, `db/queries/destinations.js`, `db/queries/researchItems.js`, `db/queries/profile.js`, `db/backup.js`.
8. Frontend: rewrote `api/research.js` to use the new local query functions; **deleted** `api/client.js`, `context/AuthContext.jsx`, `pages/AuthPage.jsx` + `.css`.
9. Frontend: created `context/ProfileContext.jsx`, `pages/WelcomePage.jsx` + `.css`.
10. Frontend: installed `@electric-sql/pglite` (browser build) and `vite-plugin-pwa` as dependencies — **neither fully wired up yet** (PGlite is used by the new db code; vite-plugin-pwa is not yet in any Vite config).
11. **Work stopped here**, before updating `App.jsx`/`MorePage.jsx` to use the new context/page, before configuring the PWA plugin, before writing any test, before wiring Export/Import into the UI.

---

## F. Deployment

- **Runs locally right now:** Backend — last known working, unverified at this exact moment (see Section D). Frontend — **does not run/build right now** (confirmed broken build, Section D).
- **Ever successfully deployed:** No. Neither the old cloud architecture nor the new local-first architecture was ever deployed to a real, reachable URL.
- **Current Netlify status:** No site has been created/connected. Configuration files exist but reflect the old architecture and have not been updated for local-first/PWA.
- **Current GitHub status:** A private repo (`debdeep1192/dossier`) exists with an outdated snapshot (from the cloud-architecture phase, uploaded via the tar+Actions workaround). It does **not** contain any of the local-first work from this conversation. Per explicit instruction, nothing further was done with GitHub in this handover.
- **Render/Neon:** No real accounts/services were ever created. All related work was local preparation and verification only, now superseded.
- **Known deployment problems:** none yet attempted against real infrastructure for the local-first architecture, since the frontend doesn't currently build.

---

## G. Known problems (listed, not fixed)

1. **Frontend build is broken** — `App.jsx` and `MorePage.jsx` import two deleted files (`context/AuthContext`, `pages/AuthPage`). This is the most urgent fix needed before anything else can be tested.
2. **All new local-first database code is completely untested** — zero confirmation that PGlite-in-a-worker actually initializes correctly in a real browser, that the migration runs, that data persists to IndexedDB, or that any ported query function behaves correctly.
3. **PWA/offline capability does not exist yet** — `vite-plugin-pwa` is installed but not configured; no service worker is generated; the app cannot load offline in its current state.
4. **Export/Import has no UI** — the backup logic exists in `db/backup.js` but nothing in `MorePage.jsx` (or anywhere else) calls it.
5. **Two schemas exist in parallel** (`backend/` and `frontend/`) with one small intentional divergence — if the backend is kept around for reference, be careful not to let the two drift further apart accidentally.
6. **`backend/` itself is now architecturally obsolete** under the local-first decision but has not been deleted — a future session needs to decide whether to keep it (e.g., as a reference or a possible future sync-server foundation) or remove it.
7. **GitHub repo is stale** relative to local disk — do not assume the GitHub copy reflects current work.
8. **`netlify.toml`/`render.yaml`/`DEPLOYMENT.md`** all describe the old cloud architecture and have not been rewritten for local-first/static-PWA deployment.
9. Backend status at this exact moment is unverified (not known-broken, just not re-confirmed — see Section D).

---

## H. How to continue

The single highest-priority next step: **fix the two broken imports.** Concretely:
- In `frontend/src/App.jsx`: replace `import { AuthProvider, useAuth } from './context/AuthContext'` with `import { ProfileProvider, useProfile } from './context/ProfileContext'`, and replace the `AuthPage` import/route with `WelcomePage`. The gating logic needs to change from checking `authenticated` to checking `hasProfile` (exposed by `ProfileContext`).
- In `frontend/src/pages/MorePage.jsx`: replace the `useAuth` import/usage — there's no login/logout anymore, so this needs to show profile info (via `useProfile`) instead, and this is also the natural place to add the Export/Import UI that doesn't exist yet.

After that, the build should succeed, and the real work becomes: (1) actually load the app in a real browser to verify PGlite-in-a-worker genuinely initializes and persists data — this could not be tested in the sandbox this was built in; (2) write a Node-based test harness using the `__setTestDb` seam already added to `db/index.js` to verify the ported query logic before trusting it in the browser; (3) configure `vite-plugin-pwa` in a new `vite.config.js` for actual offline capability; (4) build the Export/Import UI in `MorePage.jsx` calling the already-written `db/backup.js` functions; (5) only then consider Netlify deployment of the static PWA build.

The full architecture discussion (why local-first was chosen, what was discarded and why, the export/import design requirements, the offline-testing checklist the product owner asked for) exists in this conversation's history — if continuing in a fresh conversation, the product owner should be asked whether to bring that context forward or treat this document as the sole source of truth going forward.
