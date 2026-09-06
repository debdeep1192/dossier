# DOSSIER — Project Handover

Written directly from inspection of the actual current source tree (not from prior conversation memory). Where this document and any other file disagree, **the source code is authoritative** — this document is a snapshot, the code is the truth.

---

## 1. Product purpose

Dossier is a personal travel research and trip-management application for the user and their family. Intended long-term flow:

```
Travel research → Organize/preserve research in Dossier → Build a Trip using that
research → Prepare for the Trip → Use Dossier during travel → Preserve the trip
as a historical record
```

**Current implementation status of that flow: only the first stage ("Organize/preserve research") exists.** Trip building, trip preparation, live-trip usage, and historical trip records are **NOT IMPLEMENTED** — confirmed by an exhaustive search of the source tree: no `trip` store, no trip pages, no trip routes anywhere. The word "Trip" appears only in a couple of forward-looking code comments (e.g. "reusable by future Trip Planning / cost calculation" in `db/currency.js`) and nowhere as actual functionality.

---

## 2. Development principles (carry forward)

- Personal application for the user and family — not an enterprise SaaS product.
- Keep the architecture practical, small, and understandable. Prefer the minimum necessary implementation.
- Preserve existing working functionality. Do not casually redesign the data model. Avoid destructive changes. Data preservation is important; prefer additive/backward-compatible changes.
- No authentication, no hosted backend, no cloud database, no cloud sync unless explicitly requested.
- No Express/Neon/Render/JWT/CORS/GitHub Actions unless there's a specific requested reason.
- Prefer small, independently testable steps over giant batches of unrelated changes. Verify milestones with tests/builds.
- Do not redesign working architecture without first explaining why.
- Functional correctness and data integrity take priority over visual polish.

---

## 3. Actual current architecture — IMPLEMENTED NOW

- **Frontend**: React 19.2.8, React Router 7.18.2 (`BrowserRouter`, all client-side routing).
- **Build tool**: Vite 8.2.0. `npm run build` produces a static `dist/` (no SSR, no server).
- **Persistence**: **plain browser IndexedDB**, no library wrapper, no PGlite, no WASM database engine. `src/db/connection.js` uses the native `indexedDB.open()` API directly with a hand-rolled promise wrapper (`tx`, `getAll`, `getOne`, `put`, `remove`).
- **Database name**: `dossier`. **Current `DB_VERSION`: `2`** (confirmed by direct read of `src/db/connection.js`).
- **PWA/offline**: **NOT a PWA.** No service worker, no `manifest.json`, no `vite-plugin-pwa` (confirmed absent from `package.json` dependencies and `vite.config.js`). Only `public/_redirects` exists, which is a Cloudflare Pages SPA-routing redirect rule (`/* /index.html 200`), unrelated to offline/PWA capability.
- **Deployment**: static site on Cloudflare Pages, deployed by the user via `git push origin main` → Cloudflare's own build (`npm run build`, publish `dist/`). No deployment config files exist in the repo beyond `public/_redirects`.
- **Authentication**: none. No profile/account/login concept anywhere in the source (no `context/` directory, no auth-related files).
- **PDF parsing library**: `pdfjs-dist` (`^6.2.108`), the only non-framework runtime dependency. Loaded via `import()` dynamically inside `extractTextFromPdf()` — not a top-level import — so it never inflates the app's initial JS bundle; it's fetched only when a person actually uploads a PDF.

### LEGACY / DORMANT
**None found.** This is a fully rebuilt project (`dossier-new`), started from scratch in an earlier phase of this work, not a refactor of the old PGlite/Postgres/Express-backed Dossier. An exhaustive grep for `pglite`, `postgres`, `neon`, `express`, `jwt` across the source tree returns zero real hits — the only two matches are explanatory code comments referencing the *old, separate* project for context (in `App.jsx` and `db/connection.js`), not any actual dormant code, config, or dependency. There is no `backend/` directory in this project at all.

### FUTURE / NOT IMPLEMENTED
- Cloud sync of any kind.
- Any server/backend component.
- PWA/offline-app-shell capability.
- Trip planning, live trip mode, historical trip records (see §1).

---

## 4. Database / persistence inventory

**Technology:** native browser IndexedDB. **Current version: 2** (`DB_VERSION = 2` in `src/db/connection.js`). Version 1 → 2 was a purely additive upgrade (new object stores only; no store removed, no field renamed at the schema level) — confirmed by reading the version-2 migration test in `foundation.test.js`, which seeds a real v1 database, opens it with the current app code, and asserts the pre-existing destination record and its fields survive unchanged.

**Upgrade mechanism:** IndexedDB's own `onupgradeneeded` handler (no separate migration framework). The handler is written as "create any store that doesn't already exist" — so it is safe to run against a database at any prior version state.

### Complete store inventory (15 object stores)

