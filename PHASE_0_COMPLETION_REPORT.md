# Phase 0 Completion Report — Research Foundation

Status: **implementation and verification complete.** Every item in the acceptance checklist below was either runtime-tested against a real PGlite/Postgres engine (not just read as code) or explicitly marked as not runtime-testable in this environment, with the reason stated. Nothing has been committed or pushed — this remains an uncommitted working copy cloned from `debdeep1192/dossier` at `4c8e04e`.

---

## 1. Final architecture

```
Destination
  └─ Section (free-text name, e.g. "Attractions", "Food")
       └─ Research Item (item_kind: attraction | activity | restaurant |
                          food | accommodation | transport |
                          practical_info | note)
```

Two paths into Research Items, converging on the same entity and the same `createResearchItem()` function — **verified at runtime**, not just by code reading (see §8, test 3):

```
Manual entry (DestinationDetail "+ Section item" / "+ General Note")
   → createResearchItem() → research_items row

Document/paste intake (DestinationDetail "+ Import from text")
   → research_intake (raw text preserved in full)
   → extraction adapter → research_candidates (status: pending_review)
   → review screen (ItemReview.jsx): accept / edit / reject, per candidate
   → accept → createResearchItem() → research_items row
             (candidate.resulting_item_id links back for provenance)
```

The parser never writes to `research_items` directly. `research_candidates.status` starts `pending_review` and only becomes `accepted` or `rejected` through an explicit, per-candidate user action; `rejected` can be reset back to `pending_review` (undo), but `accepted` cannot (it already became a real item) — both rules are enforced in `researchIntake.js` and runtime-verified.

No Trip-scope tables were touched.

---

## 2. Files changed

20 modified, 10 new (754 insertions, 525 deletions per `git diff --stat`).

**New:**
- `frontend/src/db/migrations.js` — versioned migration steps (see §3)
- `frontend/src/db/extraction/index.js` — extraction adapter interface + the shipped non-classifying adapter
- `frontend/src/db/queries/researchIntake.js` — intake/candidate CRUD and review actions
- `frontend/src/hooks/useCachedQuery.js` — in-memory stale-while-revalidate hook (the navigation performance fix)
- `frontend/src/components/Price.jsx` / `Price.css` — structured price field/display
- `frontend/src/pages/ItemReview.jsx` / `ItemReview.css` — candidate review screen
- `frontend/src/db/__tests__/phase0.test.js` — the runtime integration test suite (16 tests, see §8)
- `frontend/src/db/__tests__/raw-sql-loader.mjs` — minimal Node ESM loader so the test suite can import the real (unmodified) `db/index.js`, resolving Vite's `?raw` import syntax outside Vite

**Modified (highlights, not exhaustive):**
- `frontend/src/db/schema.sql` — see §3
- `frontend/src/db/index.js` — added the migration-runner logic in `ensureSchema()`, plus `__ensureSchemaForTest` test seam
- `frontend/src/db/queries/{destinations,researchItems,profile,validate}.js` — new fields/kinds, destination-delete cascade, a genuine bug fix (see §3), home currency
- `frontend/src/db/backup.js` — added `research_intake`/`research_candidates` to `TABLE_ORDER`; `resetSchema()` now excludes `schema_migrations` from being wiped on restore
- `frontend/src/api/research.js` — added `intakeApi`, `candidatesApi`, `profileApi`
- `frontend/src/pages/{DestinationDetail,ItemDetail,ResearchHome,MorePage}.jsx` (+ `.css`) — new taxonomy, type-appropriate fields, cached navigation, delete affordances, home-currency setting
- `frontend/src/components/{Badge,AppShell}.jsx` — new item-kind labels; `AppShell` accepts a `children` override
- `frontend/src/App.jsx` — new `/research/:destinationId/review/:intakeId` route, progressive shell render
- `frontend/index.html` — removed blocking Google Fonts network request
- `frontend/package.json` — added `"test"` script
- Five files under `db/`/`db/queries/` had extensionless relative imports (`from '../index'`) given explicit `.js` extensions — required for the Node-based test suite to load the real application modules (Node's ESM resolver, unlike Vite's, requires extensions); purely mechanical, no behavior change, confirmed by an unchanged build output.

