// Runtime integration test for Phase 0 — runs a real PGlite engine
// in-memory in Node (via the __setTestDb/__ensureSchemaForTest test
// seams in db/index.js), not the browser Worker path, but exercising
// the exact same schema.sql / migrations.js / query-layer code the
// browser build uses. This is what actually lets Phase 0's acceptance
// checklist be runtime-verified rather than only statically inspected.
//
// Run with: node --experimental-vm-modules src/db/__tests__/phase0.test.js
// (see package.json's "test" script)
//
// No test framework dependency is introduced — this is a plain script
// with a minimal assert-and-report harness, appropriate for the
// project's "keep the application small" constraint. Exits non-zero on
// any failure so it can be used as a real pass/fail gate.

import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { __setTestDb, __ensureSchemaForTest, getDb } from '../index.js';
import * as destinationQueries from '../queries/destinations.js';
import * as itemQueries from '../queries/researchItems.js';
import * as intakeQueries from '../queries/researchIntake.js';
import * as profileQueries from '../queries/profile.js';
import * as backup from '../backup.js';
import { MIGRATIONS } from '../migrations.js';

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

async function freshDb() {
  const pg = new PGlite();
  __setTestDb({
    query: (sql, params) => pg.query(sql, params),
    exec: (sql) => pg.exec(sql),
  });
  await __ensureSchemaForTest(pg);
  return pg;
}

console.log('\n=== Phase 0 Runtime Verification ===\n');

console.log('1. Fresh database initialization');
await test('fresh database creates all expected tables', async () => {
  const pg = await freshDb();
  const tables = await pg.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
  );
  const names = tables.rows.map(r => r.table_name);
  for (const expected of [
    'owner_account', 'destinations', 'sections', 'research_items',
    'tags', 'research_item_tags', 'sources', 'research_item_relations',
    'research_intake', 'research_candidates', 'schema_migrations',
  ]) {
    assert.ok(names.includes(expected), `missing table: ${expected}`);
  }
});

await test('fresh database has research_items.price and details columns', async () => {
  const pg = await freshDb();
  const cols = await pg.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='research_items'"
  );
  const names = cols.rows.map(r => r.column_name);
  assert.ok(names.includes('price'), 'missing price column');
  assert.ok(names.includes('details'), 'missing details column');
  assert.ok(!names.includes('entry_fee'), 'stale entry_fee column should not exist on fresh db');
  assert.ok(!names.includes('price_range'), 'stale price_range column should not exist on fresh db');
});

await test('fresh database has owner_account.home_currency defaulting to INR', async () => {
  const pg = await freshDb();
  const cols = await pg.query(
    "SELECT column_default FROM information_schema.columns WHERE table_name='owner_account' AND column_name='home_currency'"
  );
  assert.equal(cols.rows.length, 1, 'home_currency column missing');
  assert.ok(cols.rows[0].column_default.includes('INR'), 'home_currency should default to INR');
});

await test('fresh database marks all migrations as applied (no re-run on next boot)', async () => {
  const pg = await freshDb();
  const applied = await pg.query('SELECT id FROM schema_migrations');
  const ids = applied.rows.map(r => r.id);
  for (const m of MIGRATIONS) assert.ok(ids.includes(m.id), `migration ${m.id} not marked applied`);
});

await test('item_kind CHECK constraint accepts all 8 new kinds and rejects an old one', async () => {
  await freshDb();
  const dest = await destinationQueries.createDestination({ name: 'Test Destination' });
  for (const kind of ['attraction', 'activity', 'restaurant', 'food', 'accommodation', 'transport', 'practical_info', 'note']) {
    const item = await itemQueries.createResearchItem({ destinationId: dest.id, itemKind: kind, title: `Test ${kind}` });
    assert.equal(item.item_kind, kind);
  }
  await assert.rejects(
    () => itemQueries.createResearchItem({ destinationId: dest.id, itemKind: 'hotel', title: 'Old kind' }),
    'old item_kind value "hotel" should be rejected by validate.js before reaching the DB'
  );
});

