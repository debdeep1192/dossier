// Ordered list of schema migrations. Each entry is applied at most once
// (tracked in schema_migrations, see db/index.js) and, once applied
// against any real database, must never be edited — only appended to.
// Every migration here must be additive/data-preserving: it may add
// tables/columns/values, but must not drop or rename anything a
// pre-existing local database could already hold data in, since this
// app has no server-side backup of a person's research.

export const MIGRATIONS = [
  {
    id: '2026_phase0_research_taxonomy',
    // Brings a database created under the pre-Phase-0 schema (item_kind
    // IN ('attraction','hotel','restaurant','transport_option',
    // 'practical_info','note'); entry_fee/price_range as free text; no
    // price/details columns; no research_intake/research_candidates; no
    // owner_account.home_currency) up to the Phase 0 shape, without
    // losing any existing rows or values.
    async up(pg) {
      // --- research_items: widen item_kind, add price/details, retire
      // entry_fee/price_range in favor of structured price. ---
      const kindColumn = await pg.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'research_items' AND column_name = 'item_kind'
      `);
      if (kindColumn.rows.length > 0) {
        // Drop the old CHECK constraint (name may vary by Postgres
        // version's auto-naming; look it up rather than assume it).
        const constraintResult = await pg.query(`
          SELECT con.conname FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          WHERE rel.relname = 'research_items' AND con.contype = 'c'
            AND pg_get_constraintdef(con.oid) LIKE '%item_kind%'
        `);
        for (const row of constraintResult.rows) {
          await pg.exec(`ALTER TABLE research_items DROP CONSTRAINT IF EXISTS "${row.conname}"`);
        }
        // Rename existing values to their Phase 0 equivalents BEFORE
        // adding the new, narrower CHECK — otherwise old values already
        // in the column would violate it. 'hotel' -> 'accommodation' and
        // 'transport_option' -> 'transport' are pure renames (same
        // meaning, existing rows keep exactly the same real-world
        // classification); nothing is reclassified into 'activity' or
        // 'food' automatically, since that would be a judgment call this
        // migration has no basis to make on existing data — those two
        // kinds are simply available going forward for new/edited items.
        await pg.exec(`UPDATE research_items SET item_kind = 'accommodation' WHERE item_kind = 'hotel'`);
        await pg.exec(`UPDATE research_items SET item_kind = 'transport' WHERE item_kind = 'transport_option'`);
        await pg.exec(`
          ALTER TABLE research_items ADD CONSTRAINT research_items_item_kind_check
            CHECK (item_kind IN ('attraction','activity','restaurant','food','accommodation','transport','practical_info','note'))
        `);
      }

      const priceColumn = await pg.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'research_items' AND column_name = 'price'
      `);
      if (priceColumn.rows.length === 0) {
        await pg.exec(`ALTER TABLE research_items ADD COLUMN price JSONB`);
      }
      const detailsColumn = await pg.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'research_items' AND column_name = 'details'
      `);
      if (detailsColumn.rows.length === 0) {
        await pg.exec(`ALTER TABLE research_items ADD COLUMN details JSONB`);
      }

      // entry_fee/price_range: migrate their free-text content into the
      // new structured `price` column rather than discarding it. Since
      // the old columns were unstructured text, this can't reliably
      // parse "LKR 1,500" into {amount, currency}; instead it preserves
      // the original text as `price.note`, so nothing is lost — the
      // person can restructure it properly later, but it survives the
      // migration and remains visible. Only runs if the old columns
      // still exist (i.e. this migration hasn't already consumed them).
      const entryFeeColumn = await pg.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'research_items' AND column_name = 'entry_fee'
      `);
      if (entryFeeColumn.rows.length > 0) {
        await pg.exec(`
          UPDATE research_items
          SET price = jsonb_build_object('note', entry_fee)
          WHERE entry_fee IS NOT NULL AND price IS NULL
        `);
        await pg.exec(`
          UPDATE research_items
          SET price = price || jsonb_build_object('note', trim(both ' ' from concat_ws(' — ', price->>'note', price_range)))
          WHERE price_range IS NOT NULL AND price IS NOT NULL
        `);
        await pg.exec(`
          UPDATE research_items
          SET price = jsonb_build_object('note', price_range)
          WHERE price_range IS NOT NULL AND price IS NULL
        `);
        await pg.exec(`ALTER TABLE research_items DROP COLUMN entry_fee`);
        await pg.exec(`ALTER TABLE research_items DROP COLUMN price_range`);
      }

      // --- owner_account.home_currency ---
      const currencyColumn = await pg.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'owner_account' AND column_name = 'home_currency'
      `);
      if (currencyColumn.rows.length === 0) {
        await pg.exec(`ALTER TABLE owner_account ADD COLUMN home_currency TEXT NOT NULL DEFAULT 'INR'`);
      }

      // --- research_intake / research_candidates (new tables) ---
      const intakeTable = await pg.query(`
        SELECT table_name FROM information_schema.tables WHERE table_name = 'research_intake'
      `);
      if (intakeTable.rows.length === 0) {
        await pg.exec(`
          CREATE TABLE research_intake (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            destination_id UUID NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
            raw_text TEXT NOT NULL,
            source_label TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
        `);
        await pg.exec(`CREATE INDEX idx_research_intake_destination ON research_intake(destination_id);`);
      }
      const candidatesTable = await pg.query(`
        SELECT table_name FROM information_schema.tables WHERE table_name = 'research_candidates'
      `);
      if (candidatesTable.rows.length === 0) {
        await pg.exec(`
          CREATE TABLE research_candidates (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            intake_id UUID NOT NULL REFERENCES research_intake(id) ON DELETE CASCADE,
            proposed_item_kind TEXT CHECK (proposed_item_kind IN
                ('attraction','activity','restaurant','food','accommodation','transport','practical_info','note')),
            proposed_title TEXT,
            proposed_content TEXT,
            proposed_price JSONB,
            source_excerpt TEXT,
            uncertainty_note TEXT,
            status TEXT NOT NULL DEFAULT 'pending_review'
                CHECK (status IN ('pending_review','accepted','rejected')),
            resulting_item_id UUID REFERENCES research_items(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
        `);
        await pg.exec(`CREATE INDEX idx_research_candidates_intake ON research_candidates(intake_id);`);
        await pg.exec(`CREATE INDEX idx_research_candidates_status ON research_candidates(status);`);
      }
    },
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.id ?? null;
