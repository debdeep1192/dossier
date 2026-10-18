import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { OPEN_RECORD_PARAM, consumeOpenParam, findRecordToOpen } from '../lib/researchNavigation.js';

// Lets Planning (Phase 3, Feature A) open a section page straight onto
// one Research record's existing edit modal, via `?open=<recordId>` —
// the same one-shot URL-flag pattern as useAutoOpenNewForm's `?new=1`.
//
// `records` is the section page's already-loaded list (undefined while
// loading — the hook simply waits). When the id is found, `onOpen`
// gets that exact record (the same object a card click would pass to
// setEditing). When it is NOT found (soft-deleted, or never existed),
// nothing is opened — no fallback to another record — and `unavailable`
// turns true so the page can say so. Either way the flag is removed
// from the URL (updater form, so `location`/`tab` and anything else
// are preserved), so refresh/back never re-triggers it.
export function useOpenRecordFromUrl({ records, onOpen }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get(OPEN_RECORD_PARAM);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!openId || !records) return;
    const record = findRecordToOpen(records, openId);
    if (record) onOpen(record);
    else setUnavailable(true);
    setSearchParams(prev => consumeOpenParam(prev), { replace: true });
    // Reacts to the flag appearing and to the records arriving; the
    // flag is consumed on first use, so this fires once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, records]);

  return { unavailable, dismissUnavailable: () => setUnavailable(false) };
}
