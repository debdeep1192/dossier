import { useState } from 'react';
import { Select } from './Field';
import { createJourney } from '../db/stores/journeys.js';
import './LocationScopeField.css';

// User-facing "Route" picker (Phase 3 Chunk 7) — lets a record
// optionally be associated with travel between two existing
// locations, displayed simply as "Colombo → Kandy". Only sections
// that declare a `journeyId` field on their own shape use this
// (currently Transport and Attractions); it is NOT part of
// LocationScopeField or of every record's shared metadata.
//
// This is a pure terminology/UI change over the previous JourneyField:
// the underlying entity, store, and field name are unchanged (see
// db/stores/journeys.js, still called a Journey internally, and the
// `journeyId` field name on records is unchanged) — only the words
// shown to the person are "Route" instead of "Journey", since that's
// the more natural way to describe "Colombo → Kandy" without exposing
// implementation vocabulary.
//
// Props:
//   journeys    - the destination's Journey[] (from db/stores/journeys.js)
//   locations   - the destination's Location[] (needed to label each route and to create a new one)
//   destinationId
//   value       - current journeyId, or null
//   onChange(nextJourneyId)
//   onJourneyCreated() - called after a new route is created inline, so the
//                         caller can refetch its journeys list
export default function RouteField({ journeys, locations, destinationId, value, onChange, onJourneyCreated }) {
  const [creating, setCreating] = useState(false);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [error, setError] = useState('');

  if (locations.length < 2) return null; // a route needs two existing locations to choose between

  async function handleCreate() {
    setError('');
    try {
      const journey = await createJourney(destinationId, { fromLocationId: fromId, toLocationId: toId });
      setCreating(false);
      setFromId('');
      setToId('');
      onJourneyCreated?.();
      onChange(journey.id);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="location-scope-field">
      <Select
        label="Route"
        hint="Leave as 'Not part of a route' unless this is something encountered while travelling between two cities."
        value={creating ? '__NEW__' : (value || '')}
        onChange={e => {
          if (e.target.value === '__NEW__') { setCreating(true); return; }
          setCreating(false);
          onChange(e.target.value || null);
        }}
      >
        <option value="">Not part of a route</option>
        {journeys.map(j => {
          const from = locations.find(l => l.id === j.fromLocationId);
          const to = locations.find(l => l.id === j.toLocationId);
          return <option key={j.id} value={j.id}>{from?.name || '?'} → {to?.name || '?'}</option>;
        })}
        <option value="__NEW__">+ Add route</option>
      </Select>

      {creating && (
        <div className="location-scope-field__between-row">
          <Select aria-label="From city" value={fromId} onChange={e => setFromId(e.target.value)}>
            <option value="">From…</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
          <span aria-hidden="true">→</span>
          <Select aria-label="To city" value={toId} onChange={e => setToId(e.target.value)}>
            <option value="">To…</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
          <button type="button" onClick={handleCreate} disabled={!fromId || !toId}>Add</button>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
