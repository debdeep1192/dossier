-- ============================================================
-- Personal Travel Application — Initial Schema
-- Implements the frozen architecture (Section 72 base + 75/76 deltas)
-- Phase 1 build focuses on: owner_account, app_settings,
-- family_weight_presets, and the full Research scope.
-- Trip-scope tables are created now (schema is frozen as a whole)
-- but are not exercised by any Phase 1 feature/UI.
-- ============================================================

-- Note: gen_random_uuid() is available in Postgres core (13+) without
-- requiring the pgcrypto extension to be separately installed.

-- Note: a `schema_migrations` bookkeeping table is created and managed
-- by db/index.js (ensureSchema), not here — see db/migrations.js for the
-- versioned migration steps that bring a pre-existing local database up
-- to the shape defined below without losing data.

-- ============================================================
-- SCOPE 1: USER / GLOBAL
-- ============================================================

CREATE TABLE owner_account (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- email/password_hash: retained from the original server-auth design
  -- but relaxed to nullable, per the approved local-first architecture
  -- (no server, no login, no password). Unused by the local first-run
  -- profile flow. Kept rather than dropped in case a future feature
  -- (e.g. cloud sync auth) finds a genuine use for them; never populated
  -- by the current application code.
  email TEXT UNIQUE,
  password_hash TEXT,
  -- display_name: NOT part of the frozen Section 72 schema. Added during
  -- Phase 1 implementation as a non-breaking, nullable, additive column
  -- (a name to show in the UI instead of a raw email address). It has no
  -- effect on any other table, relationship, or invariant established in
  -- the frozen architecture. Flagged explicitly per implementation
  -- discipline rather than silently included. Remove this comment block
  -- and the column if this is not wanted; no other code depends on it
  -- beyond the setup form and the More/Account page.
  display_name TEXT,
  -- home_currency: the user's home/reporting currency for budgeting and
  -- display conversion (e.g. "≈ ₹X,XXX" next to a foreign-currency
  -- price). ISO 4217-style code, free text rather than a FK/enum so any
  -- currency works without special-case code. Defaults to INR per the
  -- current intended home currency; changeable later without migrating
  -- any research data, since research prices always store their own
  -- original currency independently (see research_items.price).
  home_currency TEXT NOT NULL DEFAULT 'INR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE family_weight_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  weight NUMERIC(5,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  default_child_weight NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  default_child_age_threshold INTEGER NOT NULL DEFAULT 12,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- SCOPE 2: RESEARCH (evolving knowledge — Phase 1 core)
-- ============================================================

CREATE TABLE destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  overview TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id UUID NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (destination_id, name)
);