console.log('\n2. Migration from a pre-Phase-0 database (existing local data)');
await test('pre-Phase-0 schema + data migrates without loss', async () => {
  const pg = new PGlite();
  // Simulate a database created by the OLD schema.sql (pre-Phase-0
  // shape): old item_kind values, entry_fee/price_range as text, no
  // price/details/home_currency/intake tables.
  await pg.exec(`
    CREATE TABLE owner_account (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      display_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
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
      section_id UUID REFERENCES sections(id) ON DELETE RESTRICT,
      item_kind TEXT NOT NULL CHECK (item_kind IN ('attraction','hotel','restaurant','transport_option','practical_info','note')),
      title TEXT NOT NULL,
      priority TEXT,
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
    );
  `);

  // Seed pre-existing real data — the exact thing this migration must protect.
  const destResult = await pg.query(
    "INSERT INTO destinations (name, overview) VALUES ('Sri Lanka', 'Pre-existing research') RETURNING id"
  );
  const destId = destResult.rows[0].id;
  const hotelResult = await pg.query(
    `INSERT INTO research_items (destination_id, item_kind, title, entry_fee, price_range)
     VALUES ($1, 'hotel', 'Galle Face Hotel', 'LKR 25,000 per night', '$$$') RETURNING id`,
    [destId]
  );
  const hotelId = hotelResult.rows[0].id;
  await pg.query(
    `INSERT INTO research_items (destination_id, item_kind, title, entry_fee)
     VALUES ($1, 'transport_option', 'Colombo Airport Taxi', 'LKR 3000') RETURNING id`,
    [destId]
  );

  // Now run the real ensureSchema() against this pre-existing database —
  // this is the actual code path getDb() uses, not a re-implementation.
  await __ensureSchemaForTest(pg);

  // Old data survived, exact id preserved.
  const hotelAfter = await pg.query('SELECT * FROM research_items WHERE id = $1', [hotelId]);
  assert.equal(hotelAfter.rows.length, 1, 'existing item row was lost during migration');
  assert.equal(hotelAfter.rows[0].item_kind, 'accommodation', 'old "hotel" value should be renamed to "accommodation"');
  assert.equal(hotelAfter.rows[0].title, 'Galle Face Hotel', 'title should be untouched');
  assert.ok(
    hotelAfter.rows[0].price && hotelAfter.rows[0].price.note &&
    hotelAfter.rows[0].price.note.includes('LKR 25,000') && hotelAfter.rows[0].price.note.includes('$$$'),
    `entry_fee/price_range text should be preserved inside price.note, got: ${JSON.stringify(hotelAfter.rows[0].price)}`
  );

  const transportAfter = await pg.query("SELECT * FROM research_items WHERE title = 'Colombo Airport Taxi'");
  assert.equal(transportAfter.rows[0].item_kind, 'transport', 'old "transport_option" value should be renamed to "transport"');
  assert.ok(transportAfter.rows[0].price?.note?.includes('LKR 3000'), 'entry_fee text should be preserved for the transport item too');

  const destAfter = await pg.query('SELECT * FROM destinations WHERE id = $1', [destId]);
  assert.equal(destAfter.rows[0].overview, 'Pre-existing research', 'destination data should be untouched');

  // New columns/tables now exist.
  const cols = await pg.query("SELECT column_name FROM information_schema.columns WHERE table_name='research_items'");
  const colNames = cols.rows.map(r => r.column_name);
  assert.ok(colNames.includes('price'), 'price column should exist after migration');
  assert.ok(colNames.includes('details'), 'details column should exist after migration');
  assert.ok(!colNames.includes('entry_fee'), 'entry_fee should be dropped after migration');
  assert.ok(!colNames.includes('price_range'), 'price_range should be dropped after migration');

  const newTables = await pg.query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('research_intake','research_candidates')");
  assert.equal(newTables.rows.length, 2, 'research_intake/research_candidates should exist after migration');

  // New item_kind values are now usable going forward.
  const activityItem = await pg.query(
    `INSERT INTO research_items (destination_id, item_kind, title) VALUES ($1, 'activity', 'Whale watching') RETURNING id`,
    [destId]
  );
  assert.ok(activityItem.rows[0].id, 'new item_kind "activity" should be insertable after migration');

  // Running ensureSchema again (simulating a second app launch) is a no-op, doesn't error.
  await __ensureSchemaForTest(pg);
  const migrationRows = await pg.query('SELECT id FROM schema_migrations');
  assert.equal(migrationRows.rows.length, MIGRATIONS.length, 'migration should be recorded exactly once, not reapplied');
});

