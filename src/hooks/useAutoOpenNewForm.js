import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

// Lets the global "+ Add" flow (see components/AddEntry.jsx) open a
// section's OWN, ALREADY-EXISTING "new record" form, instead of a
// second/parallel form implementation — Phase 3 Chunk 12.
//
// Every section page already has a pattern like:
//   const [editing, setEditing] = useState(null);
//   ... setEditing({}) opens the real "New X" form ...
// This hook just triggers that same setEditing({}) call once, when the
// page is reached with `?new=1` in the URL (set by AddEntry when it
// navigates here), then removes the flag from the URL so refreshing
// the page or navigating back doesn't re-open the form unexpectedly.
//
// destinationId/locationId context is NOT handled here — it already
// arrives via the normal `?location=` query param every section page
// already reads on its own; this hook only handles the "start in the
// new-record form" behavior.
export function useAutoOpenNewForm(setEditing) {
  const [searchParams, setSearchParams] = useSearchParams();
  const shouldOpen = searchParams.get('new') === '1';

  useEffect(() => {
    if (!shouldOpen) return;
    setEditing({});
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
    // Intentionally reacting only to `shouldOpen` (derived once from
    // the URL on mount) rather than the full searchParams object —
    // this must fire once when ?new=1 is first seen, not on every
    // subsequent search-param change this same page makes (e.g. the
    // ?location= filter changing afterward).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldOpen]);
}
