import { useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAutoOpenNewForm } from '../../hooks/useAutoOpenNewForm';
import { getDestination } from '../../db/stores/destinations';
import { listTransportEntries, createTransportEntry, updateTransportEntry, deleteTransportEntry, emptyTransportEntry, normalizeTransportEntry } from '../../db/stores/transport';
import { listLocations, describeLocationContext } from '../../db/stores/locations';
import { listJourneys, describeJourney } from '../../db/stores/journeys';
import { getCurrencyOptions, getDestinationDefaultCurrency, addDestinationCurrency } from '../../db/currency.js';
import { useCachedQuery, invalidateCachedQuery, invalidateCachedQueryPrefix } from '../../hooks/useCachedQuery';
import SectionPageLayout from '../../components/SectionPageLayout';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { Input, TextArea, Select } from '../../components/Field';
import { MoneyField, MoneyDisplay } from '../../components/Money';
import { EmptyState, LoadingState, ErrorState } from '../../components/States';
import { TRANSPORT_MODES, TRANSPORT_DEFAULT_UNIT_BY_MODE, TRANSPORT_PRICE_UNITS } from '../../lib/priceUnits.js';
import Disclosure from '../../components/Disclosure';
import { hasAdvancedContent } from '../../lib/formHelpers.js';
import { isMoneyEmpty } from '../../db/shared.js';
import LocationScopeField from '../../components/LocationScopeField';
import RouteField from '../../components/RouteField';
import OtherSelect from '../../components/OtherSelect';