-- item_kind: a small, intuitive set of what a traveller actually thinks
-- in terms of, not an exhaustive taxonomy. Notes on choices that aren't
-- self-evident:
--   - 'accommodation' replaces 'hotel' — covers guesthouses/homestays/
--     hostels too, not just hotels.
--   - 'activity' is distinct from 'attraction': an attraction is a place
--     you go see (a fort, a viewpoint); an activity is a thing you do
--     (a cooking class, a trek, a boat ride) that may not have a single
--     fixed location the way an attraction does. Genuinely different
--     enough in how a traveller researches and plans around them to be
--     worth separating, without multiplying into finer categories.
--   - 'food' is distinct from 'restaurant': a specific restaurant is a
--     place; "try the seafood" or "the hoppers here are famous" is
--     knowledge about a dish/cuisine, not a place record, and doesn't
--     fit naturally as a restaurant with no address.
--   - 'transport' replaces 'transport_option' — same concept, shorter.
--   - 'practical_info' and 'note' unchanged — general destination
--     knowledge that isn't about one specific place/thing.
CREATE TABLE research_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id UUID NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  section_id UUID REFERENCES sections(id) ON DELETE RESTRICT, -- nullable: destination-level notes
  item_kind TEXT NOT NULL CHECK (item_kind IN
      ('attraction','activity','restaurant','food','accommodation','transport','practical_info','note')),
  title TEXT NOT NULL,
  priority TEXT CHECK (priority IN ('must_know','useful','optional','reference')),
  content TEXT,

  -- ---- Core structured fields (common across most item kinds) ----
  -- price: {amount, currency, unit, note} JSONB, replacing the old
  -- entry_fee/price_range free-text pair. Preserves the ORIGINAL amount
  -- and currency exactly as researched — never overwritten with a home-
  -- currency conversion, per the local-first / data-fidelity principle.
  -- unit is free text (e.g. "per person", "per night", "for two") since
  -- travel pricing units vary too much to enumerate. Conversion to the
  -- user's home currency (owner_account.home_currency) is a derived
  -- display/budget concern computed later, never stored here.
  -- Example: {"amount": 1500, "currency": "LKR", "unit": "per person"}
  price JSONB,
  opening_hours TEXT, -- kept free text deliberately; see note below
  visit_duration_minutes INTEGER,
  area_location TEXT,
  maps_url TEXT,
  last_verified_at TIMESTAMPTZ,

  -- ---- Type-specific information ----
  -- Only a handful of facts are genuinely specific to one item_kind
  -- (e.g. cuisine for a restaurant, room type for accommodation). Rather
  -- than adding a flat column per kind (restaurant_cuisine,
  -- hotel_room_type, ...), which is exactly the "giant nullable table"
  -- this schema deliberately avoids, those live in this single JSONB
  -- bucket, shaped differently per item_kind. Kept small and genuinely
  -- optional — most items will have this empty or absent. The
  -- boundary: if a fact is common to 3+ kinds, it's a real column
  -- above; if it's specific to 1-2 kinds, it goes here.
  details JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
  -- Application rule: research_items are never hard-deleted in V1, only soft-deleted.
);
-- Note on opening_hours remaining free text: real-world hours are
-- genuinely irregular (weekly patterns, seasonal closures, "closed on
-- poya days", exceptions) — structuring this properly needs its own
-- small data model (a weekly grid + an exceptions list), which is a
-- real, scoped piece of future work, not something to half-build as a
-- rigid JSONB shape here that would need redesigning again once the
-- edge cases show up. Free text is the honest choice for now.

CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL UNIQUE
);

CREATE TABLE research_item_tags (
  research_item_id UUID NOT NULL REFERENCES research_items(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (research_item_id, tag_id)
);

CREATE TABLE sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  research_item_id UUID NOT NULL REFERENCES research_items(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  source_type TEXT CHECK (source_type IN ('website','youtube','other')),
  supports_note TEXT,
  accessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE research_item_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_a_id UUID NOT NULL REFERENCES research_items(id) ON DELETE CASCADE,
  item_b_id UUID NOT NULL REFERENCES research_items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_a_id, item_b_id),
  CHECK (item_a_id <> item_b_id)
);

