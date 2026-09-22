import { useState } from 'react';
import { lookupPlace, getCachedConfirmedResult, setCachedConfirmedResult, buildConfirmedPlace } from '../lib/placeLookup.js';
import Button from './Button';
import './PlaceLookup.css';

// Explicit "Find Place" action — item 9/6 of the spec. Sits inside
// PlaceField (see Place.jsx) so every place-based form gets this for
// free without duplicating lookup logic per page.
//
// This NEVER blocks saving: a failed/empty/offline lookup just leaves
// the person with their existing manual fields, unchanged. Selecting
// a candidate fills in the place's name/locality/coordinates and a
// Google-Maps-search link (built the same way as the existing
// buildGoogleMapsUrl fallback) — it does NOT claim to know reviews,
// ratings, or review counts, because Nominatim has none of that data.
export default function PlaceLookup({ name, locationName, destinationName, expectedCategory, onConfirm }) {
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'results' | 'error' | 'empty'
  const [candidates, setCandidates] = useState([]);
  const [error, setError] = useState('');
  // Set only when the results actually came from a broader fallback
  // search (see lib/placeLookup.js's buildFallbackNames/lookupPlace) —
  // e.g. searching "Tiger Hill Observatory" found nothing exact, but
  // "Tiger Hill" did. Holds the broader name that was actually used,
  // so the person can see these results aren't an exact match to what
  // they typed, rather than the two being shown identically. Cleared
  // on every new search and whenever a cached/exact result is shown.
  const [broaderSearchUsed, setBroaderSearchUsed] = useState('');
  // True specifically when the broader search above ALSO dropped a
  // word that names a distinct kind of place (a "station", "museum",
  // "observatory"...) — see lib/placeLookup.js's
  // droppedAnEntityTypeWord()/ENTITY_TYPE_WORDS. This gets a visibly
  // stronger caution than an ordinary broader-search note, since the
  // person may be looking at a related-but-different, larger place
  // (e.g. the whole hill) rather than the specific thing they searched
  // for (a viewpoint/facility on it) — never set when nothing was
  // dropped, and never set for the spelling/punctuation/bare-name
  // discovery variants, since those find the SAME requested name, not
  // a broader one (matchedName stays equal to what was typed in that
  // case, so broaderSearchUsed itself is never set either).
  const [entityTypeDropped, setEntityTypeDropped] = useState(false);

  async function handleFindPlace() {
    if (!name?.trim()) { setError('Enter a name first.'); setStatus('error'); return; }
    setBroaderSearchUsed('');
    setEntityTypeDropped(false);

    const cached = getCachedConfirmedResult({ name, locationName, destinationName });
    if (cached) {
      // A previously-confirmed result for this exact name+context —
      // reuse it without another network call, per the caching
      // requirement. Still shown as a single "candidate" so the person
      // explicitly confirms it again for THIS record (confirming once
      // doesn't silently apply to a different record).
      setCandidates([{ cached: true, place: cached }]);
      setStatus('results');
      return;
    }

    setStatus('loading');
    setError('');
    const { candidates: results, error: lookupError, matchedName, matchedViaEntityTypeDrop } = await lookupPlace({ name, locationName, destinationName, expectedCategory });
    if (lookupError) {
      setError(lookupError);
      setStatus('error');
      return;
    }
    if (results.length === 0) {
      setStatus('empty');
      return;
    }
    // matchedName differs from what was actually typed only when a
    // broader fallback variant is what produced results (see
    // buildFallbackNames) — an exact-match search always returns
    // matchedName === name (this includes results found via the
    // spelling/punctuation/bare-name discovery variants — those are
    // alternative ways of finding the SAME requested name, not a
    // broadening to a different one, so they never set this either).
    // Compared case-insensitively/trimmed since that's the same
    // normalization the lookup's own matching already treats as "the
    // same name".
    if (matchedName && matchedName.trim().toLowerCase() !== name.trim().toLowerCase()) {
      setBroaderSearchUsed(matchedName);
      setEntityTypeDropped(Boolean(matchedViaEntityTypeDrop));
    }
    setCandidates(results);
    setStatus('results');
  }

  function handleSelect(candidate) {
    const place = candidate.cached ? candidate.place : buildConfirmedPlace(candidate, locationName);
    setCachedConfirmedResult({ name, locationName, destinationName }, place);
    onConfirm(place);
    setStatus('idle');
    setCandidates([]);
    setBroaderSearchUsed('');
    setEntityTypeDropped(false);
  }

  function handleNoneOfThese() {
    setStatus('idle');
    setCandidates([]);
    setBroaderSearchUsed('');
    setEntityTypeDropped(false);
  }

  return (
    <div className="place-lookup">
      <Button type="button" variant="secondary" size="sm" onClick={handleFindPlace} disabled={status === 'loading'}>
        {status === 'loading' ? 'Searching…' : '🔍 Find Place'}
      </Button>

      {status === 'error' && (
        <p className="place-lookup__hint place-lookup__hint--error">{error}</p>
      )}
      {status === 'empty' && (
        <p className="place-lookup__hint">No matches found. You can still enter the place manually below.</p>
      )}

      {status === 'results' && (
        <div className="place-lookup__results">
          <p className="place-lookup__hint">
            {candidates[0]?.cached
              ? 'Previously confirmed for this name — reuse it?'
              : 'Ranked by name, location, and category match — not by Google reviews (Dossier doesn\'t have access to those). Pick the right one, or dismiss and enter manually.'}
          </p>
          {broaderSearchUsed && (
            <p className={`place-lookup__hint place-lookup__hint--broader${entityTypeDropped ? ' place-lookup__hint--caution' : ''}`}>
              {entityTypeDropped
                ? `No exact match for "${name}" — showing results for the broader "${broaderSearchUsed}" instead. This may be a different, more specific place than what you searched for.`
                : `No exact match for "${name}" — showing results for the broader search "${broaderSearchUsed}" instead.`}
            </p>
          )}
          {candidates.map((c, i) => (
            <button key={i} type="button" className="place-lookup__candidate" onClick={() => handleSelect(c)}>
              <span className="place-lookup__candidate-name">{c.cached ? c.place.name : c.name}</span>
              <span className="place-lookup__candidate-address">{c.cached ? [c.place.locality, c.place.city].filter(Boolean).join(', ') : c.displayName}</span>
            </button>
          ))}
          <button type="button" className="place-lookup__none" onClick={handleNoneOfThese}>None of these / keep my manual entry</button>
        </div>
      )}
    </div>
  );
}