console.log('\n3. Manual create / edit / delete of research items, all kinds');
await test('create, update, and soft-delete a research item', async () => {
  await freshDb();
  const dest = await destinationQueries.createDestination({ name: 'Sri Lanka' });
  const section = await destinationQueries.createSection({ destinationId: dest.id, name: 'Attractions' });

  const created = await itemQueries.createResearchItem({
    destinationId: dest.id,
    sectionId: section.id,
    itemKind: 'attraction',
    title: 'Galle Fort',
    priority: 'must_know',
    content: 'Best visited at sunset.',
    price: { amount: 0, currency: 'LKR', unit: '', note: 'Free entry' },
    openingHours: 'Always open',
    visitDurationMinutes: 90,
    areaLocation: 'Galle',
  });
  assert.equal(created.title, 'Galle Fort');
  assert.equal(created.price.currency, 'LKR');

  const updated = await itemQueries.updateResearchItem(created.id, { title: 'Galle Fort (updated)', priority: 'useful' });
  assert.equal(updated.title, 'Galle Fort (updated)');
  assert.equal(updated.priority, 'useful');
  assert.equal(updated.content, 'Best visited at sunset.', 'unrelated fields should be preserved on partial update');

  await itemQueries.deleteResearchItem(created.id);
  await assert.rejects(() => itemQueries.getResearchItem(created.id), 'deleted item should not be gettable');

  const destAfter = await destinationQueries.getDestination(dest.id);
  assert.equal(destAfter.items.length, 0, 'soft-deleted item should not appear in destination item list');
});

await test('manually-created and later-accepted-candidate items are the same shape', async () => {
  await freshDb();
  const dest = await destinationQueries.createDestination({ name: 'Test' });
  const manual = await itemQueries.createResearchItem({ destinationId: dest.id, itemKind: 'food', title: 'Hoppers' });

  const { intake } = await intakeQueries.createIntake({ destinationId: dest.id, rawText: 'Try the seafood here, it is excellent.' });
  const { candidates } = await intakeQueries.getIntake(intake.id);
  await intakeQueries.updateCandidate(candidates[0].id, { proposedItemKind: 'food', proposedTitle: 'Seafood' });
  const accepted = await intakeQueries.acceptCandidate(candidates[0].id, { destinationId: dest.id });

  assert.equal(Object.keys(manual).sort().join(','), Object.keys(accepted).sort().join(','),
    'manually-created and candidate-accepted items should have identical field shapes');
});

console.log('\n4. Sections');
await test('section creation, duplicate rejection, and delete-when-empty rule', async () => {
  await freshDb();
  const dest = await destinationQueries.createDestination({ name: 'Test' });
  const section = await destinationQueries.createSection({ destinationId: dest.id, name: 'Food' });
  await assert.rejects(
    () => destinationQueries.createSection({ destinationId: dest.id, name: 'Food' }),
    'duplicate section name in the same destination should be rejected'
  );

  const item = await itemQueries.createResearchItem({ destinationId: dest.id, sectionId: section.id, itemKind: 'food', title: 'Hoppers' });
  await assert.rejects(
    () => destinationQueries.deleteSection(section.id),
    'section with items should not be deletable'
  );

  await itemQueries.deleteResearchItem(item.id);
  await destinationQueries.deleteSection(section.id);
  const destAfter = await destinationQueries.getDestination(dest.id);
  assert.equal(destAfter.sections.length, 0, 'section should be gone after delete');
});

