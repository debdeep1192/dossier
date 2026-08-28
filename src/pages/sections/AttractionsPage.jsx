import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getDestination } from '../../db/stores/destinations';
import { listAttractions, createAttraction, updateAttraction, deleteAttraction, emptyAttraction, normalizeAttraction } from '../../db/stores/attractions';
import { addDestinationCurrency, getCurrencyOptions } from '../../db/currency.js';
import { useCachedQuery, invalidateCachedQuery, invalidateCachedQueryPrefix } from '../../hooks/useCachedQuery';
import SectionPageLayout from '../../components/SectionPageLayout';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { Input, TextArea, Select } from '../../components/Field';
import { PriorityBadge } from '../../components/Badge';
import { PlaceField, PlaceSummary } from '../../components/Place';
import { MoneyField } from '../../components/Money';
import { FeeBandsField } from '../../components/FeeBands';
import { formatFeeBands } from '../../lib/feeBands.js';
import { OpeningHoursField } from '../../components/OpeningHours';
import { formatOpeningHours } from '../../lib/openingHours.js';
import { EmptyState, LoadingState, ErrorState } from '../../components/States';
import { ATTRACTION_CATEGORIES, BEST_TIME_OF_DAY_OPTIONS } from '../../lib/attractionOptions.js';

export default function AttractionsPage() {
  const { destinationId } = useParams();
  const [editing, setEditing] = useState(null);

  const fetcher = useCallback(async () => {
    const [destination, rawItems] = await Promise.all([getDestination(destinationId), listAttractions(destinationId)]);
    return { destination, items: rawItems.map(normalizeAttraction) };
  }, [destinationId]);
  const { data, error, loading, refresh } = useCachedQuery(`attractions:${destinationId}`, fetcher);

  function afterMutation() {
    invalidateCachedQuery(`attractions:${destinationId}`);
    invalidateCachedQueryPrefix(`destination:${destinationId}`);
    refresh();
  }

  async function handleAddCurrency(code) {
    await addDestinationCurrency(destinationId, code);
    invalidateCachedQuery(`destination:${destinationId}`);
    refresh();
  }

  async function handleDelete(item) {
    if (!window.confirm(`Delete "${item.place?.name || 'this entry'}"?`)) return;
    await deleteAttraction(item.id);
    afterMutation();
  }

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading attractions…" />;

  const { destination, items } = data;
  const currencies = getCurrencyOptions(destination);

  return (
    <SectionPageLayout destination={destination} destinationId={destinationId} title="Attractions & Activities" onAdd={() => setEditing({})}>
      {items.length === 0 ? (
        <EmptyState icon="🏛️" title="No attractions yet" description="Add sights, landmarks, tours, or experiences you're researching." actionLabel="+ Add" onAction={() => setEditing({})} />
      ) : (
        items.map(item => (
          <Card key={item.id} interactive padding="sm" accentColor="var(--color-teal)" className="entry-card" onClick={() => setEditing(item)}>
            <div className="entry-card__main">
              <div className="entry-card__title-line">
                <PlaceSummary place={item.place} destinationName={destination.name} />
                <PriorityBadge priority={item.priority} />
              </div>
              {item.category && <p className="entry-card__meta">{item.category}</p>}
              {formatFeeBands(item.feeBands) && <p className="entry-card__meta">{formatFeeBands(item.feeBands)}</p>}
              {formatOpeningHours(item.openingHours) && <p className="entry-card__meta">{formatOpeningHours(item.openingHours)}</p>}
              {item.typicallySpent && <p className="entry-card__meta">Typically spent: {item.typicallySpent}</p>}
            </div>
            <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); handleDelete(item); }}>Delete</button>
          </Card>
        ))
      )}

      {editing !== null && (
        <AttractionForm
          destinationId={destinationId}
          record={editing.id ? editing : null}
          currencies={currencies}
          onAddCurrency={handleAddCurrency}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); afterMutation(); }}
        />
      )}
    </SectionPageLayout>
  );
}

