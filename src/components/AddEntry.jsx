import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SECTIONS } from '../sectionRegistry.js';
import { listDestinations } from '../db/stores/destinations.js';
import { listLocations, createLocation } from '../db/stores/locations.js';
import { buildAddDestinationPath } from '../lib/addEntryRouting.js';
import Modal from './Modal';
import Button from './Button';
import Card from './Card';
import { Select, Input } from './Field';
import './AddEntry.css';

// The single, coherent "+ Add to Dossier" flow (Phase 3 Chunk 12) —
// replaces the old QuickAdd.jsx, which had its own crippled 2-field
// FormStep (a second, parallel form implementation per section). This
// component NEVER defines its own record fields: it only figures out
// (a) what type of thing to add, (b) what destination/city context
// applies, and then navigates to that section's own existing page with
// `?new=1` (see hooks/useAutoOpenNewForm.js and lib/addEntryRouting.js),
// which opens the exact same "New X" form each section's own "+ Add"
// button already opens. A quick-captured record and one made from the
// full section page are therefore now the SAME form, not two different
// ones.

export default function AddEntry({ open, onClose, initialDestinationId, initialLocationId }) {
  const navigate = useNavigate();
  const [step, setStep] = useState('type'); // 'type' | 'context'
  const [selectedSection, setSelectedSection] = useState(null);

  function reset() {
    setStep('type');
    setSelectedSection(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function goToSection(section, destinationId, locationId) {
    reset();
    onClose();
    navigate(buildAddDestinationPath(section, destinationId, locationId));
  }

  // Case A ("Destination -> City -> Section", e.g. already on the
  // Attractions page) is now decided and acted on BEFORE this modal is
  // ever opened — see AppShell.jsx's openAdd(), which navigates
  // directly instead of opening this component at all in that case.
  // This modal therefore only ever needs to handle Case B (destination
  // and/or city already known, city missing) and Case C (nothing known
  // yet) below.

  function handleSelectSection(section) {
    if (initialDestinationId !== undefined && initialLocationId) {
      // Case B with a specific city already selected — context fully
      // known, go straight to the section.
      goToSection(section, initialDestinationId, initialLocationId);
      return;
    }
    // Case B at the whole-destination view (destination known, no
    // specific city), or Case C (opened from Home, destination itself
    // still unknown) — ContextStep below asks only for whichever of
    // destination/city is actually still missing.
    setSelectedSection(section);
    setStep('context');
  }

  if (!open) return null;

  return (
    <Modal open={open} onClose={handleClose} title="Add to Dossier">
      {step === 'type' && <TypeStep onSelect={handleSelectSection} />}
      {step === 'context' && selectedSection && (
        <ContextStep
          fixedDestinationId={initialDestinationId}
          onBack={() => setStep('type')}
          onContinue={(destinationId, locationId) => goToSection(selectedSection, destinationId, locationId)}
        />
      )}
    </Modal>
  );
}

function TypeStep({ onSelect }) {
  return (
    <div className="quick-add__type-grid">
      {SECTIONS.map(section => (
        <Card key={section.key} interactive padding="sm" className="quick-add__type-tile" onClick={() => onSelect(section)}>
          <span className="quick-add__type-icon" aria-hidden="true">{section.icon}</span>
          <span className="quick-add__type-label">{section.label}</span>
        </Card>
      ))}
    </div>
  );
}

function ContextStep({ fixedDestinationId, onBack, onContinue }) {
  const [destinations, setDestinations] = useState(fixedDestinationId ? [] : null);
  const [destinationId, setDestinationId] = useState(fixedDestinationId || '');
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState(''); // real location id, '' (whole destination), or '__other__'
  const [newCityName, setNewCityName] = useState('');
  const [error, setError] = useState('');
  const [creatingCity, setCreatingCity] = useState(false);

  useEffect(() => {
    if (fixedDestinationId) return; // destination already known — no need to load the full list
    listDestinations().then(setDestinations);
  }, [fixedDestinationId]);

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

  async function handleContinue() {
    if (locationId === '__other__') {
      // Case C's "Other / Add new city": the typed name becomes a
      // real Dossier location under this destination (via the same
      // createLocation() every other city-creation entry point uses —
      // see db/stores/locations.js), not a value only stored on this
      // one entry, so it appears in every city list/dropdown from now
      // on, exactly like a city added from the Cities tab would.
      if (!newCityName.trim()) { setError('Enter a name for the new city.'); return; }
      setError('');
      setCreatingCity(true);
      try {
        const created = await createLocation(destinationId, { name: newCityName.trim() });
        onContinue(destinationId, created.id);
      } catch (err) {
        setError(err.message);
        setCreatingCity(false);
      }
      return;
    }
    onContinue(destinationId, locationId || null);
  }

  if (!fixedDestinationId && destinations === null) return <p className="quick-add__hint">Loading destinations…</p>;

  if (!fixedDestinationId && destinations.length === 0) {
    return (
      <div>
        <p className="quick-add__hint">You don't have any destinations yet. Create one first from Home.</p>
        <Button variant="secondary" onClick={onBack}>Back</Button>
      </div>
    );
  }

  return (
    <div>
      {!fixedDestinationId && (
        <Select label="Destination" required value={destinationId} onChange={e => handleDestinationChange(e.target.value)} autoFocus>
          <option value="">Choose a destination…</option>
          {destinations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
      )}

      {destinationId && (
        <Select label="City" hint="Leave as whole destination if this doesn't belong to one specific city." value={locationId} onChange={e => { setLocationId(e.target.value); setError(''); }} autoFocus={Boolean(fixedDestinationId)}>
          <option value="">Whole destination</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          <option value="__other__">Other / Add new city…</option>
        </Select>
      )}

      {locationId === '__other__' && (
        <Input label="New city name" value={newCityName} onChange={e => setNewCityName(e.target.value)} placeholder="e.g. Ghoom" autoFocus />
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="quick-add__actions">
        <Button variant="secondary" onClick={onBack} disabled={creatingCity}>Back</Button>
        <Button disabled={!destinationId || creatingCity} onClick={handleContinue}>{creatingCity ? 'Creating city…' : 'Continue'}</Button>
      </div>
    </div>
  );
}