| Store | Keyed by | Indexed by | Purpose |
|---|---|---|---|
| `destinations` | `id` | — | The top-level entity everything else hangs off. Plain fields: `id, name, overview, currencies?, createdAt, updatedAt, deletedAt`. `currencies` is optional/dynamic (added only once a destination's currency list is edited — see §6), not a fixed field. |
| `sources` | `id` | `destinationId` | Reference/citation records (title, url, type, accessedAt, notes). |
| `attractions` | `id` | `destinationId` | See §5. |
| `restaurants` | `id` | `destinationId` | See §5. |
| `accommodations` | `id` | `destinationId` | See §5. |
| `transport` | `id` | `destinationId` | See §5. |
| `costs` | `id` | `destinationId` | Standalone cost entries (`item`, `price`, `context`) not tied to a specific place. |
| `practicalInfo` | `id` | `destinationId` | See §5. |
| `weatherNotes` | `id` | `destinationId` | See §5. |
| `packingNotes` | `id` | `destinationId` | See §5. |
| `generalNotes` | `id` | `destinationId` | Free-form fallback (`title`, `content`). Minimal, unchanged since the original foundation build. |
| `shoppingItems` | `id` | `destinationId` | "What to buy" — see §5. |
| `shops` | `id` | `destinationId`, `shoppingItemId` | "Where to buy it" — child records of a `shoppingItems` entry. |
| `intakeDocuments` | `id` | `destinationId` | The raw pasted/extracted text of one import, preserved verbatim in full (never edited or truncated). |
| `candidates` | `id` | `intakeId`, `status`, `destinationId` | One row per extraction candidate — see §12. |
| `exchangeRates` | `id` (= `"FROM_TO"` pair string) | `pair` | Global, not per-destination — see §10. |

**IDs/UUID strategy:** `crypto.randomUUID()` throughout (`db/connection.js`'s `newId()` and inline `crypto.randomUUID()` calls in several stores/lib files). No sequential/auto-increment IDs anywhere.

**Common record shape (`db/shared.js`'s `commonMetadata()`):** every section record (all stores except `destinations`, `sources`, `intakeDocuments`, `candidates`, `exchangeRates`) shares `id, destinationId, priority, sourceIds, provenance, candidateId, createdAt, updatedAt, deletedAt`. `provenance` is `'manual'` or `'imported'`; `candidateId` links an imported record back to the candidate that produced it (`null` for manual records). Soft-delete only (`deletedAt` timestamp) — no hard-delete function exists in `crud.js` for section stores.

**Backward-compatibility / normalization helpers found in source:**
- `normalizeAttraction()` (`db/stores/attractions.js`) — reads an attraction record and fills the current-shape fields (`feeBands`, structured `openingHours`, `typicallySpent`, structured `bestTimeOfDay`) from older equivalents (`price`, string `openingHours`, `typicalDurationMinutes`, string `bestTimeOfDay`) when present, without deleting the old fields. Applied at list-read time in `AttractionsPage.jsx`.
- `normalizeWeatherNote()` (`db/stores/weatherNotes.js`) — if a stored `recommendation` value isn't one of the current controlled enum values, treats it as legacy free text and moves it into `recommendationNotes` instead, clearing the structured field.
- `normalizePackingNote()` (`db/stores/packingNotes.js`) — fills `category` (default `'Other'`), `checked` (default `false`), and reads the renamed `remarks` field from the older `notes` field name if present.

**No relational integrity enforcement:** IndexedDB stores have no foreign-key constraints. `destinationId`/`shoppingItemId` references are convention-only, upheld by application code, not the database.

---

## 5. Phase 1 Research System — per-section current shape

All ten fixed research sections plus Sources exist, wired into `src/sectionRegistry.js` (11 entries: attractions, restaurants, accommodations, transport, costs, practicalInfo, weatherNotes, packingNotes, shoppingItems, generalNotes, sources).

### Attractions — `db/stores/attractions.js`, `pages/sections/AttractionsPage.jsx`
IMPLEMENTED, verified in source:
- `place` (name/locality/city/country/lat/lng/googleMapsUrl).
- `category`: controlled dropdown — exact values (`lib/attractionOptions.js`): Sight / Viewpoint, Landmark, Museum, Temple, Garden / Park, Historical Monument, Activity / Experience, Beach / Natural attraction, Other.
- `feeBands`: array of `{id, label, minAge, maxAge, status, amount, currency}`. `status` ∈ `free | paid | nominal | unknown` (`lib/feeBands.js`'s `FEE_STATUS_OPTIONS`). Multiple bands supported; a single simple fee is just one band with no label.
- `cameraCharge`, `videographyCharge`: separate, optional `Money`-shaped fields (`{amount, currency, unit, note}` or `null`).
- `openingHours`: array of day-groups, each `{id, days: string[] | ['daily'], ranges: [{start, end}, ...]}` — supports multiple time ranges per group (split hours) and different day-groups for different schedules (`lib/openingHours.js`).
- `typicallySpent`: free-text string (e.g. "1-2 hours"), not numeric minutes.
- `bestTimeOfDay`: `{option, note}`. `option` is a controlled dropdown (`lib/attractionOptions.js`'s `BEST_TIME_OF_DAY_OPTIONS`: Early morning, Morning, Afternoon, Evening, Sunset, Night, Any time, Other), `note` free text.
- `description`: free-text Notes field (UI label is "Notes"; the underlying field key is still `description` — a deliberate choice to avoid a migration when the label was renamed).
- `priority`: via `commonMetadata`.

### Restaurants / Food — `db/stores/restaurants.js`, `pages/sections/RestaurantsPage.jsx`
IMPLEMENTED: dual-mode — `place` (nullable) for a specific restaurant, or `dishName` for a general food/dish note when `place` is null (`isPlaceBased()` helper distinguishes). `cuisine`, `price` (`Money`), `mustTryDishes: string[]`, `dietaryNotes`, `priority`. Price defaults to INR currency and a **controlled unit dropdown** (`lib/priceUnits.js`'s `RESTAURANT_PRICE_UNITS`: Per person, For 2 persons, For 3 persons, For 4 persons, Per dish, Per meal, Per item, Other), default unit `'For 2 persons'` — confirmed wired in `RestaurantsPage.jsx` via `MoneyField`'s `unitOptions`/`defaultUnit` props.

### Accommodation — `db/stores/accommodations.js`, `pages/sections/AccommodationsPage.jsx`
IMPLEMENTED: `place`, `accommodationType` — **controlled dropdown**, exact values (`lib/priceUnits.js`'s `ACCOMMODATION_TYPES`): Hotel / Resort, Homestay, Other. `price` (`Money`) with a **controlled price-basis dropdown** (`ACCOMMODATION_PRICE_BASIS`: Per room per night, Per person per night; default `'Per room per night'`). `roomType`, `checkIn`, `checkOut`, `amenityNotes`, `priority`. No "number of nights" field (deliberately — that belongs to future Trip Planning, not Research).

### Transport — `db/stores/transport.js`, `pages/sections/TransportPage.jsx`
IMPLEMENTED: `from`/`to` (`{label, place}` each), `mode` — **controlled dropdown** (`lib/priceUnits.js`'s `TRANSPORT_MODES`: Train, Bus, Flight, Shared cab, Private hired cab, Other). `price` (`Money`) with a controlled unit set (`TRANSPORT_PRICE_UNITS`: Per person, Per vehicle, Other) and a **mode-aware default** (`TRANSPORT_DEFAULT_UNIT_BY_MODE`: every mode defaults to "Per person" except "Private hired cab" → "Per vehicle") — confirmed the form auto-applies this default when the mode changes, without overwriting a value the person already entered. `duration`, `schedule`, `bookingNotes`, `priority`. **No intermediate-stops/multi-leg structure** — the store's own comments and the Phase 1 refinement instructions explicitly chose this: a multi-leg journey is represented as separate transport records, not one record with stops. **No passenger-count/cost-sharing field exists.**

### Practical Information — `db/stores/practicalInfo.js`, `pages/sections/PracticalInfoPage.jsx`
IMPLEMENTED: `topic` — **controlled dropdown**, exact values (`lib/practicalInfoOptions.js`): Visa, Passport, Permits, Connectivity, SIM, Internet, Safety, Emergency, Healthcare, Hospitals, Police, Embassy / Consulate, Money / ATM, Banking, Local transport, Language, Electricity, Customs, Local rules, Useful contacts, Other. Plus fully **optional** structured fields: `name, location, address, phone, email, website, googleMapsUrl`, and a `details` free-text field. The UI (`PracticalInfoPage.jsx`) hides the contact fields behind a "+ Add a specific contact" toggle by default, matching the "not every entry needs a contact" requirement.

### Weather — `db/stores/weatherNotes.js`, `pages/sections/WeatherPage.jsx`
IMPLEMENTED: `period` (free text — a dropdown of month names is offered in the UI as a quick-fill shortcut, but the stored field itself stays free text so ranges like "December–February" are fully supported, not forced into a single month). `temperatureMin`, `temperatureMax`, `temperatureUnit` (`C`/`F`). `rain` and `snow`: controlled dropdowns, exact values (`lib/weatherOptions.js`'s `WEATHER_PRECIPITATION_LEVELS`): **Rare, Moderate, Heavy** — default `'Rare'` for both, confirmed matching the spec exactly. `recommendation`: controlled dropdown (`WEATHER_RECOMMENDATIONS`): Excellent, Very good, Good, Bad, Must avoid (stored as `excellent | very_good | good | bad | must_avoid`). `recommendationNotes`: optional free text. `description`: free-text qualitative field.

### Packing / Preparation — `db/stores/packingNotes.js`, `pages/sections/PackingPage.jsx`
IMPLEMENTED as a categorized checklist. `category`: controlled dropdown (`lib/packingOptions.js`'s `PACKING_CATEGORIES`): Documents, Money, Clothing, Health, Electronics, Child / Family, Destination-specific, Other. A **preset catalog** (`PACKING_PRESETS`) offers common items per category as one-tap "+ Item" chips in an "Add" modal, alongside a free-text custom-item field. Each item record: `item, checked, essential, quantity, remarks`. The default list view is checkbox-only (`[ ] Item`, with an "Essential" tag if set) — **quantity and remarks are not shown beside every item**; they're only editable via a separate "Edit" modal per item, confirmed matching the "don't clutter the default view" requirement exactly.

### Shopping — `db/stores/shoppingItems.js` + `db/stores/shops.js`, `pages/ShoppingPage.jsx`
IMPLEMENTED as two linked stores, matching the "what to buy" + "where to buy it" concept:
- `shoppingItems`: `name, notes, priority`.
- `shops`: `shoppingItemId` (links to the parent item), `place` (full Place shape, so Google Maps works), `openingHours` (plain free text here — **not** the structured multi-period model attractions use), `notes`, `priceInfo` (free text), `priority`.
The UI (`ShoppingPage.jsx`) shows shopping items as expandable cards; expanding one lazily loads and lists its linked shops with an inline "+ Add a shop" action.

### General Notes — `db/stores/generalNotes.js`
Minimal, unchanged since the original foundation: `title` + `content` only. Explicitly the "doesn't fit anywhere else" fallback. No further structure was added during Phase 1.

### Sources & References
Not a separate data store beyond the pre-existing `sources` store; exposed as its own section in the registry/navigation, listed via `pages/SourcesPage.jsx`.

---

## 6. Currency system — cross-cutting (`db/currency.js`)

**IMPLEMENTED, verified in source:**
- `CORE_CURRENCIES = ['INR', 'USD']` — always available for every destination, enforced in code (`getCurrencyOptions()`), not by requiring the fact to be stored per-destination.
- `getCurrencyOptions(destination)`: returns `[...CORE_CURRENCIES, ...destination-specific extras]`, deduplicated, core currencies always first.
- `addDestinationCurrency(destinationId, code)`: normalizes to uppercase, no-ops if the code is already a core currency or already present, otherwise appends to the destination's `currencies` array via `updateDestination`.
- **Original amounts are never touched by currency logic.** Every `Money`-shaped field (`{amount, currency, unit, note}`) is written once by the person and only ever read back unchanged; nothing in `currency.js` or any store file mutates a stored `amount`/`currency`.
- `exchangeRates` store: one record per directional pair (`id`/`pair` = `"FROM_TO"`), `{from, to, rate, updatedAt}`.
- `setExchangeRate(from, to, rate)`: validates `rate > 0`, upserts by pair key.
- `getExchangeRate(from, to)`: returns `1` for same-currency, else looks up the direct pair, else derives the **inverse** from the reverse pair if that's what was recorded (`1 / reverseRate`), else returns `null` — **never a guessed/fabricated rate**.
- `convertAmount(amount, from, to)`: pure display-time calculation; returns `null` (not a guess) when no rate exists.
- UI: `pages/CurrencySettingsPage.jsx` — lets a person view a destination's available currencies, add a new one, set/update a rate for any two currencies in use, and preview a converted amount. Reachable from `DestinationDetail.jsx` via a "Currency settings" button.

**NOT IMPLEMENTED:**
- No automatic/online exchange-rate fetching — confirmed by source inspection, `setExchangeRate` is only ever called from the manual `CurrencySettingsPage.jsx` UI; there is no network call anywhere in `currency.js`.
- No Trip cost calculation / budget rollup of any kind — no code references summing costs across records.

---

## 7. PDF import and text extraction (`lib/pdfText.js`)

**Supported:** pasted plain text, pasted Markdown-ish text, and text-based PDFs with a selectable/embedded text layer.
**Explicitly NOT supported, confirmed in source:** scanned/image-only PDFs. **No OCR exists anywhere in the codebase** (confirmed — no OCR library dependency, no image-processing code).

**How it actually works:**
- `extractTextFromPdf(file)` dynamically `import()`s `pdfjs-dist` and its worker script (`pdfjs-dist/build/pdf.worker.mjs?url`) — not a top-level import, so `pdfjs-dist` (~427KB) is excluded from the app's initial bundle and only fetched when a PDF is actually uploaded (confirmed via `npm run build` output: `pdf-*.js` is a separate chunk from the main `index-*.js`).
- **Line reconstruction**: `reconstructLines(items)` rebuilds real lines from pdfjs's per-page `getTextContent()` output using each text item's `hasEOL` flag (true when a genuine line break follows in the source PDF). This directly replaces an earlier version that joined all of a page's text items with a plain space, which collapsed entire pages into one unbroken line — confirmed as the root cause of a real, previously-observed extraction failure (whole pages surfacing as one giant "candidate").
- **Repeated header/footer stripping**: `stripRepeatedPageBoilerplate(pageLines)` normalizes each line (digits → `#`) and removes any line that recurs on at least `max(3, ceil(pageCount * 0.4))` different pages, before the text is ever joined or handed to the extractor. Only applied when there are 3+ pages (a 1-2 page document is left untouched, since a short document's incidental repeated line is more likely to be real content).
- **Usability threshold**: `isTextUsable(text)` — the total extracted text must have at least `MIN_USABLE_TEXT_CHARS = 40` non-whitespace characters, or the PDF is rejected. This is what distinguishes a real text layer from the handful of stray characters a scanned page's incidental real-text objects (headers, page numbers) might produce.
- **User-facing rejection message** (`ScannedPdfError`, exact text from source): *"This PDF does not contain selectable text. Scanned/image-only PDFs are not supported."*
- **The PDF file itself is never stored.** Only the extracted text is passed into `createIntake()` — the same intake/candidate pipeline pasted text uses. Confirmed: no store, field, or code path anywhere writes PDF binary data to IndexedDB.

---

## 8. Extraction / import candidate system (`db/extraction.js`)

This is the most recently and substantially reworked area. **Verified from source, not from memory.**

**Pipeline:** `Document/pasted text → createIntake() → extractCandidates() → candidates (status: pending_review) → ReviewPage.jsx → explicit Accept/Edit/Reject per candidate → accepted candidates written via the same createX() function manual entry uses.**

**IMPLEMENTED safeguards, confirmed in source:**
- **A heading match alone never implies a candidate.** The extractor classifies every line as one of: heading, table header, table row, schedule/itinerary, document meta-commentary, narrative prose, or record — only "record" and "table row" ever produce a candidate.
- **Heading recognition**: conventional (`# Markdown`, short Title-Case phrase ≤6 words with no ending punctuation, or ending in `:`) plus PDF-style ALL CAPS lines (up to 140 chars). The riskiest branch (short, unpunctuated, Title-Case, no colon, not ALL CAPS) additionally requires the phrase to match a **recognized heading vocabulary** (`SECTION_KEYWORDS` + `NARRATIVE_HEADING_WORDS` + `ITINERARY_HEADING_WORDS`) — this specifically prevents a bare short record name (e.g. "Tiger Hill") from being swallowed as an unrecognized heading and producing nothing.
- **Narrative-vs-record classification** (`classifyLine`): uses several signals together — word count, sentence-ending punctuation count, narrative marker phrases ("this guide", "the author", "evolution of", etc.), and "strong record signals" (a recognized price/currency pattern, a rating pattern like `9.2/10`, a short-label-colon pattern like `"Address:"`, or table-delimiter structure). A line is treated as narrative (never a candidate) if it's long and/or multi-sentence and/or narrative-flavored, *unless* it also carries a strong record signal.
- **Table handling**: `splitTableRowCells()` recognizes pipe-delimited rows (≥3 cells) or, more loosely, runs of 2+ spaces yielding ≥3 cells. `looksLikeTableHeaderRow()` requires cells to collectively match **2 or more distinct column roles** (name/area/rating/price/note, via `COLUMN_ROLE_PATTERNS`) — this specifically fixes a confirmed bug where a data row whose own entity name happened to contain a column keyword (e.g. a hotel literally named "Hotel Seven Seventeen") was misdetected as a second header row and silently dropped. Each genuine data row becomes its own candidate; unmapped cell content is preserved in the section's Note field rather than discarded, never silently lost.
- **Currency-symbol price recognition**: the price regex matches word-based codes (`INR`, `USD`, ...) and symbol characters (`₹`, `$`, `€`, `£`) via separate alternatives — a confirmed prior bug meant a `\b` word-boundary anchor placed in front of the whole alternation could never match immediately before a symbol character, silently breaking all rupee-symbol price extraction (`₹2,800` would never be recognized). Fixed and covered by tests.
- **Schedule/itinerary filtering**: lines starting with a clock-time pattern (`08:00–09:30 ...`) or a bare time-of-day word followed by a colon (`Morning:`, `Lunch:`) are excluded entirely, regardless of whether they name a real place.
- **Document meta-commentary filtering**: explicit pattern list (`closing note`, `scheduling note`, `from the original document`, `original caveat`, `^note:`, `^disclaimer`, `^source:`, `this guide/document/itinerary is...`, etc.) excludes editorial/administrative text about the document itself.
- **Repeated page-footer filtering**: a defense-in-depth regex (`PAGE_FOOTER_PATTERN`) also runs inside the extractor itself, catching a "`| 17/33`"-style trailing page-number pattern even if it somehow survived `pdfText.js`'s own stripping (e.g. for pasted plain text that was manually copied page-by-page).
- **Unclassified fallback**: a line with strong record signals but no heading match produces a candidate with `proposedSection: null`, surfaced in the review UI under "Unclassified" rather than being guessed into the wrong section or discarded.
- **Review/accept/reject**: `db/stores/intake.js` — `acceptCandidate()` requires an explicit `section` and calls that section's real `create*()` function (so an imported record and a manually-typed record are structurally identical once saved); a candidate cannot be accepted twice; a rejected candidate can be reset back to `pending_review` (undo); an already-accepted candidate cannot be reset. Nothing is ever auto-accepted anywhere in the code path.

**AUTOMATED TEST VERIFICATION vs. REAL-WORLD VERIFICATION — important distinction:**
The automated suite (see §9) includes a specifically-constructed realistic multi-section fixture (narrative history paragraphs, a hotel table with 6 rows, bulleted attraction/restaurant/shopping lists, an itinerary day, a repeated page footer, and a closing meta-note, all combined in one document) and asserts exact candidate counts and content. This is a strong regression guard for the *specific class* of failure that was observed and fixed. **It is not a proof that the extractor handles arbitrary real-world PDF layouts correctly.** Real PDFs vary enormously in layout, font embedding, column structure, and text-object ordering; the heuristics here are pattern-based and can still misclassify content the automated fixture doesn't resemble. The user's own real Darjeeling PDF was the original source of the bug that prompted this rework, and while the specific failure mode observed then is now covered by tests, **broader real-world browser/PDF verification has not yet been performed by the user against the fix described in this document** (per the task instructions for this handover, no new real-world failure example had been supplied at the time this document was written).

---

## 9. Current test / build / lint status

Commands run in this sandbox, for inspection/reporting only (no code was changed as a result):

```
npm install     → up to date, no changes
npm test        → 48 passed, 0 failed   (src/db/__tests__/foundation.test.js)
npm run test:pdf → 7 passed, 0 failed   (src/db/__tests__/pdf.test.js, includes real binary-PDF fixtures)
npm run build   → succeeds; dist/assets/index-*.js ~338KB, pdf-*.js ~427KB (separate lazy chunk), pdf.worker-*.mjs ~2.2MB (separate, only fetched on PDF upload)
npx oxlint src/ → 0 errors, 3 warnings
```

The 3 warnings, confirmed exactly as expected:
1. `react/only-export-components` in `src/components/Place.jsx` (re-exports `buildGoogleMapsUrl`, a plain function, alongside a component).
2. `react/only-export-components` in `src/components/Money.jsx` (re-exports `formatMoney`, a plain function, alongside components).
3. A React `set-state-in-effect` advisory note in `src/pages/ReviewPage.jsx` (a `useEffect`-triggered data-load pattern used consistently elsewhere in the app too).

These are pre-existing, accepted as non-blocking, and were **not modified** during this handover — per instructions, this document reports them, it does not fix them.

The test suite uses `fake-indexeddb` (real IndexedDB semantics in Node, no mocking of the actual store logic) for `foundation.test.js`, and `pdfjs-dist`'s Node-compatible legacy build against real (minimal, hand-constructed) PDF binary fixtures for `pdf.test.js` — both are genuine runtime tests of the real application code, not unit tests against a re-implementation.

---

## 10. Current git / deployment context

**This sandbox's local git state** (verified directly, not assumed):
```
Branch: main
Working tree: clean (no uncommitted changes)
git log --oneline -3:
  1aaa72d  Fix PDF/text candidate extraction: real line reconstruction, table splitting, record-vs-narrative classification
  b9a0236  Complete Phase 1 research system refinement
  b7f164d  Rebuild Dossier from scratch
Ahead of 'origin/main' by 2 commits (never pushed from this sandbox)
```

Per the established workflow, the user takes the ZIP from each Claude sandbox session and applies it into their own persistent project directory (`~/dossier-new`), where they run their own `git add`/`commit`/`push`. **The commit hashes in the user's real repository will differ from this sandbox's local hashes** shown above — this is expected, not an error, since the sandbox's git history is independent of the user's actual repository history. The user's stated most-recently-deployed commits are `2fd7494` ("Fix PDF and text extraction") and, before it, `c5bbc7b` ("Complete Phase 1 research system refinement") — these are the user's real repository's hashes and should be treated as the authoritative record of what's actually deployed; this sandbox cannot independently confirm them.

**Established workflow** (do not deviate from this without being asked):
```
Claude sandbox implementation → ZIP → user replaces contents of the EXISTING
~/dossier-new directory (preserving .git) → npm install/test/test:pdf/build/lint
→ git add/commit → git push origin main → Cloudflare deployment → real
browser/device testing
```
Do not instruct the user to create a new project directory. Do not push from the sandbox. Do not assume access to the user's local filesystem, GitHub account, or Cloudflare deployment.

---

## 11. Exact current stopping point

Completed and (per the user) deployed:
- Full Phase 1 Research System Refinement across all 9 structured sections + Shopping (new) + the cross-cutting currency system — all verified present and wired in source, per §5–6.
- The PDF/text extraction rework — verified present and wired in source, per §7–8.
- Local verification before the user's deployment: dependency install, `npm test`, `npm run test:pdf`, `npm run build`, `npx oxlint` all passed with only the 3 known non-blocking warnings.

**Not yet done:** real-world browser/device verification of the extraction fix against arbitrary real documents beyond the automated regression fixture (see §8's distinction). The user's plan, per their own stated intent, is to now perform that real-world testing — **this is not automatically a cue to start another development phase.** If real-world testing surfaces a new, specific problem, that becomes the next task; nothing in the current source suggests a further unresolved *known* issue beyond what's listed in §12.

---

## 12. Known limitations / risks (from source inspection, not speculation)

- **Real-world PDF layout variability**: the extraction heuristics (heading/table/narrative classification) are pattern-based, tuned against one realistic constructed fixture plus the specific bug pattern that was observed and fixed. Different document layouts, fonts, or table structures may not be handled as well — genuinely unverified against arbitrary real documents.
- **Table extraction is not "heroic"**: by design, ambiguous table-like content without a recognizable header falls back to "name = first cell, price = first price-like cell, rest = note" rather than attempting full column reconstruction — acceptable data preservation, but not precise field mapping.
- **No OCR, no scanned-document support** — by design, confirmed, not a gap to close casually.
- **No automatic exchange-rate fetching** — rates are entered manually only; confirmed no network code exists for this.
- **No Trip cost calculation** — the currency system is designed to be reusable by a future Trip Planning feature, but no such feature or calculation code exists yet.
- **3 existing, accepted lint warnings** (§9) — cosmetic/advisory, not fixed by design per this handover's instructions, and not previously treated as blocking.
- **No relational integrity enforcement** at the database level (§4) — a dangling `destinationId`/`shoppingItemId` reference is possible if application code has a bug; nothing at the IndexedDB level would catch it.
- **`shops.openingHours` is plain free text**, not the structured multi-period model `attractions.openingHours` uses — an intentional smaller scope for a newer, simpler section, but worth knowing if asked to make Shopping's opening-hours support richer later.
- **`AttractionsPage.jsx`'s `description` field is internally still named `description`** even though its UI label was changed to "Notes" — a deliberate choice to avoid a migration, but a point of naming confusion for anyone reading the store code without this context.
- **No browser/device testing performed in this sandbox** (no browser is available here) — all verification in §9 is build/lint/Node-test-level, not actual UI interaction.

---

## 13. What the next Claude must do first

Per the handover instructions this document was written under, the next conversation's first task is to **audit, not build**:
1. Inspect `dossier-handover.zip` and this document together.
2. Read the actual source code directly — do not trust this document blindly.
3. Verify this document's claims against the source (schema, extraction logic, test counts, etc.).
4. Identify any discrepancies and report them.
5. Give the user a concise audit, then **stop and wait for instruction** — do not start coding, fixing, refactoring, committing, or deploying until explicitly told to.

The ZIP/source code is authoritative if anything here turns out to be wrong or has drifted.

---

## 14. Phase 1 update — Locations, Universal Quick Add, Progressive Disclosure

Since §1–13 above were written, a Phase 1 implementation cycle was completed on top of this exact baseline, driven by a clarified product direction: Dossier is a personal, long-term travel knowledge archive where **direct quick capture is the primary workflow** and PDF/document import is a secondary convenience. A full multi-session product/architecture discussion preceded this work; the long-term direction (multi-device sync via a shared backend, Google Drive backup, Google Maps/Places assistance) was **discussed but deliberately NOT implemented** — Phase 1 stayed scoped to what was explicitly authorized: Locations, universal Quick Add, quick capture, and progressive disclosure, all still on the existing single-browser IndexedDB architecture.

**What changed, additively:**

- **`DB_VERSION` is now 3** (was 2). A new `locations` store was added — a flexible sub-destination entity (`id`, `destinationId`, `name`, optional `lat`/`lng`), deliberately not called "cities" since it can represent a city, town, island, region, or any other meaningful subdivision. The v2→v3 upgrade follows the exact same additive "create store if missing" pattern as v1→v2 — confirmed by a dedicated test that seeds a real v2 database (including a record with no `locationId` key at all) and verifies it opens and reads correctly under v3 code.
- **Every research record gained an optional `locationId`** via `commonMetadata()` (default `null` = destination-wide). No individual section store file (`attractions.js`, `restaurants.js`, etc.) needed to change — they already spread `...fields` after `commonMetadata()`, so this flowed through automatically. `sources.js` was the one exception, since it builds its metadata by hand rather than via `commonMetadata()`.
- **A universal "+ Add to Dossier" entry point** now exists (`src/components/QuickAdd.jsx`), reachable globally — a sidebar button on desktop, a floating action button on mobile, both wired in `AppShell.jsx`. Flow: pick a type (one of the 10 addable record types) → pick a destination (+ location, only offered if that destination has any) → a minimal 2-field form → save. This is driven by a new config file, `src/quickAddRegistry.js`, which maps each type to the **exact same `create*` function** its full section page already calls — a quick-captured record is indistinguishable from a fully-filled one, mirroring the precedent `db/stores/intake.js`'s existing `CREATORS` map already set for imported records.
- **Progressive disclosure** was retrofitted onto the section forms that were genuinely large: Attractions, Accommodations, Restaurants, Transport, Weather, and Practical Info. A new shared component, `src/components/Disclosure.jsx` (native `<details>`/`<summary>`, no extra React state), wraps each form's secondary fields behind an "Add more details" toggle. `defaultOpen` is computed from whether the record being edited already has data in those fields — an already-detailed record is never shown artificially collapsed. Forms that were already minimal (Costs, General Notes, Sources, both Shopping forms, both Packing forms) were deliberately left unchanged — wrapping them would have added friction, not removed it. Practical Info's own pre-existing bespoke "show contact fields" toggle was consolidated onto the new shared `Disclosure` component rather than left as a second parallel implementation of the same idea.

**Explicitly NOT done in Phase 1** (by design, per explicit instruction): no PowerSync, no Postgres, no backend, no authentication, no synchronization, no Google Drive backup, no Google Maps/Places API integration. The existing Maps URL functionality (`lib/googleMaps.js`) is untouched. The IndexedDB persistence layer, PDF extraction pipeline, candidate review flow, and currency system are all untouched and still work exactly as described in §1–13 above.

**Verification performed at the end of Phase 1** (all Node/build/lint-level — no browser available in that sandbox either):
- `npm test`: **56/56 passed** (48 original + 8 new, covering Locations CRUD/validation, destination-wide vs. location-specific coexistence, a destination with no locations continuing to work unmodified, and the v2→v3 upgrade test described above).
- `npm run test:pdf`: **7/7 passed**, unchanged — Phase 1 did not touch the extraction pipeline.
- `npm run build`: passed cleanly.
- `npx oxlint src/`: **0 errors**, exactly the **same 3 pre-existing warnings** as the §9 baseline (`ReviewPage.jsx:46:21`, `Place.jsx:5:10`, `Money.jsx:98:17`) — no new warnings.

**Known Phase 1 limitation, noted deliberately rather than silently:** `deleteLocation()` does not reassign or clear the `locationId` on records that reference a deleted location, so a dangling reference is possible. This was a conscious minimal-first-pass decision, not an oversight — worth revisiting once Locations sees real use.

**Not yet done:** real browser/device testing of the Quick Add flow, the floating action button's placement on real screens, and the `<details>`-based Disclosure component's feel in practice. As with the PDF work in §11, this is the natural next step per the user's own stated intent — **not automatically a cue to start Phase 2.**

---

## 15. Phase 2 update — Locations UI, Journeys, Restaurant/Dish split, destination currency, OSM place lookup

This section supersedes any earlier draft/interim state described in prior handover edits (an earlier attempt at "journey" support used a synthetic `journey:<fromId>:<toId>` string stuffed into `locationId`, and an earlier draft of the Restaurant/Dish split changed `restaurants.js`'s `place` default from `null` to `emptyPlace()` — **both were reverted** during this phase before the final design below was implemented. If anything here conflicts with an earlier section of this document, this section is authoritative.)

**Current `DB_VERSION` is 5.** Full store list: `destinations`, `locations`, `journeys`, `sources`, `attractions`, `restaurants`, `dishes`, `accommodations`, `transport`, `costs`, `practicalInfo`, `weatherNotes`, `packingNotes`, `generalNotes`, `shoppingItems`, `shops`, `exchangeRates`, `intakeDocuments`, `candidates`. Every version bump (2→3 locations, 3→4 dishes, 4→5 journeys) followed the same additive "create store if missing" `onupgradeneeded` pattern established in Phase 1 — no store has ever been dropped or renamed, no existing field has been removed.

### Location model
Unchanged from Phase 1: `db/stores/locations.js`, a flexible sub-destination entity (city/town/island/etc, deliberately not called "City" in the schema). New this phase: a real, user-facing management UI — `DestinationDetail.jsx`'s `LocationsPanel` (add/rename/delete via inline chips, no hidden technical workflow required). Selecting a location sets `?location=<id>` in the URL, which every location-aware section page (Attractions, Accommodations, Transport, Dishes) reads to scope its list and pre-fill new records' `locationId` — see "Context-aware Add" below.

### Journey model (Option C — a proper separate entity)
`db/stores/journeys.js`: `{ id, destinationId, fromLocationId, toLocationId, notes, ...metadata }`. A journey represents travel between two **already-existing** locations (validated: both endpoints required, same-city rejected). This is **not** encoded via `locationId` — `locationId` on every record means only a real location id or `null`, never a synthetic value. A record that wants "along this journey" context instead carries a separate, optional `journeyId` field, added only to the shape of sections where it's genuinely useful: currently **Attractions and Transport only** — not injected into `commonMetadata()` or any other section. Deleting a location explicitly retires (soft-deletes) any journeys that reference it, via `retireJourneysUsingLocation()`, rather than leaving a dangling reference; renaming a location requires no action since journeys reference it by id and resolve the current name at display time (`describeJourney()`).

### Restaurant ↔ Dish relationship
Two separate entities. `restaurants.js` is **unchanged in shape from Phase 1** — `place` still defaults to `null` (a restaurant record can be place-based or, for backward compatibility with pre-Dishes-era records, a dish-only free-text note via `dishName`). `dishes.js` is new: an independent food item (`name`, `cuisine`, `price`, `notes`, `restaurantIds: []`). The relationship is many-to-many, with `dish.restaurantIds` as the single source of truth (`linkDishToRestaurant`/`unlinkDishFromRestaurant`, idempotent — linking twice doesn't duplicate). Both directions are visible in the UI: `RestaurantsPage.jsx` shows "Recommended dishes: ..." (clickable, navigating to the Dishes section) with a checkbox-based linking UI in the edit form; `DishesPage.jsx` shows "Try at: ..." (clickable, navigating to Restaurants) with its own restaurant-picker at creation time. Dishes is fully wired into routing, `sectionRegistry.js`, `quickAddRegistry.js`, and the PDF import/review pipeline (`CREATORS.dishes`, `ReviewPage.jsx`'s `case 'dishes'` field editor, `extraction.js`'s `dishes: 'notes'` field mapping).

### Destination default currency
`destinations.js` gained an additive `defaultCurrency` field (defaults `'INR'` — a destination saved before this field existed simply has no key, read as `'INR'` via `getDestinationDefaultCurrency()`). Choosable at destination creation (`ResearchHome.jsx`'s `CreateDestinationModal`, INR/USD/custom-code options) and changeable afterward (`CurrencySettingsPage.jsx`, now with a dedicated default-currency selector — this was a real gap fixed this phase; the page previously only handled adding currencies and exchange rates). Changing the default **only** affects the pre-fill for new/empty `MoneyField`/`FeeBandsField` instances going forward — every existing stored `price.currency` or fee-band `currency` is untouched permanently, verified by dedicated tests. `getCurrencyOptions()` always includes INR and USD regardless of what's chosen; choosing a non-core default (e.g. KGS for Kyrgyzstan) automatically adds it to the destination's usable currency list (a real bug found and fixed this phase — it previously wasn't). Exchange rates remain USD-based (`1 USD = X INR`, etc.), fully independent of the default-currency setting, editable at any time via `CurrencySettingsPage.jsx`, and never rewrite historical amounts — `convertAmount()` is a pure, non-destructive read-time calculation.

### Transport: local vs. inter-city
`transport.js` gained an additive `travelType` field (`'inter_city'` | `'local'`, defaulting to `'inter_city'` for any pre-existing record with no such key — they necessarily have real from/to values already). Local transport (e.g. "Phuket tuk-tuks," "Bangkok BTS") does not require `from`/`to` at all and is instead scoped via the normal `locationId` mechanism; inter-city transport still validates both endpoints. `journeyId` is available on transport records independently of `travelType`, for linking a specific inter-city option to a previously-defined Journey.

### "Other" fields
Every genuinely selectable "Other" option in the app now reveals a "please specify" field via the shared `OtherSelect` component, and the value is preserved in a dedicated `*Other` field (never conflated with the controlled value): `category`/`categoryOther` (Attractions), `bestTimeOfDay`/note (Attractions), `accommodationType`/`accommodationTypeOther` (Accommodations — fixed this phase, was previously a bare select with no explanation field), `mode`/`modeOther` (Transport — same bug, same fix), `topic`/`topicOther` (Practical Info — same bug, same fix). `MoneyField`'s own pre-existing "Other" unit escape hatch was left as-is (already correct). Packing's "Other" category heading was deliberately **not** touched — it's a fixed section label to add items under, not a dropdown value needing an explanation field.

### Context-aware Add / hierarchy
The settled hierarchy is Destination → Location/City → research item, with three possible scopes for any record: destination-wide (`locationId: null`), a specific location (`locationId` set), or along a journey (`journeyId` set, only on Attractions/Transport). Opening a section page from inside a selected location (`?location=` in the URL) pre-fills new records with that location, shown as a locked, non-re-askable display — but with an explicit "Change" affordance (added this phase after tracing the actual flow revealed there was previously no escape hatch) so the person can still switch to another location or make the entry destination-wide.

### Costs retirement
The `costs` store, its CRUD functions (`createCostEntry` etc.), and any previously-saved records remain **fully intact** in the database — this is a UI-level retirement only, not a data deletion. Removed from: `sectionRegistry.js` (no navigation entry), `quickAddRegistry.js` (no Quick Add entry), `App.jsx` (no route), `db/extraction.js`'s classification keywords (text that would previously have triggered a "costs" guess now classifies as `practicalInfo` instead, per "miscellaneous practical expenses" guidance), and — found and fixed this phase — `db/stores/intake.js`'s `CREATORS` map (previously still had a working `costs` entry, meaning `acceptCandidate()` could theoretically still create a Cost record if called directly with `section: 'costs'`, bypassing `ReviewPage.jsx`'s own dropdown discipline; now `acceptCandidate` itself rejects `'costs'` as an invalid section). Verified end-to-end with dedicated regression tests: extraction can never propose `'costs'` (traced — it's not in the keyword table), and `acceptCandidate` explicitly refuses it even if forced.

### OSM/Nominatim place lookup
New reusable module `src/lib/placeLookup.js` (pure, network-mockable) plus UI component `src/components/PlaceLookup.jsx`, wired into the single shared `PlaceField` component (`components/Place.jsx`) used by every place-based section (Attractions, Accommodations, Restaurants) — no per-page duplication.

- **Explicit trigger only**: a "🔍 Find Place" button; there is no search-on-keystroke anywhere in this implementation.
- **Contextual query**: `<name>, <city/location>, <destination/country>` (blank parts omitted) — the exact same string is used for both the Nominatim search and the "Open in Google Maps" hand-off, so the two are always searching for the same thing.
- **Nominatim request**: public `nominatim.openstreetmap.org/search` endpoint, `format=jsonv2&addressdetails=1&limit=5`, an 8-second timeout via `AbortController`, and a same-session throttle (minimum ~1.2s between calls) as a courtesy floor beyond "human-triggered only."
- **Ranking**: weighted combination of name similarity (dominant), current-location match, destination/country match, category plausibility (a small OSM-class hint table, `CATEGORY_HINTS`), and Nominatim's own `importance` score as the smallest-weighted, secondary tiebreaker. **No review counts, ratings, or popularity data are used or fabricated anywhere** — Nominatim/OSM has none of that data, and this is stated plainly in both the code comments and the UI copy shown to the person during a lookup.
- **Candidate UI**: up to 5 ranked candidates shown with name + address, top one visually pre-selected but any can be chosen, plus an explicit "None of these / keep my manual entry" option.
- **Failure handling**: a failed, empty, timed-out, offline, or malformed-response lookup **never blocks saving** — it degrades to leaving the existing manual place fields exactly as they were. Every distinct failure mode (network error, non-2xx, malformed JSON, non-array body, timeout) is handled and tested separately.
- **Local cache**: confirms-only (never raw search results) — a person explicitly confirming a candidate is cached by exact name+context so reopening the same record doesn't require a redundant network call; failing to read/write the cache (e.g. no `localStorage` available) never throws and never blocks the flow.
- **Google Maps hand-off**: unchanged from Phase 1's `buildGoogleMapsUrl()` — a plain search-URL link, opened in a new tab, for the person to manually check reviews/ratings/photos themselves. Dossier does not scrape or import any of that data.
- **Tested with 26 dedicated, fully-mocked tests** (`src/db/__tests__/placeLookup.test.js`, run via `npm run test:place-lookup`) covering query construction, name-similarity scoring, ranking under every signal individually, and every `lookupPlace()` outcome (success, zero-results, network failure, non-2xx, malformed JSON, non-array body, timeout, blank-name short-circuit, throttling) plus the confirmed-result cache — **none of these tests touch the live Nominatim service.**

### Known limitations, stated plainly
- Nominatim/OpenStreetMap has **no review counts, star ratings, or popularity data** — ranking here is name/location/category/importance-based only. There is no way to reproduce Google's review-count signal without a paid API, which was explicitly ruled out for this phase.
- The OSM lookup **requires network access**; manual place entry (name/locality/city/Google Maps link, all free text) remains fully functional offline, exactly as in Phase 1 — nothing about this feature is required to save a research record.
- Exchange rates are entirely user-entered and user-maintained; Dossier does not fetch or verify real-world rates. A rate left unset simply means no converted-amount display is shown for that currency pair — the original stored amount and currency are never affected either way.
- `deleteLocation()` still does not reassign the `locationId` on ordinary research records that reference it (only journeys are handled explicitly, per this phase's requirement) — a dangling reference remains possible for a plain record; unchanged limitation from Phase 1, noted again here for completeness.
- There is still no `.git` repository in this working tree, at any point in this project's history in this environment — confirmed directly (`git status` → "not a git repository") each time it's been checked, including at the end of this phase.

### Final verification for this phase
- `npm test`: **97/97 passed** (up from Phase 1's 56 — 41 new tests across Locations UI consistency, Journeys, Dishes, Restaurant↔Dish relationships, destination currency defaults/changes, local/inter-city Transport, "Other" fields, Costs/Dishes import-pipeline regression, and the v4→v5 and full v1→v5 migration chains).
- `npm run test:pdf`: **7/7 passed**, unchanged.
- `npm run test:place-lookup`: **26/26 passed**, all against a mocked `fetchImpl` — no live network dependency in the test suite.
- `npm run build`: passed cleanly.
- `npx oxlint src/`: **0 errors**, exactly the **same 3 pre-existing warnings** as every prior baseline (`ReviewPage.jsx:46:21`, `Place.jsx:5:10`, `Money.jsx:98:17`) — no new warnings introduced despite the substantial amount of new code this phase.

**Not yet done / explicitly deferred, per standing instruction**: no PowerSync, Postgres, backend, authentication, or desktop↔cloud↔mobile synchronization work of any kind — the persistence layer remains local-only IndexedDB, exactly as it has been since Phase 1. No Google Drive backup integration. No paid place-lookup API. Real browser/device testing of everything in this section (as opposed to code-path tracing and automated tests, both of which were done thoroughly) remains outstanding, same as it has been every phase — this sandbox has no browser to test in.