function AttractionForm({ destinationId, record, currencies, onAddCurrency, onClose, onSaved }) {
  const base = record || emptyAttraction();
  const [place, setPlace] = useState(base.place || {});
  const [category, setCategory] = useState(base.category || '');
  const [description, setDescription] = useState(base.description || '');
  const [feeBands, setFeeBands] = useState(base.feeBands || []);
  const [hasCameraCharge, setHasCameraCharge] = useState(Boolean(base.cameraCharge));
  const [cameraCharge, setCameraCharge] = useState(base.cameraCharge || null);
  const [hasVideographyCharge, setHasVideographyCharge] = useState(Boolean(base.videographyCharge));
  const [videographyCharge, setVideographyCharge] = useState(base.videographyCharge || null);
  const [openingHours, setOpeningHours] = useState(base.openingHours || []);
  const [typicallySpent, setTypicallySpent] = useState(base.typicallySpent || '');
  const [bestTimeOption, setBestTimeOption] = useState(base.bestTimeOfDay?.option || '');
  const [bestTimeNote, setBestTimeNote] = useState(base.bestTimeOfDay?.note || '');
  const [priority, setPriority] = useState(base.priority || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!place.name) { setError('Place name is required.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fields = {
        place, category, description,
        feeBands, cameraCharge: hasCameraCharge ? cameraCharge : null, videographyCharge: hasVideographyCharge ? videographyCharge : null,
        openingHours, typicallySpent,
        bestTimeOfDay: { option: bestTimeOption, note: bestTimeNote },
        priority: priority || null,
      };
      if (record) await updateAttraction(record.id, fields);
      else await createAttraction(destinationId, fields);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={record ? 'Edit Attraction' : 'New Attraction'}>
      <form onSubmit={handleSubmit}>
        <PlaceField value={place} onChange={setPlace} />
        <Select label="Category" value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">Choose a category…</option>
          {ATTRACTION_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </Select>

        <FeeBandsField bands={feeBands} onChange={setFeeBands} currencies={currencies} onAddCurrency={onAddCurrency} />

        <label className="attraction-form__toggle">
          <input type="checkbox" checked={hasCameraCharge} onChange={e => setHasCameraCharge(e.target.checked)} />
          <span>Camera charge</span>
        </label>
        {hasCameraCharge && <MoneyField label="" value={cameraCharge} onChange={setCameraCharge} currencies={currencies} onAddCurrency={onAddCurrency} />}

        <label className="attraction-form__toggle">
          <input type="checkbox" checked={hasVideographyCharge} onChange={e => setHasVideographyCharge(e.target.checked)} />
          <span>Videography charge</span>
        </label>
        {hasVideographyCharge && <MoneyField label="" value={videographyCharge} onChange={setVideographyCharge} currencies={currencies} onAddCurrency={onAddCurrency} />}

        <OpeningHoursField value={openingHours} onChange={setOpeningHours} />

        <Input label="Typically spent" value={typicallySpent} onChange={e => setTypicallySpent(e.target.value)} placeholder="e.g. 1-2 hours" hint="How long visitors normally spend here — not a fixed itinerary duration." />

        <Select label="Best time of day" value={bestTimeOption} onChange={e => setBestTimeOption(e.target.value)}>
          <option value="">Not specified</option>
          {BEST_TIME_OF_DAY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </Select>
        {bestTimeOption === 'Other' && <Input placeholder="Describe the best time" value={bestTimeNote} onChange={e => setBestTimeNote(e.target.value)} />}

        <TextArea label="Notes" value={description} onChange={e => setDescription(e.target.value)} rows={3} />

        <Select label="Priority" value={priority} onChange={e => setPriority(e.target.value)}>
          <option value="">No priority set</option>
          <option value="must_know">Must Know</option>
          <option value="useful">Useful</option>
          <option value="optional">Optional</option>
          <option value="reference">Reference</option>
        </Select>
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}