-- research_intake / research_candidates: the document-ingestion pipeline.
-- RAW INPUT -> PARSER -> CANDIDATES -> REVIEW -> CONFIRMED RECORDS.
-- The parser is never the source of truth: it only ever produces rows
-- here, which the user reviews (accept/edit/reject) before anything is
-- written to research_items. This mirrors the same
-- pending_review/applied/discarded status pattern already established
-- for parsed_itinerary_drafts (Trip scope) — same idea, applied at
-- Research/fact granularity instead of one whole-document blob, since
-- Research needs to accept some candidates from a document and reject
-- others individually.
CREATE TABLE research_intake (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id UUID NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  -- The original, unmodified input is always preserved here, regardless
  -- of what the parser made of it or what the user later did with the
  -- candidates — satisfies "never destroy information simply because
  -- the parser could not understand it."
  raw_text TEXT NOT NULL,
  source_label TEXT, -- e.g. a filename, article title, or URL the text was pasted from
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE research_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id UUID NOT NULL REFERENCES research_intake(id) ON DELETE CASCADE,
  -- Proposed fields, in the same shape research_items will eventually
  -- use, so accepting a candidate is a straightforward copy rather than
  -- a reshaping step. All nullable: the parser may only be confident
  -- about some fields, and the user fills in the rest during review.
  proposed_item_kind TEXT CHECK (proposed_item_kind IN
      ('attraction','activity','restaurant','food','accommodation','transport','practical_info','note')),
  proposed_title TEXT,
  proposed_content TEXT,
  proposed_price JSONB,
  -- The exact excerpt of raw_text this candidate was derived from —
  -- lets the review UI show "here's the sentence this came from" for
  -- context and trust, without re-parsing.
  source_excerpt TEXT,
  -- Free-text note from the extraction adapter about this candidate's
  -- state (e.g. "not yet classified"). Deliberately not a numeric
  -- confidence score — the shipped adapter doesn't attempt
  -- classification at all (see db/extraction/index.js), so a fake-
  -- precise probability would be misleading; a plain note is honest
  -- about what review is still needed.
  uncertainty_note TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review'
      CHECK (status IN ('pending_review','accepted','rejected')),
  -- Set once the user accepts this candidate and it becomes a real
  -- research_items row — keeps the provenance link (this fact came from
  -- this document) available after acceptance, rather than losing it.
  resulting_item_id UUID REFERENCES research_items(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- SCOPE 3: TRIP (schema frozen now; not exercised until Phase 2+)
-- ============================================================

CREATE TABLE trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planning','upcoming','active','completed')),
  itinerary_status TEXT NOT NULL DEFAULT 'draft'
      CHECK (itinerary_status IN ('draft','confirmed','changed')),
  itinerary_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE trip_destinations (
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES destinations(id) ON DELETE RESTRICT,
  PRIMARY KEY (trip_id, destination_id)
);

CREATE TABLE itinerary_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL,
  day_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trip_id, day_number)
);