---

## 3. Database / schema changes

- `research_items`: removed `entry_fee`, `price_range`; added `price JSONB` and `details JSONB`. `item_kind` CHECK expanded to `attraction/activity/restaurant/food/accommodation/transport/practical_info/note` (was `attraction/hotel/restaurant/transport_option/practical_info/note`).
- `owner_account`: added `home_currency TEXT NOT NULL DEFAULT 'INR'`.
- New tables: `research_intake`, `research_candidates`.
- New `schema_migrations` bookkeeping table (id, applied_at), created by `db/index.js`, not `schema.sql`.
- `db/backup.js`'s `TABLE_ORDER` includes both new tables in correct dependency order.

### Migration mechanism — resolved this pass

Previously an open gap: `ensureSchema()` only knew "fresh vs. not," with no path for an existing local database to gain new columns/tables safely. This is now fixed with a lightweight, version-tracked mechanism (`db/migrations.js` + `schema_migrations` table, wired into `db/index.js`'s `ensureSchema()`):

- **Fresh database** (no `destinations` table): runs `schema.sql` as one shot (already reflects the combined end-state), then marks every migration id as applied — no need to replay history against data that doesn't exist yet.
- **Existing database** (has `destinations` already): `schema.sql` is *not* re-run. Instead, any migration id not yet in `schema_migrations` is applied via its `up(pg)` step, in order, then recorded. The one migration currently defined (`2026_phase0_research_taxonomy`) is written as pure additive/data-preserving SQL:
  - Renames existing `item_kind` values (`hotel`→`accommodation`, `transport_option`→`transport`) rather than reclassifying — a straightforward rename preserves the same real-world meaning without the migration having to guess.
  - Adds `price`/`details` columns.
  - Folds any existing `entry_fee`/`price_range` free text into the new `price.note` field (rather than discarding it) before dropping those columns, so no information is lost, only re-homed.
  - Adds `owner_account.home_currency` (default `INR`).
  - Creates `research_intake`/`research_candidates` if not already present.
  - Every step is idempotent (checks `information_schema` before acting), so running it twice — or against a database at various intermediate states — doesn't error or duplicate.
- `resetSchema()` (used by backup restore) now explicitly excludes `schema_migrations` from the tables it truncates, so restoring a backup doesn't erase migration history and cause `ensureSchema` to attempt re-applying already-applied migrations.

**This was runtime-tested, not just written** — see §8, test 2: a real PGlite database was seeded with the *exact pre-Phase-0 schema* and real sample rows (a hotel with `entry_fee`/`price_range` text, a `transport_option` item), then the real `ensureSchema()` was run against it, and the result was asserted: rows survived with original ids/titles, `item_kind` values renamed correctly, old fee text preserved inside `price.note`, new columns/tables present, and running migration again afterward was confirmed to be a safe no-op.

---

## 4. Parser / intake flow

`db/extraction/index.js` defines the adapter contract and ships one adapter: a paragraph splitter that performs **no classification** — every candidate's `proposedItemKind`/`proposedTitle` start `null`, with an `uncertaintyNote` telling the reviewer nothing has been guessed. Runtime-verified (§8, test 6) that a two-paragraph paste produces exactly two candidates, both starting fully unclassified.

A genuine semantic parser needs a language model / network call — a disclosed architectural boundary in this local-first, no-backend app. The adapter interface is the seam for that; nothing else (schema, review queries, `ItemReview.jsx`) would need to change to plug one in later.

Review actions (`researchIntake.js`), all runtime-verified: `updateCandidate`, `acceptCandidate` (rejects if type/title missing, confirmed), `rejectCandidate`, `resetCandidateToPending` (works on rejected, correctly blocked on accepted, confirmed).

## 5. Manual entry flow

Runtime-verified (§8, test 3) that a manually-created item and a candidate-accepted item have **identical field shapes** (same keys, same structure) — not just "look similar," but programmatically compared. Also verified that an accepted item can subsequently be edited manually with additional fields (price, hours, duration) added after the fact, with its title from acceptance preserved (§8, test 6b).

---

## 6. Currency design

`research_items.price` is `JSONB: {amount, currency, unit, note}`. Runtime-verified (§8, test 7b): a price stored as `{amount: 150, currency: 'THB', ...}` remains exactly `THB 150` after the home currency is separately changed to `INR` — confirming no accidental coupling between the two. `owner_account.home_currency` defaults to `INR` and is independently configurable via `MorePage.jsx` → `profileApi.updateHomeCurrency`, runtime-verified (§8, test 7a). No conversion logic exists yet, by design — explicitly deferred.

---

## 7. Performance changes

**Root cause** (established prior to this pass, unchanged): `getDb()`'s singleton was already correctly memoized — the sluggishness was in the UI layer, where `DestinationDetail.jsx`/`ItemDetail.jsx` blocked all rendering on `if (!data) return <LoadingState/>` on every mount, with no memory of data already fetched earlier in the session.

**Fix:** `hooks/useCachedQuery.js`, an in-memory (session-only) stale-while-revalidate cache keyed by route. First visit to a destination/item shows the loading state as before; any later visit in the same session shows the previously-fetched data **immediately, with no loading flash**, while silently re-querying in the background. Mutations invalidate the relevant key(s) before refreshing.

Traced carefully for correctness (not just built and assumed correct):
- Navigating directly between two already-cached keys (Destination A → Destination B) was traced through React's effect/state-batching model to confirm `data` transitions straight from A's cached value to B's cached value with no stale-A-shown-as-B frame, since `setData(existing)` happens synchronously within the effect before any async gap.
- Confirmed every mutation call site (`DestinationDetail.jsx`, `ItemDetail.jsx`) correctly invalidates both the entity's own cache key and any other cached view that displays derived data from it (e.g. editing an item invalidates the parent destination's cache too, since the destination page shows item titles/prices in its list).

