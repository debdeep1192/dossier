import { useState, useMemo, useCallback } from 'react';
import { listAttractions } from '../db/stores/attractions';
import { listRestaurantEntries, isPlaceBased } from '../db/stores/restaurants';
import { listAccommodations } from '../db/stores/accommodations';
import { listTransportEntries } from '../db/stores/transport';
import { useCachedQuery } from '../hooks/useCachedQuery';
import { Input } from './Field';
import { LoadingState } from './States';
import './ResearchPicker.css';

// A simple, destination-scoped search across the Research sections that
// are meaningful as itinerary content (Tour Planning, Chunk 2) —
// Attractions, Restaurants, Accommodations, Transport. Deliberately NOT
// a general-purpose search system: it only ever queries these four
// existing list functions for one destination, filters client-side by
// name (this is personal, single-destination data — a handful of
// records per section, never enough to need a real search index), and
// returns a plain {researchRefType, researchRefId, label} the caller
// attaches to a timeline item. No new store, no fuzzy/ranked search, no
// cross-destination search.
const REF_SECTIONS = [
  { type: 'attractions', label: 'Attractions', list: listAttractions },
  { type: 'restaurants', label: 'Restaurants', list: listRestaurantEntries },
  { type: 'accommodations', label: 'Accommodation', list: listAccommodations },
  { type: 'transport', label: 'Transport', list: listTransportEntries },
];

// Mirrors the exact display-name fallback each section page already
// uses for its own cards (RestaurantsPage: place?.name || dishName ||
// 'Restaurant'; TransportPage: from/to labels) — not a new naming
// convention, just centralized here since the picker needs to render
// all four section shapes in one flat list.
function describeResearchItem(type, record) {
  switch (type) {
    case 'attractions':
    case 'accommodations':
      return record.place?.name || 'Untitled';
    case 'restaurants':
      return isPlaceBased(record) ? (record.place?.name || 'Untitled') : (record.dishName || 'Food note');
    case 'transport': {
      if (record.travelType === 'local') return `Local transport${record.mode ? ` — ${record.mode}` : ''}`;
      const from = record.from?.label || '?';
      const to = record.to?.label || '?';
      return `${from} → ${to}`;
    }
    default:
      return 'Untitled';
  }
}

export default function ResearchPicker({ destinationId, onSelect }) {
  const [query, setQuery] = useState('');

  const fetcher = useCallback(async () => {
    const results = await Promise.all(REF_SECTIONS.map(s => s.list(destinationId)));
    return REF_SECTIONS.map((section, i) => ({ ...section, items: results[i] }));
  }, [destinationId]);
  const { data, loading } = useCachedQuery(`research-picker:${destinationId}`, fetcher);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data
      .map(section => ({
        ...section,
        items: section.items
          .map(item => ({ item, label: describeResearchItem(section.type, item) }))
          .filter(({ label }) => !q || label.toLowerCase().includes(q)),
      }))
      .filter(section => section.items.length > 0);
  }, [data, query]);

  if (loading && !data) return <LoadingState label="Loading Research…" />;

  return (
    <div className="research-picker">
      <Input
        label="Search Research"
        placeholder="Search attractions, restaurants, accommodation, transport…"
        autoFocus
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      {filtered.length === 0 ? (
        <p className="research-picker__empty">
          {query.trim() ? 'No matching Research items.' : 'No Attractions, Restaurants, Accommodation, or Transport recorded yet for this destination.'}
        </p>
      ) : (
        <div className="research-picker__results">
          {filtered.map(section => (
            <div key={section.type} className="research-picker__section">
              <span className="research-picker__section-label">{section.label}</span>
              {section.items.map(({ item, label }) => (
                <button
                  key={item.id}
                  type="button"
                  className="research-picker__result"
                  onClick={() => onSelect({ researchRefType: section.type, researchRefId: item.id, label })}
                >
                  {label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