export default function TransportPage() {
  const { destinationId } = useParams();
  const [searchParams] = useSearchParams();
  const contextLocationId = searchParams.get('location') || null;
  const [editing, setEditing] = useState(null);
  useAutoOpenNewForm(setEditing);

  const fetcher = useCallback(async () => {
    const [destination, rawItems, locations, journeys] = await Promise.all([
      getDestination(destinationId), listTransportEntries(destinationId), listLocations(destinationId), listJourneys(destinationId),
    ]);
    return { destination, locations, journeys, items: rawItems.map(normalizeTransportEntry) };
  }, [destinationId]);
  const { data, error, loading, refresh } = useCachedQuery(`transport:${destinationId}`, fetcher);

  function afterMutation() {
    invalidateCachedQuery(`transport:${destinationId}`);
    invalidateCachedQueryPrefix(`destination:${destinationId}`);
    refresh();
  }

  async function handleAddCurrency(code) {
    await addDestinationCurrency(destinationId, code);
    invalidateCachedQuery(`destination:${destinationId}`);
    refresh();
  }

  async function handleDelete(item) {
    const label = item.travelType === 'local' ? 'this local transport note' : `"${item.from?.label || '?'} → ${item.to?.label || '?'}"`;
    if (!window.confirm(`Delete ${label}?`)) return;
    await deleteTransportEntry(item.id);
    afterMutation();
  }

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading transport…" />;

  const { destination, locations, journeys, items } = data;
  const currencies = getCurrencyOptions(destination);
  const defaultCurrency = getDestinationDefaultCurrency(destination);
  const contextLocation = locations.find(l => l.id === contextLocationId) || null;
  const visibleItems = contextLocationId ? items.filter(i => i.locationId === contextLocationId) : items;

  return (
    <SectionPageLayout destination={destination} destinationId={destinationId} locationLabel={contextLocation?.name} title="Transport">
      {visibleItems.length === 0 ? (
        <EmptyState icon="🚌" title="No transport yet" description="Use the + button below to add how to get between places, or how to get around locally — buses, trains, flights, taxis, local apps." />
      ) : (
        visibleItems.map(item => (
          <Card key={item.id} interactive padding="sm" accentColor="var(--color-neutral-500)" className="entry-card" onClick={() => setEditing(item)}>
            <div className="entry-card__main">
              <div className="entry-card__title-line">
                <span className="entry-card__title">
                  {item.travelType === 'local'
                    ? `Local transport${!contextLocationId ? ` — ${describeLocationContext(item.locationId, locations)}` : ''}`
                    : `${locations.find(l => l.id === item.fromLocationId)?.name || item.from?.label || '?'} → ${locations.find(l => l.id === item.toLocationId)?.name || item.to?.label || '?'}`}
                </span>
              </div>
              {item.journeyId && <p className="entry-card__meta">{describeJourney(journeys.find(j => j.id === item.journeyId), locations)}</p>}
              {item.mode && <p className="entry-card__meta">{item.mode === 'Other' ? (item.modeOther || 'Other') : item.mode}{item.duration ? ` · ${item.duration}` : ''}</p>}
              {item.price && <p className="entry-card__meta"><MoneyDisplay money={item.price} /></p>}
            </div>
            <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); handleDelete(item); }}>Delete</button>
          </Card>
        ))
      )}

      {editing !== null && (
        <TransportForm
          destinationId={destinationId}
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

// Basic identifying fields (travel type, from/to or location, mode) are
// always visible and Save is available immediately — per item G, no
// forced multi-step wizard and no save-then-reopen-to-fill-fields.
// Price/duration/schedule/priority stay behind one disclosure since
// they're genuinely secondary for a first pass, matching the same
// judgment already applied to Attractions/Accommodation.
function TransportForm({ destinationId, record, currencies, defaultCurrency, locations, journeys, contextLocationId, onAddCurrency, onClose, onSaved }) {
  const base = record || emptyTransportEntry();
  const [travelType, setTravelType] = useState(base.travelType || 'inter_city');
  const [fromLocationId, setFromLocationId] = useState(base.fromLocationId || '');
  const [toLocationId, setToLocationId] = useState(base.toLocationId || '');
  const [locationId, setLocationId] = useState(base.locationId ?? contextLocationId ?? null);
  const [journeyId, setJourneyId] = useState(base.journeyId || null);
  const [mode, setMode] = useState(base.mode || '');
  const [modeOther, setModeOther] = useState(base.modeOther || '');
  const [price, setPrice] = useState(base.price || null);
  const [duration, setDuration] = useState(base.duration || '');
  const [schedule, setSchedule] = useState(base.schedule || '');
  const [bookingNotes, setBookingNotes] = useState(base.bookingNotes || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [journeyListVersion, setJourneyListVersion] = useState(0); // bumped after creating a route inline, so RouteField's options refresh next render
  const [localJourneys, setLocalJourneys] = useState(journeys);

  // A legacy record's endpoints may be free-text labels with no real
  // fromLocationId/toLocationId at all (saved before Chunk 6). Editing
  // such a record still shows its original labels for reference, but
  // going forward the only way to SET an inter-city endpoint is by
  // picking a real location — see the <Select>s below. This is a
  // read-only fallback display, never a second way to enter free text.
  const legacyFromLabel = !fromLocationId && base.from?.label ? base.from.label : null;
  const legacyToLabel = !toLocationId && base.to?.label ? base.to.label : null;
  const selectedFromName = locations.find(l => l.id === fromLocationId)?.name;
  const selectedToName = locations.find(l => l.id === toLocationId)?.name;

  const advancedHasContent = hasAdvancedContent(
    !isMoneyEmpty(base.price),
    base.duration,
    base.schedule,
  );

  function handleModeChange(newMode) {
    setMode(newMode);
    // Only auto-set the unit when the price doesn't already have one —
    // never override something the person already chose or typed.
    const defaultUnit = TRANSPORT_DEFAULT_UNIT_BY_MODE[newMode];
    if (defaultUnit && (!price || !price.unit)) {
      setPrice(prev => ({ amount: prev?.amount ?? '', currency: prev?.currency ?? defaultCurrency, unit: defaultUnit, note: prev?.note ?? '' }));
    }
  }

  async function refreshJourneys() {
    const fresh = await listJourneys(destinationId);
    setLocalJourneys(fresh);
    setJourneyListVersion(v => v + 1);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (travelType !== 'local') {
      const hasFrom = fromLocationId || legacyFromLabel;
      const hasTo = toLocationId || legacyToLabel;
      if (!hasFrom || !hasTo) { setError('Choose both a "From" and a "To" city.'); return; }
      if (fromLocationId && toLocationId && fromLocationId === toLocationId) { setError('"From" and "To" must be different cities.'); return; }
    }
    setError('');
    setSubmitting(true);
    try {
      const fromName = locations.find(l => l.id === fromLocationId)?.name;
      const toName = locations.find(l => l.id === toLocationId)?.name;
      const fields = {
        travelType,
        from: travelType === 'local' ? { label: '', place: null } : { label: fromName || legacyFromLabel || '', place: null },
        to: travelType === 'local' ? { label: '', place: null } : { label: toName || legacyToLabel || '', place: null },
        fromLocationId: travelType === 'local' ? null : (fromLocationId || null),
        toLocationId: travelType === 'local' ? null : (toLocationId || null),
        locationId: travelType === 'local' ? locationId : null,
        journeyId,
        mode, modeOther: mode === 'Other' ? modeOther : '', price, duration, schedule, bookingNotes,
      };
      if (record) await updateTransportEntry(record.id, fields);
      else await createTransportEntry(destinationId, fields);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={record ? 'Edit Transport' : 'New Transport'}>
      <form onSubmit={handleSubmit}>
        <Select label="Type" value={travelType} onChange={e => setTravelType(e.target.value)}>
          <option value="inter_city">Inter-city / route (From → To)</option>
          <option value="local">Local transport (getting around one place)</option>
        </Select>

        {travelType === 'local' ? (
          <LocationScopeField locations={locations} value={locationId} onChange={setLocationId} lockedLocationId={record ? null : contextLocationId} />
        ) : locations.length < 2 ? (
          <p className="form-error" role="alert">Add at least two cities/locations to this destination before creating inter-city transport.</p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
              <Select label="From" value={fromLocationId} onChange={e => setFromLocationId(e.target.value)}>
                <option value="">{legacyFromLabel ? `${legacyFromLabel} (choose a city)` : 'Choose a city…'}</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
              <Select label="To" value={toLocationId} onChange={e => setToLocationId(e.target.value)}>
                <option value="">{legacyToLabel ? `${legacyToLabel} (choose a city)` : 'Choose a city…'}</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </div>
            {(legacyFromLabel || legacyToLabel) && (
              <p className="entry-card__meta" style={{ marginTop: 'calc(-1 * var(--space-2))', marginBottom: 'var(--space-2)' }}>
                Originally saved as "{legacyFromLabel || selectedFromName}" → "{legacyToLabel || selectedToName}". Pick cities above to link this to real locations.
              </p>
            )}
            <RouteField key={journeyListVersion} journeys={localJourneys} locations={locations} destinationId={destinationId} value={journeyId} onChange={setJourneyId} onJourneyCreated={refreshJourneys} />
          </>
        )}

        <OtherSelect label="Mode" value={mode} otherValue={modeOther} onChange={handleModeChange} onOtherChange={setModeOther} options={TRANSPORT_MODES} />
        <TextArea label="Booking notes" value={bookingNotes} onChange={e => setBookingNotes(e.target.value)} rows={2} placeholder="A quick note is enough to save this — add price, duration, and schedule below if you have them." />

        <Disclosure label="Price, duration & schedule" defaultOpen={advancedHasContent}>
          <MoneyField value={price} onChange={setPrice} currencies={currencies} defaultCurrency={defaultCurrency} unitOptions={TRANSPORT_PRICE_UNITS} defaultUnit={TRANSPORT_DEFAULT_UNIT_BY_MODE[mode] || 'Per person'} onAddCurrency={onAddCurrency} />
          <Input label="Duration" value={duration} onChange={e => setDuration(e.target.value)} placeholder="e.g. 3 hours" />
          <Input label="Schedule / frequency" value={schedule} onChange={e => setSchedule(e.target.value)} />
        </Disclosure>

        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}
