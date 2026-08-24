import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getDestination } from '../../db/stores/destinations';
import { listAttractions, createAttraction, updateAttraction, deleteAttraction, emptyAttraction } from '../../db/stores/attractions';
import { useCachedQuery, invalidateCachedQuery, invalidateCachedQueryPrefix } from '../../hooks/useCachedQuery';
import SectionPageLayout from '../../components/SectionPageLayout';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { Input, TextArea, Select } from '../../components/Field';
import { PriorityBadge } from '../../components/Badge';
import { PlaceField, PlaceSummary } from '../../components/Place';
import { MoneyField, MoneyDisplay } from '../../components/Money';
import { EmptyState, LoadingState, ErrorState } from '../../components/States';

export default function AttractionsPage() {
  const { destinationId } = useParams();
  const [editing, setEditing] = useState(null); // null = closed, {} = new, record = editing

  const fetcher = useCallback(async () => {
    const [destination, items] = await Promise.all([getDestination(destinationId), listAttractions(destinationId)]);
    return { destination, items };
  }, [destinationId]);
  const { data, error, loading, refresh } = useCachedQuery(`attractions:${destinationId}`, fetcher);

  function afterMutation() {
    invalidateCachedQuery(`attractions:${destinationId}`);
    invalidateCachedQueryPrefix(`destination:${destinationId}`);
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
              {item.price && <p className="entry-card__meta"><MoneyDisplay money={item.price} /></p>}
            </div>
            <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); handleDelete(item); }}>Delete</button>
          </Card>
        ))
      )}

      {editing !== null && (
        <AttractionForm
          destinationId={destinationId}
          record={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); afterMutation(); }}
        />
      )}
    </SectionPageLayout>
  );
}

function AttractionForm({ destinationId, record, onClose, onSaved }) {
  const base = record || emptyAttraction();
  const [place, setPlace] = useState(base.place || {});
  const [category, setCategory] = useState(base.category || '');
  const [description, setDescription] = useState(base.description || '');
  const [price, setPrice] = useState(base.price || null);
  const [openingHours, setOpeningHours] = useState(base.openingHours || '');
  const [typicalDurationMinutes, setTypicalDurationMinutes] = useState(base.typicalDurationMinutes || '');
  const [bestTimeOfDay, setBestTimeOfDay] = useState(base.bestTimeOfDay || '');
  const [priority, setPriority] = useState(base.priority || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!place.name) { setError('Place name is required.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fields = { place, category, description, price, openingHours, typicalDurationMinutes, bestTimeOfDay, priority: priority || null };
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
        <Input label="Category" value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. landmark, hike, museum, tour" />
        <TextArea label="Description" value={description} onChange={e => setDescription(e.target.value)} rows={3} />
        <MoneyField label="Entry fee" value={price} onChange={setPrice} />
        <Input label="Opening hours" value={openingHours} onChange={e => setOpeningHours(e.target.value)} placeholder="e.g. 8 AM – 6 PM" />
        <Input label="Typical duration (minutes)" type="number" min="0" value={typicalDurationMinutes} onChange={e => setTypicalDurationMinutes(e.target.value)} />
        <Input label="Best time of day" value={bestTimeOfDay} onChange={e => setBestTimeOfDay(e.target.value)} placeholder="e.g. sunset" />
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
