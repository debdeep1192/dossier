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

CREATE TABLE research_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id UUID NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  section_id UUID REFERENCES sections(id) ON DELETE RESTRICT, -- nullable: destination-level notes
  item_kind TEXT NOT NULL CHECK (item_kind IN
      ('attraction','hotel','restaurant','transport_option','practical_info','note')),
  title TEXT NOT NULL,
  priority TEXT CHECK (priority IN ('must_know','useful','optional','reference')),
  content TEXT,
  entry_fee TEXT,
  opening_hours TEXT,
  visit_duration_minutes INTEGER,
  price_range TEXT,
  area_location TEXT,
  maps_url TEXT,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
  -- Application rule: research_items are never hard-deleted in V1, only soft-deleted.
);

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

CREATE INDEX idx_trip_items_day ON trip_items(itinerary_day_id, sort_order);
CREATE INDEX idx_expenses_trip ON expenses(trip_id, expense_date);
CREATE INDEX idx_family_members_family ON family_members(family_id);
CREATE INDEX idx_sync_operations_entity ON sync_operations(entity_type, entity_id);
CREATE INDEX idx_booking_records_trip ON booking_records(trip_id);
CREATE INDEX idx_attachments_booking ON attachments(booking_record_id);
