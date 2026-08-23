import { getDb, resetSchema } from './index.js';

// ============================================================
// Backup export / import.
//
// Format: one flat JSON object, keyed by table name, each holding the raw
// rows for that table (SELECT * equivalents). Foreign key columns are
// preserved as-is on each row, which is what actually encodes the
// relationships (Destination -> Section -> Item -> Tags/Sources, etc.) —
// a flat, table-keyed structure round-trips losslessly and is simpler to
// validate and re-import correctly than a deeply nested structure would
// be, while still satisfying "complete data and relationships."
//
// TABLE_ORDER matches the migration's CREATE TABLE order, which was
// already written parent-before-child for foreign key safety — the same
// order is reused here for both export enumeration and import insertion.
// ============================================================

export const BACKUP_FORMAT_VERSION = 1;

const TABLE_ORDER = [
  'owner_account',
  'family_weight_presets',
  'app_settings',
  'destinations',
  'sections',
  'research_items',
  'tags',
  'research_item_tags',
  'sources',
  'research_item_relations',
  'research_intake',
  'research_candidates',
  'trips',
  'trip_destinations',
  'itinerary_days',
  'trip_items',
  'parsed_itinerary_drafts',
  'families',
  'family_members',
  'trip_logistics',
  'budget_lines',
  'budget_line_families',
  'expenses',
  'expense_allocations',
  'booking_records',
  'attachments',
  'trip_contacts',
  'trip_preparation_checklist',
  'sync_operations',
];

export async function buildBackupPayload() {
  const db = await getDb();
  const tables = {};
  let totalRows = 0;

  for (const table of TABLE_ORDER) {
    const result = await db.query(`SELECT * FROM "${table}" ORDER BY created_at ASC NULLS FIRST`).catch(
      // A handful of join tables have no created_at column; fall back to
      // an unordered select for those rather than failing the export.
      async () => db.query(`SELECT * FROM "${table}"`)
    );
    tables[table] = result.rows;
    totalRows += result.rows.length;
  }

  return {
    dossierBackupVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
    _meta: { totalRows },
  };
}

export function triggerFileDownload(filename, dataObject) {
  const json = JSON.stringify(dataObject, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportBackup() {
  const payload = await buildBackupPayload();
  const stamp = payload.exportedAt.replace(/[:.]/g, '-');
  triggerFileDownload(`dossier-backup-${stamp}.json`, payload);
  return payload;
}

// ---- Validation (must run before anything touches the live database) ----

export function validateBackupPayload(parsed) {
  const errors = [];

  if (typeof parsed !== 'object' || parsed === null) {
    return { valid: false, errors: ['File is not a valid backup (not a JSON object).'], summary: null };
  }
  if (typeof parsed.dossierBackupVersion !== 'number') {
    errors.push('Missing or invalid dossierBackupVersion — this does not look like a Dossier backup file.');
  } else if (parsed.dossierBackupVersion > BACKUP_FORMAT_VERSION) {
    errors.push(
      `This backup was made with a newer version of Dossier (version ${parsed.dossierBackupVersion}) than this app supports (version ${BACKUP_FORMAT_VERSION}). Update the app before importing.`
    );
  }
  if (typeof parsed.tables !== 'object' || parsed.tables === null) {
    errors.push('Backup file is missing its data ("tables" section).');
  } else {
    for (const table of TABLE_ORDER) {
      if (parsed.tables[table] !== undefined && !Array.isArray(parsed.tables[table])) {
        errors.push(`Backup data for "${table}" is malformed (expected a list of rows).`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, summary: null };
  }

  const summary = {
    exportedAt: parsed.exportedAt || null,
    backupVersion: parsed.dossierBackupVersion,
    destinationCount: (parsed.tables.destinations || []).length,
    sectionCount: (parsed.tables.sections || []).length,
    researchItemCount: (parsed.tables.research_items || []).length,
    tripCount: (parsed.tables.trips || []).length,
    tagCount: (parsed.tables.tags || []).length,
    sourceCount: (parsed.tables.sources || []).length,
    totalRows: TABLE_ORDER.reduce((sum, t) => sum + (parsed.tables[t] || []).length, 0),
  };

  return { valid: true, errors: [], summary };
}

export function parseBackupFileText(text) {
  try {
    const parsed = JSON.parse(text);
    return { parsed, parseError: null };
  } catch (e) {
    return { parsed: null, parseError: 'This file is not valid JSON and cannot be read as a Dossier backup.' };
  }
}

// ---- Import (replace, not merge) ----

async function insertRows(db, table, rows) {
  if (!rows || rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const columnList = columns.map(c => `"${c}"`).join(', ');
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `INSERT INTO "${table}" (${columnList}) VALUES (${placeholders})`;

  for (const row of rows) {
    const values = columns.map(c => row[c]);
    await db.query(sql, values);
  }
}

// Runs the full replace-not-merge import. Assumes validateBackupPayload
// has already been called and returned valid: true, and that the caller
// has already obtained explicit user confirmation and triggered the
// automatic pre-import safety backup (see MorePage's import flow) —
// this function performs the actual destructive step and nothing else,
// so it stays simple and auditable.
export async function importBackup(parsed) {
  const db = await getDb();
  await resetSchema();

  for (const table of TABLE_ORDER) {
    const rows = parsed.tables[table];
    await insertRows(db, table, rows || []);
  }
}