CREATE TABLE trip_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  itinerary_day_id UUID NOT NULL REFERENCES itinerary_days(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  activity_type TEXT NOT NULL CHECK (activity_type IN
      ('travel','accommodation','attraction','restaurant_meal','activity','free_time','other')),
  status TEXT NOT NULL DEFAULT 'planned'
      CHECK (status IN ('planned','completed','skipped','rescheduled')),
  title TEXT NOT NULL,
  scheduled_time TIME,
  notes TEXT,
  snapshot_description TEXT,
  snapshot_entry_fee TEXT,
  snapshot_opening_hours TEXT,
  snapshot_visit_duration_minutes INTEGER,
  snapshot_dress_code TEXT,
  snapshot_photography_rules TEXT,
  snapshot_warnings TEXT,
  snapshot_dont_miss TEXT,
  maps_url TEXT,
  source_research_item_id UUID REFERENCES research_items(id) ON DELETE SET NULL,
  changed_since_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
  entity_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE parsed_itinerary_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  raw_input_text TEXT NOT NULL,
  parsed_result JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review'
      CHECK (status IN ('pending_review','applied','discarded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  weight NUMERIC(5,2) NOT NULL DEFAULT 1.0,
  entity_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE family_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  date_of_birth DATE,
  age_at_trip_time INTEGER,
  entity_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (date_of_birth IS NOT NULL OR age_at_trip_time IS NOT NULL)
);

CREATE TABLE trip_logistics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL UNIQUE REFERENCES trips(id) ON DELETE CASCADE,
  rooms_required INTEGER,
  extra_beds INTEGER,
  vehicle_type TEXT,
  vehicle_count INTEGER,
  vehicle_capacity INTEGER,
  driver_required BOOLEAN,
  luggage_notes TEXT,
  transfer_notes TEXT,
  entity_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE budget_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  cost_basis TEXT NOT NULL CHECK (cost_basis IN
      ('per_room_night','per_vehicle_day','per_extra_bed','per_adult','per_child',
       'per_person_day','fixed','custom')),
  unit_cost NUMERIC(12,2) NOT NULL,
  quantity NUMERIC(10,2) NOT NULL,
  quantity_source TEXT NOT NULL DEFAULT 'manual' CHECK (quantity_source IN
      ('manual','logistics_rooms','logistics_vehicles','logistics_extra_beds',
       'family_members_adults','family_members_children')),
  child_weight_used NUMERIC(4,2),
  age_threshold_used INTEGER,
  computed_total NUMERIC(12,2) NOT NULL,
  manual_total_override NUMERIC(12,2),
  entity_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE budget_line_families (
  budget_line_id UUID NOT NULL REFERENCES budget_lines(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  PRIMARY KEY (budget_line_id, family_id)
);

CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  budget_line_id UUID REFERENCES budget_lines(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL,
  conversion_rate NUMERIC(12,6),
  home_currency_amount NUMERIC(12,2) NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  payer_family_id UUID NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  allocation_method TEXT NOT NULL CHECK (allocation_method IN
      ('equal_all','equal_selected','weighted','per_person','manual')),
  child_weight_used NUMERIC(4,2),
  age_threshold_used INTEGER,
  expense_date DATE,
  entity_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE expense_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  share_amount NUMERIC(12,2) NOT NULL,
  UNIQUE (expense_id, family_id)
);

CREATE TABLE booking_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  booking_type TEXT NOT NULL CHECK (booking_type IN
      ('flight','train','hotel','tour','restaurant_reservation','other')),
  title TEXT NOT NULL,
  provider TEXT,
  confirmation_number TEXT,
  booking_date TIMESTAMPTZ,
  cost NUMERIC(12,2),
  currency TEXT,
  notes TEXT,
  linked_trip_item_id UUID REFERENCES trip_items(id) ON DELETE SET NULL,
  entity_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_record_id UUID NOT NULL REFERENCES booking_records(id) ON DELETE RESTRICT,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf','jpg','png')),
  storage_key TEXT NOT NULL,
  file_size_bytes INTEGER,
  entity_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE trip_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_method TEXT NOT NULL,
  purpose TEXT,
  notes TEXT,
  entity_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE trip_preparation_checklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL UNIQUE REFERENCES trips(id) ON DELETE CASCADE,
  budget_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  currency_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  offline_prepared_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- SYNC (Phase 8 — table present now per frozen architecture,
-- not used by any Phase 1 code path)
-- ============================================================

CREATE TABLE sync_operations (
  operation_id UUID PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('create','update','delete')),
  previous_value JSONB,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  device_label TEXT
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_sections_destination ON sections(destination_id);
CREATE INDEX idx_research_items_destination ON research_items(destination_id);
CREATE INDEX idx_research_items_section ON research_items(section_id);
CREATE INDEX idx_research_items_kind ON research_items(item_kind);
CREATE INDEX idx_research_items_priority ON research_items(priority);
CREATE INDEX idx_research_item_tags_tag ON research_item_tags(tag_id);
CREATE INDEX idx_sources_research_item ON sources(research_item_id);
CREATE INDEX idx_research_item_relations_a ON research_item_relations(item_a_id);
CREATE INDEX idx_research_item_relations_b ON research_item_relations(item_b_id);
CREATE INDEX idx_research_intake_destination ON research_intake(destination_id);
CREATE INDEX idx_research_candidates_intake ON research_candidates(intake_id);
CREATE INDEX idx_research_candidates_status ON research_candidates(status);

CREATE INDEX idx_trip_items_day ON trip_items(itinerary_day_id, sort_order);
CREATE INDEX idx_expenses_trip ON expenses(trip_id, expense_date);
CREATE INDEX idx_family_members_family ON family_members(family_id);
CREATE INDEX idx_sync_operations_entity ON sync_operations(entity_type, entity_id);
CREATE INDEX idx_booking_records_trip ON booking_records(trip_id);
CREATE INDEX idx_attachments_booking ON attachments(booking_record_id);
