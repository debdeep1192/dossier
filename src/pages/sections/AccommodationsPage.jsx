import { useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAutoOpenNewForm } from '../../hooks/useAutoOpenNewForm';
import { getDestination } from '../../db/stores/destinations';
import { listAccommodations, createAccommodation, updateAccommodation, deleteAccommodation, emptyAccommodation, normalizeAccommodation, emptyExtraPersonCharge, ACCOMMODATION_AMENITIES } from '../../db/stores/accommodations';
import { listLocations, describeLocationContext } from '../../db/stores/locations';
import { getCurrencyOptions, getDestinationDefaultCurrency, addDestinationCurrency } from '../../db/currency.js';
import { useCachedQuery, invalidateCachedQuery, invalidateCachedQueryPrefix } from '../../hooks/useCachedQuery';
import SectionPageLayout from '../../components/SectionPageLayout';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { Input, TextArea } from '../../components/Field';
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
import './AccommodationsPage.css';

export default function AccommodationsPage() {
  const { destinationId } = useParams();
  const [searchParams] = useSearchParams();
  const contextLocationId = searchParams.get('location') || null;
  const [editing, setEditing] = useState(null);
  useAutoOpenNewForm(setEditing);

  const fetcher = useCallback(async () => {
    const [destination, rawItems, locations] = await Promise.all([getDestination(destinationId), listAccommodations(destinationId), listLocations(destinationId)]);
    return { destination, items: rawItems.map(normalizeAccommodation), locations };
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
    <SectionPageLayout destination={destination} destinationId={destinationId} locationLabel={contextLocation?.name} title="Accommodation">
      {visibleItems.length === 0 ? (
        <EmptyState icon="🛏️" title="No accommodation yet" description="Use the + button below to add hotels, guesthouses, or homestays you're researching." />
      ) : (
        visibleItems.map(item => (
          <Card key={item.id} interactive padding="sm" accentColor="var(--color-saffron-dark)" className="entry-card" onClick={() => setEditing(item)}>
            <div className="entry-card__main">
              <div className="entry-card__title-line">
                <PlaceSummary place={item.place} destinationName={destination.name} />
              </div>
              {!contextLocationId && locations.length > 0 && <p className="entry-card__meta">{describeLocationContext(item.locationId, locations)}</p>}
              {item.accommodationType && <p className="entry-card__meta">{item.accommodationType === 'Other' ? (item.accommodationTypeOther || 'Other') : item.accommodationType}{item.roomType ? ` · ${item.roomType}` : ''}</p>}
              {item.price && <p className="entry-card__meta"><MoneyDisplay money={item.price} /></p>}
              {item.amenities.length > 0 && <p className="entry-card__meta">{item.amenities.join(' · ')}</p>}
              {item.extraPersonCharges.length > 0 && (
                <p className="entry-card__meta">
                  {item.extraPersonCharges.map((c, i) => (
                    <span key={i}>{i > 0 && ', '}{c.label || 'Extra person'}: <MoneyDisplay money={c.price} /></span>
                  ))}
                </p>
              )}
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
  const [amenities, setAmenities] = useState(base.amenities || []);
  const [extraPersonCharges, setExtraPersonCharges] = useState(base.extraPersonCharges && base.extraPersonCharges.length > 0 ? base.extraPersonCharges : []);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const advancedHasContent = hasAdvancedContent(
    !isMoneyEmpty(base.price),
    base.roomType,
    base.checkIn,
    base.checkOut,
    (base.amenities || []).length > 0,
    (base.extraPersonCharges || []).length > 0,
  );

  function toggleAmenity(amenity) {
    setAmenities(prev => prev.includes(amenity) ? prev.filter(a => a !== amenity) : [...prev, amenity]);
  }

  function addExtraPersonCharge() {
    setExtraPersonCharges(prev => [...prev, emptyExtraPersonCharge()]);
  }

  function updateExtraPersonCharge(index, patch) {
    setExtraPersonCharges(prev => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function removeExtraPersonCharge(index) {
    setExtraPersonCharges(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!place.name) { setError('Place name is required.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fields = { place, locationId, accommodationType, accommodationTypeOther: accommodationType === 'Other' ? accommodationTypeOther : '', price, roomType, checkIn, checkOut, amenityNotes, amenities, extraPersonCharges };
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

          <div className="field">
            <span className="field__label">Amenities</span>
            <div className="accommodation-form__amenities">
              {ACCOMMODATION_AMENITIES.map(amenity => (
                <label key={amenity} className="field field--checkbox">
                  <input type="checkbox" checked={amenities.includes(amenity)} onChange={() => toggleAmenity(amenity)} />
                  <span>{amenity}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field__label">Extra-person charges (optional)</span>
            {extraPersonCharges.map((charge, i) => (
              <div key={i} className="accommodation-form__extra-charge-row">
                <Input placeholder="e.g. Extra adult" value={charge.label} onChange={e => updateExtraPersonCharge(i, { label: e.target.value })} />
                <MoneyField value={charge.price} onChange={price => updateExtraPersonCharge(i, { price })} currencies={currencies} defaultCurrency={defaultCurrency} unitOptions={ACCOMMODATION_PRICE_BASIS} defaultUnit={ACCOMMODATION_DEFAULT_PRICE_BASIS} onAddCurrency={onAddCurrency} />
                <button type="button" className="accommodation-form__remove-charge" onClick={() => removeExtraPersonCharge(i)} aria-label="Remove this charge">✕</button>
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={addExtraPersonCharge}>+ Add extra-person charge</Button>
          </div>
        </Disclosure>

        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}
