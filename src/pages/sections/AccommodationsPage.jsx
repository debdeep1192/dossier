import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getDestination } from '../../db/stores/destinations';
import { listAccommodations, createAccommodation, updateAccommodation, deleteAccommodation, emptyAccommodation } from '../../db/stores/accommodations';
import { getCurrencyOptions, addDestinationCurrency } from '../../db/currency.js';
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
import { ACCOMMODATION_TYPES, ACCOMMODATION_PRICE_BASIS, ACCOMMODATION_DEFAULT_PRICE_BASIS } from '../../lib/priceUnits.js';

export default function AccommodationsPage() {
  const { destinationId } = useParams();
  const [editing, setEditing] = useState(null);

  const fetcher = useCallback(async () => {
    const [destination, items] = await Promise.all([getDestination(destinationId), listAccommodations(destinationId)]);
    return { destination, items };
  }, [destinationId]);
  const { data, error, loading, refresh } = useCachedQuery(`accommodations:${destinationId}`, fetcher);

  function afterMutation() {
    invalidateCachedQuery(`accommodations:${destinationId}`);
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
    await deleteAccommodation(item.id);
    afterMutation();
  }

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading accommodation…" />;

  const { destination, items } = data;
  const currencies = getCurrencyOptions(destination);

  return (
    <SectionPageLayout destination={destination} destinationId={destinationId} title="Accommodation" onAdd={() => setEditing({})}>
      {items.length === 0 ? (
        <EmptyState icon="🛏️" title="No accommodation yet" description="Add hotels, guesthouses, or homestays you're researching." actionLabel="+ Add" onAction={() => setEditing({})} />
      ) : (
        items.map(item => (
          <Card key={item.id} interactive padding="sm" accentColor="var(--color-saffron-dark)" className="entry-card" onClick={() => setEditing(item)}>
            <div className="entry-card__main">
              <div className="entry-card__title-line">
                <PlaceSummary place={item.place} destinationName={destination.name} />
                <PriorityBadge priority={item.priority} />
              </div>
              {item.accommodationType && <p className="entry-card__meta">{item.accommodationType}{item.roomType ? ` · ${item.roomType}` : ''}</p>}
              {item.price && <p className="entry-card__meta"><MoneyDisplay money={item.price} /></p>}
            </div>
            <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); handleDelete(item); }}>Delete</button>
          </Card>
        ))
      )}

      {editing !== null && (
        <AccommodationForm destinationId={destinationId} record={editing.id ? editing : null} currencies={currencies} onAddCurrency={handleAddCurrency} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); afterMutation(); }} />
      )}
    </SectionPageLayout>
  );
}

function AccommodationForm({ destinationId, record, currencies, onAddCurrency, onClose, onSaved }) {
  const base = record || emptyAccommodation();
  const [place, setPlace] = useState(base.place || {});
  const [accommodationType, setAccommodationType] = useState(base.accommodationType || '');
  const [price, setPrice] = useState(base.price || null);
  const [roomType, setRoomType] = useState(base.roomType || '');
  const [checkIn, setCheckIn] = useState(base.checkIn || '');
  const [checkOut, setCheckOut] = useState(base.checkOut || '');
  const [amenityNotes, setAmenityNotes] = useState(base.amenityNotes || '');
  const [priority, setPriority] = useState(base.priority || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!place.name) { setError('Place name is required.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fields = { place, accommodationType, price, roomType, checkIn, checkOut, amenityNotes, priority: priority || null };
      if (record) await updateAccommodation(record.id, fields);
      else await createAccommodation(destinationId, fields);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={record ? 'Edit Accommodation' : 'New Accommodation'}>
      <form onSubmit={handleSubmit}>
        <PlaceField value={place} onChange={setPlace} />
        <Select label="Type" value={accommodationType} onChange={e => setAccommodationType(e.target.value)}>
          <option value="">Choose a type…</option>
          {ACCOMMODATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </Select>
        <MoneyField
          label="Price"
          value={price}
          onChange={setPrice}
          currencies={currencies}
          defaultCurrency="INR"
          unitOptions={ACCOMMODATION_PRICE_BASIS}
          defaultUnit={ACCOMMODATION_DEFAULT_PRICE_BASIS}
          onAddCurrency={onAddCurrency}
        />
        <Input label="Room type" value={roomType} onChange={e => setRoomType(e.target.value)} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
          <Input label="Check-in" value={checkIn} onChange={e => setCheckIn(e.target.value)} placeholder="e.g. 2 PM" />
          <Input label="Check-out" value={checkOut} onChange={e => setCheckOut(e.target.value)} placeholder="e.g. 11 AM" />
        </div>
        <TextArea label="Amenity notes" value={amenityNotes} onChange={e => setAmenityNotes(e.target.value)} rows={2} />
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
