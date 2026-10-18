import { useState, useMemo, useCallback } from 'react';
import { listAttractions } from '../db/stores/attractions';
import { listRestaurantEntries } from '../db/stores/restaurants';
import { listAccommodations } from '../db/stores/accommodations';
import { listTransportEntries } from '../db/stores/transport';
import { useCachedQuery } from '../hooks/useCachedQuery';
import { Input } from './Field';
import { VisitPriorityBadge, PriceTierBadge } from './Badge';
import { buildPickerSections, filterPickerSections, pickerSelectionFor } from '../lib/researchSummary';
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

// Display names and the per-category compact previews come from
// lib/researchSummary.js (the name fallbacks are the same ones each
// section page already uses for its own cards — centralized there
// because the picker renders all four section shapes in one flat
// list). Phase 3: each row now also carries a short preview built from
// fields the record already has (never invented, different per
// category) so similar entries can be told apart without opening each
// Research record. Previews are computed once per data load from the
// records this picker already fetched — no extra reads per row.

export default function ResearchPicker({ destinationId, onSelect }) {
  const [query, setQuery] = useState('');

  const fetcher = useCallback(async () => {
    const results = await Promise.all(REF_SECTIONS.map(s => s.list(destinationId)));
    return REF_SECTIONS.map((section, i) => ({ ...section, items: results[i] }));
  }, [destinationId]);
  const { data, loading } = useCachedQuery(`research-picker:${destinationId}`, fetcher);

  // Rows (label + preview) are built once per data load; typing in the
  // search box only re-filters them by name — exactly the previous
  // search behaviour, without rebuilding previews on every keystroke.
  const pickerSections = useMemo(() => buildPickerSections(data), [data]);
  const filtered = useMemo(() => filterPickerSections(pickerSections, query), [pickerSections, query]);

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
              {section.rows.map(row => (
                <button
                  key={row.item.id}
                  type="button"
                  className="research-picker__result"
                  onClick={() => onSelect(pickerSelectionFor(section.type, row))}
                >
                  <span className="research-picker__result-head">
                    <span className="research-picker__result-name">{row.label}</span>
                    {row.preview.badge?.kind === 'visitPriority' && <VisitPriorityBadge visitPriority={row.preview.badge.value} />}
                    {row.preview.badge?.kind === 'priceTier' && <PriceTierBadge priceTier={row.preview.badge.value} />}
                  </span>
                  {row.preview.parts.length > 0 && (
                    <span className="research-picker__result-preview">{row.preview.parts.join(' · ')}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
