import { useState } from 'react';
import { Select } from './Field';
import { createJourney } from '../db/stores/journeys.js';
import './LocationScopeField.css';

// Opt-in "along a journey between two cities" picker — item 7. Only
// sections that declare a `journeyId` field on their own shape use
// this (currently Transport and Attractions); it is NOT part of
// LocationScopeField or of every record's shared metadata.
//
// Props:
//   journeys    - the destination's Journey[] (from db/stores/journeys.js)
//   locations   - the destination's Location[] (needed to label each journey and to create a new one)
//   destinationId
//   value       - current journeyId, or null
//   onChange(nextJourneyId)
//   onJourneyCreated() - called after a new journey is created inline, so the
//                         caller can refetch its journeys list
export default function JourneyField({ journeys, locations, destinationId, value, onChange, onJourneyCreated }) {
  const [creating, setCreating] = useState(false);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [error, setError] = useState('');

  if (locations.length < 2) return null; // a journey needs two existing locations to choose between

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
        label="Along a journey (optional)"
        hint="Leave as 'Not a journey' unless this is something encountered while travelling between two cities."
        value={creating ? '__NEW__' : (value || '')}
        onChange={e => {
          if (e.target.value === '__NEW__') { setCreating(true); return; }
          setCreating(false);
          onChange(e.target.value || null);
        }}
      >
        <option value="">Not a journey</option>
        {journeys.map(j => {
          const from = locations.find(l => l.id === j.fromLocationId);
          const to = locations.find(l => l.id === j.toLocationId);
          return <option key={j.id} value={j.id}>{from?.name || '?'} → {to?.name || '?'}</option>;
        })}
        <option value="__NEW__">+ New journey…</option>
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
