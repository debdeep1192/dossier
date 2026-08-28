import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getDestination } from '../../db/stores/destinations';
import { listTransportEntries, createTransportEntry, updateTransportEntry, deleteTransportEntry, emptyTransportEntry } from '../../db/stores/transport';
import { getCurrencyOptions, addDestinationCurrency } from '../../db/currency.js';
import { useCachedQuery, invalidateCachedQuery, invalidateCachedQueryPrefix } from '../../hooks/useCachedQuery';
import SectionPageLayout from '../../components/SectionPageLayout';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { Input, TextArea, Select } from '../../components/Field';
import { PriorityBadge } from '../../components/Badge';
import { MoneyField, MoneyDisplay } from '../../components/Money';
import { EmptyState, LoadingState, ErrorState } from '../../components/States';
import { TRANSPORT_MODES, TRANSPORT_DEFAULT_UNIT_BY_MODE, TRANSPORT_PRICE_UNITS } from '../../lib/priceUnits.js';

export default function TransportPage() {
  const { destinationId } = useParams();
  const [editing, setEditing] = useState(null);

  const fetcher = useCallback(async () => {
    const [destination, items] = await Promise.all([getDestination(destinationId), listTransportEntries(destinationId)]);
    return { destination, items };
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
    if (!window.confirm(`Delete "${item.from?.label || '?'} → ${item.to?.label || '?'}"?`)) return;
    await deleteTransportEntry(item.id);
    afterMutation();
  }

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading transport…" />;

  const { destination, items } = data;
  const currencies = getCurrencyOptions(destination);

  return (
    <SectionPageLayout destination={destination} destinationId={destinationId} title="Transport" onAdd={() => setEditing({})}>
      {items.length === 0 ? (
        <EmptyState icon="🚌" title="No transport routes yet" description="Add how to get between places — buses, trains, flights, taxis." actionLabel="+ Add" onAction={() => setEditing({})} />
      ) : (
        items.map(item => (
          <Card key={item.id} interactive padding="sm" accentColor="var(--color-neutral-500)" className="entry-card" onClick={() => setEditing(item)}>
            <div className="entry-card__main">
              <div className="entry-card__title-line">
                <span className="entry-card__title">{item.from?.label || '?'} → {item.to?.label || '?'}</span>
                <PriorityBadge priority={item.priority} />
              </div>
              {item.mode && <p className="entry-card__meta">{item.mode}{item.duration ? ` · ${item.duration}` : ''}</p>}
              {item.price && <p className="entry-card__meta"><MoneyDisplay money={item.price} /></p>}
            </div>
            <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); handleDelete(item); }}>Delete</button>
          </Card>
        ))
      )}

      {editing !== null && (
        <TransportForm destinationId={destinationId} record={editing.id ? editing : null} currencies={currencies} onAddCurrency={handleAddCurrency} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); afterMutation(); }} />
      )}
    </SectionPageLayout>
  );
}

function TransportForm({ destinationId, record, currencies, onAddCurrency, onClose, onSaved }) {
  const base = record || emptyTransportEntry();
  const [fromLabel, setFromLabel] = useState(base.from?.label || '');
  const [toLabel, setToLabel] = useState(base.to?.label || '');
  const [mode, setMode] = useState(base.mode || '');
  const [price, setPrice] = useState(base.price || null);
  const [duration, setDuration] = useState(base.duration || '');
  const [schedule, setSchedule] = useState(base.schedule || '');
  const [bookingNotes, setBookingNotes] = useState(base.bookingNotes || '');
  const [priority, setPriority] = useState(base.priority || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function handleModeChange(newMode) {
    setMode(newMode);
    // Only auto-set the unit when the price doesn't already have one —
    // never override something the person already chose or typed.
    const defaultUnit = TRANSPORT_DEFAULT_UNIT_BY_MODE[newMode];
    if (defaultUnit && (!price || !price.unit)) {
      setPrice(prev => ({ amount: prev?.amount ?? '', currency: prev?.currency ?? 'INR', unit: defaultUnit, note: prev?.note ?? '' }));
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!fromLabel.trim() || !toLabel.trim()) { setError('Both "From" and "To" are required.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fields = {
        from: { label: fromLabel.trim(), place: null },
        to: { label: toLabel.trim(), place: null },
        mode, price, duration, schedule, bookingNotes,
        priority: priority || null,
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
          <Input label="From" required value={fromLabel} onChange={e => setFromLabel(e.target.value)} placeholder="e.g. Colombo" />
          <Input label="To" required value={toLabel} onChange={e => setToLabel(e.target.value)} placeholder="e.g. Kandy" />
        </div>
        <Select label="Mode" value={mode} onChange={e => handleModeChange(e.target.value)}>
          <option value="">Choose a mode…</option>
          {TRANSPORT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
        </Select>
        <MoneyField value={price} onChange={setPrice} currencies={currencies} defaultCurrency="INR" unitOptions={TRANSPORT_PRICE_UNITS} defaultUnit={TRANSPORT_DEFAULT_UNIT_BY_MODE[mode] || 'Per person'} onAddCurrency={onAddCurrency} />
        <Input label="Duration" value={duration} onChange={e => setDuration(e.target.value)} placeholder="e.g. 3 hours" />
        <Input label="Schedule / frequency" value={schedule} onChange={e => setSchedule(e.target.value)} />
        <TextArea label="Booking notes" value={bookingNotes} onChange={e => setBookingNotes(e.target.value)} rows={2} />
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
