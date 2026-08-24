import { useState, useEffect, useRef, useCallback } from 'react';

// In-memory, session-only cache — not persisted, IndexedDB remains the
// real source of truth. Solves one specific problem: showing a
// previously-visited destination/section instantly on revisit, with no
// loading flash, while quietly re-fetching in the background. See the
// old Dossier's equivalent hook for the fuller rationale — same pattern,
// proven correct, carried forward deliberately (this is UI-layer
// convenience, not storage architecture, so there was no reason to
// redesign it).
const cache = new Map();

export function invalidateCachedQuery(key) {
  cache.delete(key);
}

export function invalidateCachedQueryPrefix(prefix) {
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

export function useCachedQuery(key, fetcher) {
  const cached = key ? cache.get(key) : undefined;
  const [data, setData] = useState(cached);
  const [error, setError] = useState(null);
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
      setData(existing);
      setLoading(false);
    } else {
      setData(undefined);
      setLoading(true);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, error, loading, refresh: load };
}