**Not used:** a PWA/service-worker cache was attempted mid-session, then explicitly removed per instruction that navigation must be solved at the UI/data layer, not papered over with asset caching. `vite-plugin-pwa` remains installed but unused, matching the pre-Phase-0 state.

**Also:** removed the blocking Google Fonts `<link>` from `index.html` (a separate, small, local-first correctness fix — zero network dependency at startup now). `getDestination()`'s two independent sub-queries run in parallel via `Promise.all`.

**What could not be runtime-tested in this environment:** actual click-through navigation timing in a real browser/device (no browser available in this sandbox). The fix's logic was verified by (a) a careful manual trace of the state/effect sequencing described above, and (b) the underlying data-fetch operations it wraps being confirmed fast via the integration test suite (every query in §8 completes as part of a synchronous-feeling test run against a real Postgres engine). Actual perceived navigation speed on Debdeep's phone should still be spot-checked once deployed.

---

## 8. Tests / build / lint results

All commands run from a fresh clone of `debdeep1192/dossier` at `4c8e04e`, in this working copy (`/home/claude/work`).

```
npm install --no-audit --no-fund
```
→ succeeded, 356 packages.

```
npm run build
```
→ **succeeded.** Only pre-existing third-party `eval` warnings from `@electric-sql/pglite`'s own bundle (present before Phase 0 too, unrelated to this work).

```
npx oxlint src/
```
→ **0 errors, 3 warnings.** All three pre-existing in class/pattern (two Fast-Refresh export-shape notes matching an existing codebase pattern, one pre-existing unused catch parameter in `backup.js`). No warnings introduced by Phase 0 work remain — several were introduced during implementation and fixed before this report.