console.log('\n5. Destination navigation data / delete cascade');
await test('destination delete cascades to soft-delete its items, leaves sections orphaned-but-harmless', async () => {
  await freshDb();
  const dest = await destinationQueries.createDestination({ name: 'Test' });
  const section = await destinationQueries.createSection({ destinationId: dest.id, name: 'Attractions' });
  const item = await itemQueries.createResearchItem({ destinationId: dest.id, sectionId: section.id, itemKind: 'attraction', title: 'Fort' });

  await destinationQueries.deleteDestination(dest.id);

  await assert.rejects(() => destinationQueries.getDestination(dest.id), 'deleted destination should not be gettable');
  await assert.rejects(() => itemQueries.getResearchItem(item.id), 'items under a deleted destination should be soft-deleted too');

  const list = await destinationQueries.listDestinations();
  assert.ok(!list.some(d => d.id === dest.id), 'deleted destination should not appear in the list');
});

console.log('\n6. Complete intake flow: text -> intake -> candidates -> review -> accept -> item');
await test('full intake and review flow, including reject and undo', async () => {
  await freshDb();
  const dest = await destinationQueries.createDestination({ name: 'Sri Lanka' });

  const { intake, candidates } = await intakeQueries.createIntake({
    destinationId: dest.id,
    rawText: 'Galle Fort is best visited at sunset.\n\nTry the seafood at the local market.',
    sourceLabel: 'Travel blog',
  });
  assert.equal(candidates.length, 2, 'two paragraphs should produce two candidates');
  assert.equal(candidates[0].status, 'pending_review');
  assert.equal(candidates[0].proposed_item_kind, null, 'adapter must not guess a category');
  assert.equal(candidates[0].proposed_title, null, 'adapter must not guess a title');
  assert.ok(candidates[0].uncertainty_note, 'candidate should carry an uncertainty note prompting review');

  // Original text preserved in full, unmodified.
  const fetched = await intakeQueries.getIntake(intake.id);
  assert.equal(fetched.intake.raw_text, 'Galle Fort is best visited at sunset.\n\nTry the seafood at the local market.');

  // Reject one, accept the other after editing it during review.
  await intakeQueries.rejectCandidate(candidates[1].id);
  let afterReject = (await intakeQueries.getIntake(intake.id)).candidates.find(c => c.id === candidates[1].id);
  assert.equal(afterReject.status, 'rejected');

  await intakeQueries.resetCandidateToPending(candidates[1].id);
  afterReject = (await intakeQueries.getIntake(intake.id)).candidates.find(c => c.id === candidates[1].id);
  assert.equal(afterReject.status, 'pending_review', 'rejected candidate should be revisitable');

  await assert.rejects(
    () => intakeQueries.acceptCandidate(candidates[0].id, { destinationId: dest.id }),
    'accepting without a type/title set should fail with a clear validation error'
  );

  await intakeQueries.updateCandidate(candidates[0].id, { proposedItemKind: 'attraction', proposedTitle: 'Galle Fort' });
  const item = await intakeQueries.acceptCandidate(candidates[0].id, { destinationId: dest.id });
  assert.equal(item.title, 'Galle Fort');
  assert.equal(item.item_kind, 'attraction');

  const afterAccept = (await intakeQueries.getIntake(intake.id)).candidates.find(c => c.id === candidates[0].id);
  assert.equal(afterAccept.status, 'accepted');
  assert.equal(afterAccept.resulting_item_id, item.id, 'provenance link from candidate to resulting item should be set');

  await assert.rejects(
    () => intakeQueries.resetCandidateToPending(candidates[0].id),
    'an already-accepted candidate should not be resettable, since it already became a real item'
  );
});

