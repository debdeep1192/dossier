# Dossier (New Foundation) — Handoff Note

## What was built

A completely new Dossier frontend — not a refactor of the old app. The old repository was used only as a visual reference (colors, typography, spacing, card/badge/nav styling); none of its architecture, database layer, or components were carried forward.

**Storage:** Plain IndexedDB (`src/db/connection.js`), no PGlite/WASM/Worker engine. Opens near-instantly — no engine to boot before the app is usable.

**Data model — 10 fixed sections, each with its own dedicated storage and fields (no generic `item_kind` model anywhere):**
1. Attractions & Activities
2. Restaurants & Food (supports both place-based restaurants and non-place dish/food notes)
3. Accommodation
4. Transport (organized around a from → to relationship)
5. Costs & Money
6. Practical Info
7. Weather & Best Time to Visit
8. Packing & Preparation
9. General Notes
10. Sources & References

**Document parsing:** `src/db/extraction.js` does structured extraction — recognizes headings, list items, and "Label: value" pairs, and proposes a section per candidate based on heading keywords. Conservative by design: it never fabricates a price unless the text has an unambiguous currency+amount pattern, and it proposes a section but never a full record.

**Review flow:** Document text → intake → candidates (`pending_review`) → review screen (accept / edit / reject, grouped by proposed section) → accepted candidates go through the exact same create function manual entry uses. Nothing is ever auto-accepted. The original pasted text is always preserved in full.

**Google Maps:** `src/lib/googleMaps.js` — uses a stored Maps URL if present, otherwise generates `https://www.google.com/maps/search/?api=1&query=...`. Wired into Attractions, Restaurants, and Accommodation.

**Performance:** No global loading gate — the app shell renders immediately; each page fetches its own data via a stale-while-revalidate cache (`src/hooks/useCachedQuery.js`) so revisiting a destination/section within a session is instant.

**Visual language:** Design tokens, global styles, card/badge/button/nav CSS adapted from the old app's visual language (bottom-tab nav on mobile, sidebar on desktop, left-edge accent bars on cards, bottom-sheet modals, pill badges, serif headings).

## Verification performed in the sandbox

| Check | Result |
|---|---|
| `npm run build` | ✅ Succeeds. Output: ~300KB JS+CSS total (vs. old app's ~17MB WASM payload). |
| `npx oxlint src/` | ✅ 0 errors, 3 pre-existing-style warnings (same class as the reference app's own code). |
| `npm test` (real IndexedDB integration suite, via `fake-indexeddb`) | ✅ 17/17 passing |
| Routes/imports | ✅ All 14 routes resolve to real, existing page files; all 10 section-registry paths match their routes exactly. |
| 10 sections | ✅ Each has its own store, its own fields, verified via create/edit/delete tests for representative sections. |
| Document → extraction → candidates → review → accept/reject | ✅ Verified end-to-end: heading/list/label extraction, no auto-accept, accept/reject/undo, edited candidates persist, accepted records are shape-identical to manually-created ones. |
| Google Maps URL generation | ✅ Verified: stored URL takes priority, generated search URL matches the approved format exactly, empty place returns `null`. |
| IndexedDB persistence | ✅ Verified via a simulated-reload test: data survives resetting the JS connection singleton while the underlying IndexedDB store is untouched — the same thing that happens on a real page reload. |

**What could not be verified in this sandbox:** actual browser rendering, IndexedDB behavior in a real browser (only tested via the `fake-indexeddb` polyfill), and real device/network performance. That's expected — this is what your post-deployment testing covers.

## What I need you to do in Termux

1. Extract the ZIP into a fresh directory (don't merge into the old Dossier repo — this is intentionally a separate project).
2. `cd` into the extracted folder.
3. `npm install`
4. `npm run build` — confirm it succeeds (should match what's reported above).
5. Initialize git and push to a **new** GitHub repository (keep it separate from the old `dossier` repo, per the fixed workflow — suggest naming it something like `dossier-v2` or similar, your call):
   ```
   git init
   git add -A
   git commit -m "New Dossier foundation: 10-section research, document intake/review, IndexedDB storage"
   git remote add origin <your new repo URL>
   git branch -M main
   git push -u origin main
   ```

## Cloudflare Pages deployment step

- Connect the new GitHub repo to Cloudflare Pages.
- Build command: `npm run build`
- Build output directory: `dist`
- Framework preset: Vite (should auto-detect)
- No environment variables or backend config needed — this is a fully static, client-only app.
- A `public/_redirects` file (`/* /index.html 200`) is already included so client-side routing (e.g. `/destinations/abc123`) works correctly on reload instead of 404ing — this is required for Cloudflare Pages specifically and was added during this pass.

## What to test after deployment

- **First load**: should feel immediate — no blank/loading screen before the app shell appears.
- **Create a destination**, navigate into it — confirm the 10-section grid appears with counts.
- **Add an entry manually** in a few different sections (try Attractions, Restaurants — both with and without a place, and Transport).
- **Tap "Open in Google Maps"** on a place-based entry — confirm it opens Maps correctly, both for an entry where you paste a real Maps link and one where you don't (generated search).
- **Import from text**: paste something with a heading like "Attractions" followed by a bulleted list, submit, and confirm the review screen groups candidates under the right section with nothing pre-accepted.
- **Accept a couple of candidates, reject one, undo the rejection** — confirm the resulting records show up correctly back on the destination page.
- **Reload the page** after adding data — confirm everything is still there (real IndexedDB persistence, not just the sandbox's simulated version).
- **Close the tab/app entirely and reopen** — same check, further out.
- General navigation feel between destinations/sections — this is the thing the whole rebuild was meant to fix, so it's worth deliberately paying attention to.

Nothing was committed to git in this sandbox — the ZIP is a plain source tree, ready for you to initialize fresh in Termux.
