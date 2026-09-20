import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { consumeAutoOpenFlag } from '../lib/addEntryRouting.js';

// Lets the global "+ Add" flow (see components/AppShell.jsx's
// openAdd()) open a section's OWN, ALREADY-EXISTING "new record" form,
// instead of a second/parallel form implementation — Phase 3 Chunk 12.
//
// Every section page already has a pattern like:
//   const [editing, setEditing] = useState(null);
//   ... setEditing({}) opens the real "New X" form ...
// This hook just triggers that same setEditing({}) call once, when the
// page is reached with `?new=1` in the URL (set when navigating here —
// see lib/addEntryRouting.js's buildAddDestinationPath), then removes
// the flag from the URL so refreshing the page or navigating back
// doesn't re-open the form unexpectedly.
//
// destinationId/locationId context is NOT handled here — it already
// arrives via the normal `?location=` query param every section page
// already reads on its own; this hook only handles the "start in the
// new-record form" behavior. Removing `new` uses the UPDATER-FUNCTION
// form of setSearchParams (prev => ...) rather than building `next`
// from this render's closed-over `searchParams` — this guarantees the
// delete is always applied to whatever the search params actually are
// at the moment React runs the update (React may batch/queue multiple
// search-param-affecting updates from other effects on the same page
// in the same commit), so `location` can never be dropped or
// clobbered by this hook regardless of what else changes the URL in
// the same render pass. This removes a whole class of "was this
// closure stale" question rather than requiring one to be reasoned
// about by inspection.
export function useAutoOpenNewForm(setEditing) {
  const [searchParams, setSearchParams] = useSearchParams();
  const shouldOpen = searchParams.get('new') === '1';

  useEffect(() => {
    if (!shouldOpen) return;
    setEditing({});
    setSearchParams(prev => consumeAutoOpenFlag(prev), { replace: true });
    // Intentionally reacting only to `shouldOpen` (derived once from
    // the URL on mount) rather than the full searchParams object —
    // this must fire once when ?new=1 is first seen, not on every
    // subsequent search-param change this same page makes (e.g. the
    // ?location= filter changing afterward).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldOpen]);
}