```
npm test
```
(→ `node --experimental-loader ./src/db/__tests__/raw-sql-loader.mjs src/db/__tests__/phase0.test.js`)

→ **16 passed, 0 failed.** This is a genuine runtime integration test suite — a real `@electric-sql/pglite` engine running in-memory in Node (via the `__setTestDb`/`__ensureSchemaForTest` test seams already present in `db/index.js`), exercising the actual application query-layer code, not a re-implementation of it or a purely static check. No test framework dependency was added; it's a plain script with a minimal assert-and-report harness. Coverage:

1. Fresh database initialization (5 tests) — all expected tables exist, `price`/`details` columns present, `home_currency` defaults to `INR`, all migrations marked applied on a fresh DB, all 8 new `item_kind` values accepted and the old `hotel` value correctly rejected by application-level validation.
2. Migration from a pre-Phase-0 database with real seeded data (1 test) — see §3.
3. Manual create/edit/soft-delete (2 tests) — including the manual-vs-accepted-candidate shape-equivalence check.
4. Sections (1 test) — creation, duplicate-name rejection, delete-blocked-while-non-empty, delete-succeeds-once-empty. Found and fixed a real pre-existing bug during this test (see below).
5. Destination navigation/delete cascade (1 test) — soft-delete cascades correctly to items; sections remain physically present but confirmed unreachable through any read path.
6. Full intake→review→accept flow (2 tests) — including reject, undo-via-reset, the accept-without-type/title guard, and post-accept manual editing.
7. Home currency / structured price (2 tests).
8. Backup/restore (2 tests) — export includes the new tables with real data; restore round-trips a `research_intake` row with its original id intact.

```
git diff --check
```
→ **clean, no whitespace errors.**

### Bug found and fixed during this verification pass

`deleteSection()` had a real, pre-existing latent bug (not introduced by Phase 0, but found while runtime-testing §8 test 4): its own application-level guard correctly checks for `deleted_at IS NULL` items before allowing deletion, but `research_items.section_id` has an `ON DELETE RESTRICT` foreign key that only checks physical row existence — so a *soft-deleted* item (still physically present, just flagged) would pass the app-level guard yet still cause the database-level `DELETE FROM sections` to fail. Fixed in `deleteResearchItem()`/`deleteDestination()`'s cascade: both now clear `section_id` to `NULL` alongside setting `deleted_at`, since a trashed item has no meaningful "current section" anyway and this doesn't lose any real information (title/content/price/etc. all remain intact). Re-verified passing after the fix.

---

## 9. Known limitations / explicitly not runtime-tested here

1. **No real browser/device testing.** This sandbox has no browser. All verification is via the Node-based integration test suite (a real Postgres engine, real application query code, but not the actual `PGliteWorker`/IndexedDB/Web-Worker browser path, and not the React UI layer itself). The migration mechanism, all CRUD paths, the intake/review flow, currency handling, and backup/restore were verified against the same underlying `db/queries/*.js` and `db/migrations.js` code the browser uses — only the browser-specific glue (`PGliteWorker`, IndexedDB persistence, the React component tree rendering) is unverified here.
2. **Actual perceived navigation speed on a phone** has not been measured — see §7.
3. `opening_hours` remains free text by deliberate choice (disclosed in schema comments).
4. The extraction adapter is genuinely non-semantic (paragraph splitting only) — disclosed throughout.
5. `ItemDetail.jsx`'s `KIND_FIELD_SETS` is duplicated (also in `DestinationDetail.jsx`) rather than extracted to a shared module — small, accepted duplication.
6. Nothing has been committed or pushed.

---

## 10. Exact commands used for verification (for reproduction)

```bash
git clone https://github.com/debdeep1192/dossier.git
cd dossier/frontend
npm install --no-audit --no-fund
npm run build
npx oxlint src/
npm test
cd ..
git diff --check
```