await test('accepted item can subsequently be edited manually with additional info', async () => {
  await freshDb();
  const dest = await destinationQueries.createDestination({ name: 'Sri Lanka' });
  const { candidates } = await intakeQueries.createIntake({ destinationId: dest.id, rawText: 'Galle Lighthouse is nearby.' });
  await intakeQueries.updateCandidate(candidates[0].id, { proposedItemKind: 'attraction', proposedTitle: 'Galle Lighthouse' });
  const item = await intakeQueries.acceptCandidate(candidates[0].id, { destinationId: dest.id });

  const edited = await itemQueries.updateResearchItem(item.id, {
    price: { amount: 500, currency: 'LKR', unit: 'per person', note: 'Foreigner rate' },
    openingHours: '7 AM - 6 PM',
    visitDurationMinutes: 30,
  });
  assert.equal(edited.price.amount, 500);
  assert.equal(edited.opening_hours, '7 AM - 6 PM');
  assert.equal(edited.visit_duration_minutes, 30);
  assert.equal(edited.title, 'Galle Lighthouse', 'title from acceptance should be preserved through the manual edit');
});

console.log('\n7. Home currency and structured price');
await test('home currency defaults to INR and is configurable', async () => {
  await freshDb();
  await profileQueries.createProfile({ displayName: 'Debdeep' });
  const profile = await profileQueries.getProfile();
  assert.equal(profile.home_currency, 'INR');

  const updated = await profileQueries.updateHomeCurrency('LKR');
  assert.equal(updated.home_currency, 'LKR');
  const reFetched = await profileQueries.getProfile();
  assert.equal(reFetched.home_currency, 'LKR');
});

await test('price preserves original currency exactly, never auto-converts', async () => {
  await freshDb();
  const dest = await destinationQueries.createDestination({ name: 'Thailand' });
  const item = await itemQueries.createResearchItem({
    destinationId: dest.id, itemKind: 'restaurant', title: 'Street food stall',
    price: { amount: 150, currency: 'THB', unit: 'per meal', note: '' },
  });
  assert.equal(item.price.currency, 'THB');
  assert.equal(item.price.amount, 150);
  // Changing home currency must not touch already-stored research prices.
  await profileQueries.createProfile({ displayName: 'Test' });
  await profileQueries.updateHomeCurrency('INR');
  const itemAfter = await itemQueries.getResearchItem(item.id);
  assert.equal(itemAfter.price.currency, 'THB', 'existing research price currency must not change when home currency changes');
  assert.equal(itemAfter.price.amount, 150);
});

console.log('\n8. Backup / restore');
await test('backup export includes research_intake and research_candidates with data', async () => {
  await freshDb();
  const dest = await destinationQueries.createDestination({ name: 'Sri Lanka' });
  await intakeQueries.createIntake({ destinationId: dest.id, rawText: 'A single paragraph of notes.' });

  // buildBackupPayload() is the browser-independent data-gathering step;
  // exportBackup() additionally triggers a file download via Blob/DOM
  // APIs that don't exist in this Node test environment, so it isn't
  // called directly here — buildBackupPayload() is exactly the part of
  // it that matters for verifying what data backup actually captures.
  const exported = await backup.buildBackupPayload();
  assert.ok(exported.tables.research_intake, 'backup should include research_intake table');
  assert.equal(exported.tables.research_intake.length, 1);
  assert.ok(exported.tables.research_candidates, 'backup should include research_candidates table');
  assert.equal(exported.tables.research_candidates.length, 1);
  assert.ok(exported.tables.destinations.length === 1);
});

await test('restore round-trips research_intake/research_candidates data correctly', async () => {
  await freshDb();
  const dest = await destinationQueries.createDestination({ name: 'Sri Lanka' });
  const { intake } = await intakeQueries.createIntake({ destinationId: dest.id, rawText: 'Restore me.' });
  const exported = await backup.buildBackupPayload();

  // importBackup() calls resetSchema() itself before restoring, so it's
  // not called again here — this exercises the exact real restore path.
  const db = await getDb();
  await backup.importBackup(exported);
  const restored = await db.query('SELECT * FROM research_intake WHERE id = $1', [intake.id]);
  assert.equal(restored.rows.length, 1, 'intake row should be restored with its original id');
  assert.equal(restored.rows[0].raw_text, 'Restore me.');
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
