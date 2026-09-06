import { useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getDestination } from '../../db/stores/destinations';
import { listAttractions, createAttraction, updateAttraction, deleteAttraction, emptyAttraction, normalizeAttraction } from '../../db/stores/attractions';
import { listLocations, describeLocationContext } from '../../db/stores/locations';
import { listJourneys, describeJourney } from '../../db/stores/journeys';
import { addDestinationCurrency, getCurrencyOptions, getDestinationDefaultCurrency } from '../../db/currency.js';
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
import Disclosure from '../../components/Disclosure';
import { hasAdvancedContent } from '../../lib/formHelpers.js';
import { isMoneyEmpty } from '../../db/shared.js';
import LocationScopeField from '../../components/LocationScopeField';
import JourneyField from '../../components/JourneyField';
import OtherSelect from '../../components/OtherSelect';
import { CATEGORY_HINTS } from '../../lib/placeLookup.js';

export default function AttractionsPage() {
  const { destinationId } = useParams();
  const [searchParams] = useSearchParams();
  const contextLocationId = searchParams.get('location') || null;
  const [editing, setEditing] = useState(null);

  const fetcher = useCallback(async () => {
    const [destination, rawItems, locations, journeys] = await Promise.all([
      getDestination(destinationId), listAttractions(destinationId), listLocations(destinationId), listJourneys(destinationId),
    ]);
    return { destination, locations, journeys, items: rawItems.map(normalizeAttraction) };
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

  const { destination, locations, journeys, items } = data;
  const currencies = getCurrencyOptions(destination);
  const defaultCurrency = getDestinationDefaultCurrency(destination);
  const contextLocation = locations.find(l => l.id === contextLocationId) || null;
  // Items visible here: when scoped to a location, show that location's
  // records only; otherwise show everything for the destination
  // (whole-destination + every location + journey-linked records).
  const visibleItems = contextLocationId ? items.filter(i => i.locationId === contextLocationId) : items;

  return (
    <SectionPageLayout destination={destination} destinationId={destinationId} locationLabel={contextLocation?.name} title="Attractions & Activities" onAdd={() => setEditing({})}>
      {visibleItems.length === 0 ? (
        <EmptyState icon="🏛️" title="No attractions yet" description="Add sights, landmarks, tours, or experiences you're researching." actionLabel="+ Add" onAction={() => setEditing({})} />
      ) : (
        visibleItems.map(item => (
          <Card key={item.id} interactive padding="sm" accentColor="var(--color-teal)" className="entry-card" onClick={() => setEditing(item)}>
            <div className="entry-card__main">
              <div className="entry-card__title-line">
                <PlaceSummary place={item.place} destinationName={destination.name} />
                <PriorityBadge priority={item.priority} />
              </div>
              {!contextLocationId && locations.length > 0 && <p className="entry-card__meta">{describeLocationContext(item.locationId, locations)}</p>}
              {item.journeyId && <p className="entry-card__meta">{describeJourney(journeys.find(j => j.id === item.journeyId), locations)}</p>}
              {item.category && <p className="entry-card__meta">{item.category === 'Other' ? (item.categoryOther || 'Other') : item.category}</p>}
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
          destinationName={destination.name}
          record={editing.id ? editing : null}
          currencies={currencies}
          defaultCurrency={defaultCurrency}
          locations={locations}
          journeys={journeys}
          contextLocationId={contextLocationId}
          onAddCurrency={handleAddCurrency}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); afterMutation(); }}
        />
      )}
    </SectionPageLayout>
  );
}

// Per item 8 of the spec: no separate "identify -> confirm -> full
// form" staging, and no over-aggressive hiding of fields. The form
// shows its important initial fields (place, location context,
// category, notes) up front, Save is available immediately once a
// name is entered, and the rest of the relevant fields are directly
// visible on the same screen — nothing here requires saving and
// reopening the record to reach normal fields. Fee bands/camera &
// videography charges/opening hours are the one part still grouped
// under a disclosure, since those are genuinely secondary for most
// attractions (see Disclosure's defaultOpen logic below, which opens
// automatically whenever the record being edited already has that
// data — an already-detailed record is never shown collapsed).
//
// The Google Maps / place-identification step described in the spec
// is intentionally NOT implemented yet — that design (OSM-based
// suggestions + a Maps hand-off) is pending approval; the plain manual
// link field below is unchanged from Phase 1 in the meantime.
function AttractionForm({ destinationId, destinationName, record, currencies, defaultCurrency, locations, journeys, contextLocationId, onAddCurrency, onClose, onSaved }) {
  const base = record || emptyAttraction();
  const [place, setPlace] = useState(base.place || {});
  const [locationId, setLocationId] = useState(base.locationId ?? contextLocationId ?? null);
  const [journeyId, setJourneyId] = useState(base.journeyId || null);
  const [localJourneys, setLocalJourneys] = useState(journeys);
  const [category, setCategory] = useState(base.category || '');
  const [categoryOther, setCategoryOther] = useState(base.categoryOther || '');
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

  const advancedHasContent = hasAdvancedContent(
    formatFeeBands(base.feeBands),
    !isMoneyEmpty(base.cameraCharge),
    !isMoneyEmpty(base.videographyCharge),
    formatOpeningHours(base.openingHours),
    base.typicallySpent,
    base.bestTimeOfDay?.option,
  );

  async function refreshJourneys() {
    setLocalJourneys(await listJourneys(destinationId));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!place.name?.trim()) { setError('Enter a name.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fields = {
        place, locationId, journeyId, category, categoryOther: category === 'Other' ? categoryOther : '', description,
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
        <PlaceField
          value={place}
          onChange={setPlace}
          locationName={locations.find(l => l.id === locationId)?.name}
          destinationName={destinationName}
          expectedCategory={CATEGORY_HINTS.attraction}
        />
        <LocationScopeField locations={locations} value={locationId} onChange={setLocationId} lockedLocationId={record ? null : contextLocationId} />
        <JourneyField journeys={localJourneys} locations={locations} destinationId={destinationId} value={journeyId} onChange={setJourneyId} onJourneyCreated={refreshJourneys} />
        <OtherSelect label="Category" value={category} otherValue={categoryOther} onChange={setCategory} onOtherChange={setCategoryOther} options={ATTRACTION_CATEGORIES} />
        <TextArea label="Notes" value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="What's worth remembering about this place?" />
        <Input label="Typically spent" value={typicallySpent} onChange={e => setTypicallySpent(e.target.value)} placeholder="e.g. 1-2 hours" hint="How long visitors normally spend here." />
        <OtherSelect label="Best time of day" value={bestTimeOption} otherValue={bestTimeNote} onChange={setBestTimeOption} onOtherChange={setBestTimeNote} options={BEST_TIME_OF_DAY_OPTIONS} placeholder="Not specified" />
        <Select label="Priority" value={priority} onChange={e => setPriority(e.target.value)}>
          <option value="">No priority set</option>
          <option value="must_know">Must Know</option>
          <option value="useful">Useful</option>
          <option value="optional">Optional</option>
          <option value="reference">Reference</option>
        </Select>

        <Disclosure label="Fees & opening hours" defaultOpen={advancedHasContent}>
          <FeeBandsField bands={feeBands} onChange={setFeeBands} currencies={currencies} defaultCurrency={defaultCurrency} onAddCurrency={onAddCurrency} />

          <label className="attraction-form__toggle">
            <input type="checkbox" checked={hasCameraCharge} onChange={e => setHasCameraCharge(e.target.checked)} />
            <span>Camera charge</span>
          </label>
          {hasCameraCharge && <MoneyField label="" value={cameraCharge} onChange={setCameraCharge} currencies={currencies} defaultCurrency={defaultCurrency} onAddCurrency={onAddCurrency} />}

          <label className="attraction-form__toggle">
            <input type="checkbox" checked={hasVideographyCharge} onChange={e => setHasVideographyCharge(e.target.checked)} />
            <span>Videography charge</span>
          </label>
          {hasVideographyCharge && <MoneyField label="" value={videographyCharge} onChange={setVideographyCharge} currencies={currencies} defaultCurrency={defaultCurrency} onAddCurrency={onAddCurrency} />}

          <OpeningHoursField value={openingHours} onChange={setOpeningHours} />
        </Disclosure>

        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}
