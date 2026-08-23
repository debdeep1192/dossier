import { useState, useEffect, useRef, useCallback } from 'react';

// A small, module-level, in-memory cache keyed by an arbitrary string
// (the caller decides the key — e.g. `destination:${id}`). This is
// deliberately NOT a general caching library: it exists to solve one
// specific problem — PGlite/getDb() is already fast once initialized
// (a local, in-memory-backed query), but re-visiting a destination or
// item the person already opened earlier in this session was still
// blocking on a fresh full-page <LoadingState/> every time, because the
// page components discarded their data on unmount and started from
// null again. That's a UI-layer problem, not a database problem, and
// this hook fixes it at the UI layer: once a key has been fetched once
// in this session, revisiting it shows the cached result IMMEDIATELY
// (no loading state at all) while silently re-querying in the
// background to catch any changes (stale-while-revalidate) — so
// navigating between destinations already visited in this session feels
// instant, matching what a local app should feel like, without
// resorting to a service worker or any cross-session persistence (the
// cache is memory-only and gone on refresh, which is fine: PGlite/
// IndexedDB remains the actual source of truth, this is purely a render
// -layer convenience).
const cache = new Map();

export function invalidateCachedQuery(key) {
  cache.delete(key);
}

export function invalidateCachedQueryPrefix(prefix) {
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

// fetcher: async () => data. key: string, or null/undefined to skip.
export function useCachedQuery(key, fetcher) {
  const cached = key ? cache.get(key) : undefined;
  const [data, setData] = useState(cached);
  const [error, setError] = useState(null);
  // Only genuinely "loading" (show a loading state) if there is no
  // cached value at all for this key yet — a background revalidation of
  // an already-cached key never flips this back to true, so the
  // previously-seen content stays on screen while it silently refreshes.
  const [loading, setLoading] = useState(cached === undefined);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async () => {
    if (!key) return;
    setError(null);
    try {
      const result = await fetcherRef.current();
      cache.set(key, result);
      setData(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    if (!key) return;
    const existing = cache.get(key);
    if (existing !== undefined) {
      // Already have something to show for this key — display it
      // immediately, no loading flash, then quietly revalidate.
      setData(existing);
      setLoading(false);
    } else {
      setData(undefined);
      setLoading(true);
    }
    load();
    // Intentionally only re-runs when `key` changes (e.g. navigating to
    // a different destinationId/itemId) — `load` is stable per key via
    // useCallback, and fetcherRef avoids needing fetcher in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, error, loading, refresh: load };
}
