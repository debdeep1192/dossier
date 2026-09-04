import { useState, useCallback, useEffect } from 'react';
import { QUICK_ADD_TYPES } from '../quickAddRegistry.js';
import { listDestinations } from '../db/stores/destinations.js';
import { listLocations } from '../db/stores/locations.js';
import { invalidateCachedQueryPrefix } from '../hooks/useCachedQuery';
import Modal from './Modal';
import Button from './Button';
import Card from './Card';
import { Input, TextArea, Select } from './Field';
import './QuickAdd.css';

// The universal "+ Add to Dossier" flow:
//   1. What are you adding?      (type picker, driven by quickAddRegistry.js)
//   2. Destination (+ Location, only if that destination has any)
//   3. Minimal adaptive form -> Save immediately
//
// Every step reuses the SAME create* function each section's own full
// page already calls (see quickAddRegistry.js) — a quick-captured
// record is created exactly the same way a fully-filled-in one is.
// This component only decides WHAT gets asked for up front; it does
// not define a second record shape.
export default function QuickAdd({ open, onClose, initialDestinationId, initialLocationId, onSaved }) {
  const [step, setStep] = useState('type'); // 'type' | 'context' | 'form'
  const [selectedType, setSelectedType] = useState(null);

  function reset() {
    setStep('type');
    setSelectedType(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleSelectType(type) {
    setSelectedType(type);
    setStep(initialDestinationId ? 'form' : 'context');
  }

  function handleSaved(destinationId) {
    invalidateCachedQueryPrefix(`destination:${destinationId}`);
    invalidateCachedQueryPrefix(`${selectedType.key}:${destinationId}`);
    reset();
    onSaved?.(destinationId);
  }

  if (!open) return null;

  return (
    <Modal open={open} onClose={handleClose} title="Add to Dossier">
      {step === 'type' && <TypeStep onSelect={handleSelectType} />}
      {step === 'context' && selectedType && (
        <ContextStep
          onBack={() => setStep('type')}
          onContinue={(ctx) => { setStep('form'); setSelectedType(t => ({ ...t, _context: ctx })); }}
        />
      )}
      {step === 'form' && selectedType && (
        <FormStep
          type={selectedType}
          destinationId={initialDestinationId || selectedType._context?.destinationId}
          locationId={initialLocationId !== undefined ? initialLocationId : selectedType._context?.locationId}
          onBack={initialDestinationId ? null : () => setStep('context')}
          onSaved={handleSaved}
        />
      )}
    </Modal>
  );
}

function TypeStep({ onSelect }) {
  return (
    <div className="quick-add__type-grid">
      {QUICK_ADD_TYPES.map(t => (
        <Card key={t.key} interactive padding="sm" className="quick-add__type-tile" onClick={() => onSelect(t)}>
          <span className="quick-add__type-icon" aria-hidden="true">{t.icon}</span>
          <span className="quick-add__type-label">{t.label}</span>
        </Card>
      ))}
    </div>
  );
}

function ContextStep({ onBack, onContinue }) {
  const [destinations, setDestinations] = useState(null);
  const [destinationId, setDestinationId] = useState('');
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState('');

  useEffect(() => {
    listDestinations().then(setDestinations);
  }, []);

  // Only the actual async fetch belongs in an effect. Resetting
  // locationId/locations happens directly in the change handler below
  // (it's a response to that specific user action, not a derived
  // side-effect of destinationId changing for any reason).
  useEffect(() => {
    if (!destinationId) return;
    let cancelled = false;
    listLocations(destinationId).then(list => { if (!cancelled) setLocations(list); });
    return () => { cancelled = true; };
  }, [destinationId]);

  function handleDestinationChange(id) {
    setDestinationId(id);
    setLocations([]);
    setLocationId('');
  }

  if (destinations === null) return <p className="quick-add__hint">Loading destinations…</p>;

  if (destinations.length === 0) {
    return (
      <div>
        <p className="quick-add__hint">You don't have any destinations yet. Create one first from the Research home page.</p>
        <Button variant="secondary" onClick={onBack}>Back</Button>
      </div>
    );
  }

  return (
    <div>
      <Select label="Destination" required value={destinationId} onChange={e => handleDestinationChange(e.target.value)} autoFocus>
        <option value="">Choose a destination…</option>
        {destinations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </Select>

      {destinationId && locations.length > 0 && (
        <Select label="Location (optional)" hint="Leave blank if this applies to the whole destination." value={locationId} onChange={e => setLocationId(e.target.value)}>
          <option value="">Whole destination</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      )}

      <div className="quick-add__actions">
        <Button variant="secondary" onClick={onBack}>Back</Button>
        <Button disabled={!destinationId} onClick={() => onContinue({ destinationId, locationId: locationId || null })}>Continue</Button>
      </div>
    </div>
  );
}

function FormStep({ type, destinationId, locationId, onBack, onSaved }) {
  const [values, setValues] = useState(() => Object.fromEntries(type.quickFields.map(f => [f.key, ''])));
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function setField(key, value) {
    setValues(v => ({ ...v, [key]: value }));
  }

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const fields = { ...type.buildFields(values), locationId: locationId || null };
      await type.create(destinationId, fields);
      onSaved(destinationId);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }, [type, values, destinationId, locationId, onSaved]);

  return (
    <form onSubmit={handleSubmit}>
      <p className="quick-add__type-chip"><span aria-hidden="true">{type.icon}</span> {type.label}</p>
      {type.quickFields.map(f => (
        f.kind === 'note'
          ? <TextArea key={f.key} placeholder={f.placeholder} rows={3} value={values[f.key]} onChange={e => setField(f.key, e.target.value)} autoFocus={f === type.quickFields[0]} />
          : <Input key={f.key} placeholder={f.placeholder} value={values[f.key]} onChange={e => setField(f.key, e.target.value)} autoFocus={f === type.quickFields[0]} />
      ))}
      <p className="quick-add__hint">You can add richer details — fees, opening hours, exact location, and more — any time by opening this entry later.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="quick-add__actions">
        {onBack && <Button type="button" variant="secondary" onClick={onBack}>Back</Button>}
        <Button type="submit" disabled={submitting} fullWidth={!onBack}>{submitting ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  );
}

