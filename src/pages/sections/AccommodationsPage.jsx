import { useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getDestination } from '../../db/stores/destinations';
import { listAccommodations, createAccommodation, updateAccommodation, deleteAccommodation, emptyAccommodation } from '../../db/stores/accommodations';
import { listLocations, describeLocationContext } from '../../db/stores/locations';
import { getCurrencyOptions, getDestinationDefaultCurrency, addDestinationCurrency } from '../../db/currency.js';
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
import Disclosure from '../../components/Disclosure';
import { hasAdvancedContent } from '../../lib/formHelpers.js';
import { isMoneyEmpty } from '../../db/shared.js';
import OtherSelect from '../../components/OtherSelect';
import { CATEGORY_HINTS } from '../../lib/placeLookup.js';
import LocationScopeField from '../../components/LocationScopeField';

export default function AccommodationsPage() {
  const { destinationId } = useParams();
  const [searchParams] = useSearchParams();
  const contextLocationId = searchParams.get('location') || null;
  const [editing, setEditing] = useState(null);

  const fetcher = useCallback(async () => {
    const [destination, items, locations] = await Promise.all([getDestination(destinationId), listAccommodations(destinationId), listLocations(destinationId)]);
    return { destination, items, locations };
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

  const { destination, items, locations } = data;
  const currencies = getCurrencyOptions(destination);
  const defaultCurrency = getDestinationDefaultCurrency(destination);
  const contextLocation = locations.find(l => l.id === contextLocationId) || null;
  const visibleItems = contextLocationId ? items.filter(i => i.locationId === contextLocationId) : items;

  return (
    <SectionPageLayout destination={destination} destinationId={destinationId} locationLabel={contextLocation?.name} title="Accommodation" onAdd={() => setEditing({})}>
      {visibleItems.length === 0 ? (
        <EmptyState icon="🛏️" title="No accommodation yet" description="Add hotels, guesthouses, or homestays you're researching." actionLabel="+ Add" onAction={() => setEditing({})} />
      ) : (
        visibleItems.map(item => (
          <Card key={item.id} interactive padding="sm" accentColor="var(--color-saffron-dark)" className="entry-card" onClick={() => setEditing(item)}>
            <div className="entry-card__main">
              <div className="entry-card__title-line">
                <PlaceSummary place={item.place} destinationName={destination.name} />
                <PriorityBadge priority={item.priority} />
              </div>
              {!contextLocationId && locations.length > 0 && <p className="entry-card__meta">{describeLocationContext(item.locationId, locations)}</p>}
              {item.accommodationType && <p className="entry-card__meta">{item.accommodationType === 'Other' ? (item.accommodationTypeOther || 'Other') : item.accommodationType}{item.roomType ? ` · ${item.roomType}` : ''}</p>}
              {item.price && <p className="entry-card__meta"><MoneyDisplay money={item.price} /></p>}
            </div>
            <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); handleDelete(item); }}>Delete</button>
          </Card>
        ))
      )}

      {editing !== null && (
        <AccommodationForm destinationId={destinationId} destinationName={destination.name} record={editing.id ? editing : null} currencies={currencies} defaultCurrency={defaultCurrency} locations={locations} contextLocationId={contextLocationId} onAddCurrency={handleAddCurrency} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); afterMutation(); }} />
      )}
    </SectionPageLayout>
  );
}

function AccommodationForm({ destinationId, destinationName, record, currencies, defaultCurrency, locations, contextLocationId, onAddCurrency, onClose, onSaved }) {
  const base = record || emptyAccommodation();
  const [place, setPlace] = useState(base.place || {});
  const [locationId, setLocationId] = useState(base.locationId ?? contextLocationId ?? null);
  const [accommodationType, setAccommodationType] = useState(base.accommodationType || '');
  const [accommodationTypeOther, setAccommodationTypeOther] = useState(base.accommodationTypeOther || '');
  const [price, setPrice] = useState(base.price || null);
  const [roomType, setRoomType] = useState(base.roomType || '');
  const [checkIn, setCheckIn] = useState(base.checkIn || '');
  const [checkOut, setCheckOut] = useState(base.checkOut || '');
  const [amenityNotes, setAmenityNotes] = useState(base.amenityNotes || '');
  const [priority, setPriority] = useState(base.priority || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const advancedHasContent = hasAdvancedContent(
    !isMoneyEmpty(base.price),
    base.roomType,
    base.checkIn,
    base.checkOut,
    base.priority,
  );

  async function handleSubmit(e) {
    e.preventDefault();
    if (!place.name) { setError('Place name is required.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fields = { place, locationId, accommodationType, accommodationTypeOther: accommodationType === 'Other' ? accommodationTypeOther : '', price, roomType, checkIn, checkOut, amenityNotes, priority: priority || null };
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
        <PlaceField
          value={place}
          onChange={setPlace}
          locationName={locations.find(l => l.id === locationId)?.name}
          destinationName={destinationName}
          expectedCategory={CATEGORY_HINTS.accommodation}
        />
        <LocationScopeField locations={locations} value={locationId} onChange={setLocationId} lockedLocationId={record ? null : contextLocationId} />
        <OtherSelect label="Type" value={accommodationType} otherValue={accommodationTypeOther} onChange={setAccommodationType} onOtherChange={setAccommodationTypeOther} options={ACCOMMODATION_TYPES} />
        <TextArea label="Amenity notes" value={amenityNotes} onChange={e => setAmenityNotes(e.target.value)} rows={2} placeholder="A quick note is enough to save this — add price, room type, and other details below if you have them." />

        <Disclosure label="Add more details" defaultOpen={advancedHasContent}>
          <MoneyField
            label="Price"
            value={price}
            onChange={setPrice}
            currencies={currencies}
            defaultCurrency={defaultCurrency}
            unitOptions={ACCOMMODATION_PRICE_BASIS}
            defaultUnit={ACCOMMODATION_DEFAULT_PRICE_BASIS}
            onAddCurrency={onAddCurrency}
          />
          <Input label="Room type" value={roomType} onChange={e => setRoomType(e.target.value)} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
            <Input label="Check-in" value={checkIn} onChange={e => setCheckIn(e.target.value)} placeholder="e.g. 2 PM" />
            <Input label="Check-out" value={checkOut} onChange={e => setCheckOut(e.target.value)} placeholder="e.g. 11 AM" />
          </div>
          <Select label="Priority" value={priority} onChange={e => setPriority(e.target.value)}>
            <option value="">No priority set</option>
            <option value="must_know">Must Know</option>
            <option value="useful">Useful</option>
            <option value="optional">Optional</option>
            <option value="reference">Reference</option>
          </Select>
        </Disclosure>

        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}
