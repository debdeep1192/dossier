# Dossier — Phase 1

**Visual design status:** the current color palette and visual treatment are
a first implementation of the agreed design direction, not a final approved
design. Treat them as provisional until reviewed on an actual phone.

Personal travel research dossier. Phase 1 scope: authentication (single owner),
and the full Master Research module (Destinations, Sections, Research Items —
both Typed Items and general Notes, section- or destination-scoped — Tags,
Sources, and Related Items).

## Requirements
- Node.js 18+ (built and tested on Node 22)

## Running locally

**Backend** (in one terminal):
```
cd backend
npm install
npm run dev        # or: node src/server.js
```
Runs on http://localhost:3001. On first start it automatically creates the
database (a local file-based Postgres-compatible engine — see note below)
and applies migrations. Data persists in `backend/data/` between restarts.

The migration creates the 27 tables of the frozen Section 72 schema
(including `display_name` on `owner_account` — see note below), plus one
additional `schema_migrations` bookkeeping table used only by the migration
runner to track which `.sql` files have been applied. That bookkeeping
table is not part of the domain schema and isn't counted among the 27.

**Frontend** (in a second terminal):
```
cd frontend
npm install
npm run dev
```
Runs on http://localhost:5173. Open this in your browser (or on your phone,
if on the same network, via the "Network" URL Vite prints).

On first visit you'll be asked to set up the one owner account for this
application (no public registration, per the approved architecture).

## A note on `display_name`

`owner_account.display_name` is a small additive, nullable column not present
in the frozen Section 72 schema — added during Phase 1 so the app has a name
to show instead of a raw email address. It's non-breaking (nothing else
depends on it) and documented inline in the migration file. Flagging it
explicitly rather than leaving it unremarked; happy to remove it if you'd
rather Phase 1 contain zero deviation from the frozen schema.

## A note on the database

The app now supports two database backends, selected automatically:

- **Local development (default, no setup required)**: if `DATABASE_URL` is
  not set, the backend falls back to **PGlite**, a real Postgres engine
  embedded directly in the Node process. This is a convenience for
  developing without a real database at hand — it is **not** suitable for
  any deployed/persistent use.
- **Production / any deployment**: set `DATABASE_URL` to a real hosted
  PostgreSQL connection string (e.g. from Neon), and the backend uses the
  standard `pg` driver against it instead. This is the only path that
  should ever hold real data. See `DEPLOYMENT.md` for the full Netlify +
  Render + Neon deployment guide.

Both paths run the identical schema and SQL — nothing about the frozen
architecture changes based on which one is active.

## Testing

**Backend test suite** (41 tests against the real running server):
```
cd backend
node test/e2e.js
```

This exercises: owner setup/login/logout, destination/section/item CRUD,
typed items vs. destination-level notes, tag deduplication, sources,
symmetric relations, soft-delete integrity, section-delete protection, and
input validation edge cases.

## What to test manually in the browser

1. **Setup & auth** — create your owner account, sign out, sign back in.
2. **Create a Destination** — e.g. "Sri Lanka" with an overview.
3. **Add Sections** — e.g. Attractions, Hotels, Food to Try. Try adding a
   duplicate section name (should be rejected).
4. **Add a Typed Item** — e.g. an Attraction with entry fee, opening hours,
   priority. Confirm it shows in the right section.
5. **Add a destination-level Note** — via "+ General Note" on the Destination
   page (not inside any section). Confirm it appears in the "General Notes"
   area above the section list, not inside a section.
6. **Tags** — add a tag to an item, then try adding the same tag again
   (should not create a duplicate).
7. **Sources** — add a source URL to an item; confirm it's clickable.
8. **Relate items** — relate two items to each other; confirm the relation
   shows on both items (it's symmetric).
9. **Search** — use the search bar on Research Home; confirm it finds items
   by title, content, and tag.
10. **Table of Contents** — on a Destination with multiple sections, tap a
    TOC chip and confirm it scrolls to that section.
11. **Delete an item** — confirm it disappears from the UI. (It's soft-deleted
    server-side, not destroyed — this is verified by the automated tests.)
12. **Try to delete a Section that still has items** — should be blocked with
    a clear message.
13. **Resize your browser / open on your phone** — confirm the layout adapts
    (bottom nav on mobile, sidebar on desktop).

## PWA status (important clarification)

The frontend has the *foundation* for a PWA: a web app manifest (name, icons,
theme color) so it can be added to a phone's home screen, and a
mobile-first responsive layout. **It does not yet have a service worker, and
therefore has no offline capability.** Closing the browser tab or losing
connectivity means the app stops working until reconnected. Offline caching
and sync are scoped to Phase 8 in the approved architecture and haven't been
built. Please don't test offline behavior against this build — there isn't
any yet.

## What's deliberately not built yet (later phases)

Trips, Itinerary, AI parsing, Families/Logistics/Money, Bookings/Documents,
Trip Preparation, Export/Import, and Offline/Live Mode are all Phase 2+ per
the agreed development order. The "Trips" and "Live" nav tabs exist and are
honestly labeled as not-yet-built rather than faked with mock data.
