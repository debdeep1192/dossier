import { getDb } from '../index.js';
import { ITEM_KINDS, isNonEmptyString, isValidUUID, ValidationError, NotFoundError } from './validate.js';
import { createResearchItem } from './researchItems.js';
import { ACTIVE_ADAPTER } from '../extraction/index.js';

// ============================================================
// Document/text ingestion pipeline.
//
// RAW INPUT -> EXTRACTION ADAPTER -> CANDIDATES -> REVIEW -> RESEARCH ITEM
//
// The parser (see ../extraction/index.js) never writes to research_items
// directly. It only ever produces research_candidates rows, which the
// person reviews individually — accept, edit, or reject — before
// anything becomes real Research data. acceptCandidate() below is the
// single place a candidate can become a research_items row, and it goes
// through the exact same createResearchItem() that manual entry uses,
// so a document-derived item and a manually-typed item are the same
// entity in every way once saved — there is no second, parallel data
// shape for "imported" records.
// ============================================================

// ---- Intake (the preserved original document/paste) ----

export async function createIntake({ destinationId, rawText, sourceLabel }) {
  if (!isValidUUID(destinationId)) throw new ValidationError('A valid destination is required.');
  if (!isNonEmptyString(rawText)) throw new ValidationError('Pasted text cannot be empty.');
  const db = await getDb();
  const dest = await db.query('SELECT id FROM destinations WHERE id = $1 AND deleted_at IS NULL', [destinationId]);
  if (dest.rows.length === 0) throw new NotFoundError('Destination not found.');

  // The original text is stored exactly as pasted, in full, regardless
  // of what the adapter below does with it or what happens to the
  // candidates afterward — satisfies "preserve the original document/
  // input" and "never destroy information the parser could not
  // understand."
  const intakeResult = await db.query(
    'INSERT INTO research_intake (destination_id, raw_text, source_label) VALUES ($1, $2, $3) RETURNING *',
    [destinationId, rawText, sourceLabel || null]
  );
  const intake = intakeResult.rows[0];

  const candidates = ACTIVE_ADAPTER.extract(rawText);
  const inserted = [];
  for (const c of candidates) {
    const result = await db.query(`
      INSERT INTO research_candidates (
        intake_id, proposed_item_kind, proposed_title, proposed_content, proposed_price, source_excerpt, uncertainty_note
      ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [
      intake.id, c.proposedItemKind, c.proposedTitle, c.proposedContent,
      c.proposedPrice ? JSON.stringify(c.proposedPrice) : null, c.sourceExcerpt, c.uncertaintyNote,
    ]);
    inserted.push(result.rows[0]);
  }

  return { intake, candidates: inserted };
}

export async function getIntake(id) {
  if (!isValidUUID(id)) throw new ValidationError('invalid_id');
  const db = await getDb();
  const intakeResult = await db.query('SELECT * FROM research_intake WHERE id = $1', [id]);
  if (intakeResult.rows.length === 0) throw new NotFoundError('not_found');
  const candidatesResult = await db.query(
    'SELECT * FROM research_candidates WHERE intake_id = $1 ORDER BY created_at ASC', [id]
  );
  return { intake: intakeResult.rows[0], candidates: candidatesResult.rows };
}

export async function listIntakesForDestination(destinationId) {
  if (!isValidUUID(destinationId)) throw new ValidationError('invalid_id');
  const db = await getDb();
  const result = await db.query(`
    SELECT ri.*,
           COUNT(rc.id) AS candidate_count,
           COUNT(rc.id) FILTER (WHERE rc.status = 'pending_review') AS pending_count
    FROM research_intake ri
    LEFT JOIN research_candidates rc ON rc.intake_id = ri.id
    WHERE ri.destination_id = $1
    GROUP BY ri.id
    ORDER BY ri.created_at DESC
  `, [destinationId]);
  return result.rows;
}

// ---- Candidates (review actions) ----

export async function updateCandidate(id, { proposedItemKind, proposedTitle, proposedContent, proposedPrice }) {
  if (!isValidUUID(id)) throw new ValidationError('invalid_id');
  const db = await getDb();
  const existing = await db.query('SELECT * FROM research_candidates WHERE id = $1', [id]);
  if (existing.rows.length === 0) throw new NotFoundError('not_found');
  if (existing.rows[0].status !== 'pending_review') {
    throw new ValidationError('This candidate has already been reviewed.');
  }
  if (proposedItemKind !== undefined && proposedItemKind !== null && !ITEM_KINDS.includes(proposedItemKind)) {
    throw new ValidationError(`Item kind must be one of: ${ITEM_KINDS.join(', ')}`);
  }

  const result = await db.query(`
    UPDATE research_candidates SET
      proposed_item_kind = CASE WHEN $2::boolean THEN $3 ELSE proposed_item_kind END,
      proposed_title = CASE WHEN $4::boolean THEN $5 ELSE proposed_title END,
      proposed_content = CASE WHEN $6::boolean THEN $7 ELSE proposed_content END,
      proposed_price = CASE WHEN $8::boolean THEN $9 ELSE proposed_price END,
      updated_at = now()
    WHERE id = $1
    RETURNING *
  `, [
    id,
    proposedItemKind !== undefined, proposedItemKind,
    proposedTitle !== undefined, proposedTitle,
    proposedContent !== undefined, proposedContent,
    proposedPrice !== undefined, proposedPrice ? JSON.stringify(proposedPrice) : null,
  ]);
  return result.rows[0];
}

// Accepting a candidate is the one moment a proposal becomes real
// Research data — always an explicit, individual user action per
// candidate, never automatic or batched silently. Creates a normalized
// research_items row via the exact same createResearchItem() manual
// entry uses, then links the candidate back to it so provenance ("this
// item came from this document") survives after acceptance.
export async function acceptCandidate(id, { destinationId, sectionId }) {
  if (!isValidUUID(id)) throw new ValidationError('invalid_id');
  const db = await getDb();
  const existing = await db.query('SELECT * FROM research_candidates WHERE id = $1', [id]);
  if (existing.rows.length === 0) throw new NotFoundError('not_found');
  const candidate = existing.rows[0];
  if (candidate.status !== 'pending_review') throw new ValidationError('This candidate has already been reviewed.');
  if (!candidate.proposed_item_kind) throw new ValidationError('Choose a type for this candidate before accepting it.');
  if (!isNonEmptyString(candidate.proposed_title)) throw new ValidationError('This candidate needs a title before accepting it.');

  const item = await createResearchItem({
    destinationId,
    sectionId: sectionId || null,
    itemKind: candidate.proposed_item_kind,
    title: candidate.proposed_title,
    content: candidate.proposed_content || null,
    price: candidate.proposed_price || null,
  });

  await db.query(
    `UPDATE research_candidates SET status = 'accepted', resulting_item_id = $2, updated_at = now() WHERE id = $1`,
    [id, item.id]
  );

  return item;
}

export async function rejectCandidate(id) {
  if (!isValidUUID(id)) throw new ValidationError('invalid_id');
  const db = await getDb();
  const existing = await db.query('SELECT id, status FROM research_candidates WHERE id = $1', [id]);
  if (existing.rows.length === 0) throw new NotFoundError('not_found');
  if (existing.rows[0].status !== 'pending_review') throw new ValidationError('This candidate has already been reviewed.');
  await db.query(`UPDATE research_candidates SET status = 'rejected', updated_at = now() WHERE id = $1`, [id]);
}

// Lets a rejected candidate be revisited later — reviewing isn't a
// one-way door, and the original source_excerpt/raw intake text is
// never deleted regardless of status, so nothing is lost even before
// this is called.
export async function resetCandidateToPending(id) {
  if (!isValidUUID(id)) throw new ValidationError('invalid_id');
  const db = await getDb();
  const existing = await db.query('SELECT id, status FROM research_candidates WHERE id = $1', [id]);
  if (existing.rows.length === 0) throw new NotFoundError('not_found');
  if (existing.rows[0].status === 'accepted') {
    throw new ValidationError('This candidate already became a research item and cannot be reset.');
  }
  await db.query(
    `UPDATE research_candidates SET status = 'pending_review', updated_at = now() WHERE id = $1`, [id]
  );
}
