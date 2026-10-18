// Research ↔ Planning integration (Tour Planning, Phase 3) — how
// Planning reaches ONE specific Research entry.
//
// Research has no per-record routes: each section page lists its
// records as cards and a card opens that record's edit modal in place
// (setEditing(item)). Rather than invent a parallel detail-page
// architecture, "open the full Research entry" reuses that exact
// mechanism: link to the record's own section page with `?open=<id>`,
// and the page opens its existing edit modal for that record — the
// same one-shot URL-flag pattern as the `?new=1` auto-open flow (see
// hooks/useAutoOpenNewForm.js and lib/addEntryRouting.js).
//
// Plain .js (no JSX) so plain Node can import and test it.

import { SECTIONS } from '../sectionRegistry.js';
import { TIMELINE_RESEARCH_REF_TYPES } from '../db/stores/timelineItems.js';

export const OPEN_RECORD_PARAM = 'open';

// Path of the section page that lists this kind of Research record,
// carrying the record id. Only the four Research types a Planning can
// reference are supported; anything else (or a missing id) -> null, so
// the caller simply shows no link rather than a wrong one.
export function buildResearchEntryPath(destinationId, researchRefType, researchRefId) {
  if (!destinationId || !researchRefId) return null;
  if (!TIMELINE_RESEARCH_REF_TYPES.includes(researchRefType)) return null;
  const section = SECTIONS.find(s => s.key === researchRefType);
  if (!section) return null;
  const params = new URLSearchParams({ [OPEN_RECORD_PARAM]: researchRefId });
  return `/destinations/${destinationId}/${section.path}?${params.toString()}`;
}

// Removes the one-shot `open` flag, leaving every other search param
// (`location`, `tab`, ...) untouched. Same shape as
// addEntryRouting.js's consumeAutoOpenFlag.
export function consumeOpenParam(search) {
  const next = new URLSearchParams(search);
  next.delete(OPEN_RECORD_PARAM);
  return next;
}

// Finds the requested record among a section page's ALREADY-LOADED,
// soft-delete-filtered records. Exact id match only: a soft-deleted or
// unknown id returns null — never a fallback to some other record.
export function findRecordToOpen(records, id) {
  if (!id || !Array.isArray(records)) return null;
  return records.find(r => r && r.id === id) || null;
}
