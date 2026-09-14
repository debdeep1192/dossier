import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SECTIONS } from '../sectionRegistry.js';
import { listDestinations } from '../db/stores/destinations.js';
import { listLocations } from '../db/stores/locations.js';
import { buildAddDestinationPath } from '../lib/addEntryRouting.js';
import Modal from './Modal';
import Button from './Button';
import Card from './Card';
import { Select } from './Field';
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

  function handleSelectSection(section) {
    if (initialDestinationId !== undefined) {
      // Context already known from where the person opened Add from
      // (a destination or city page) — go straight to the section,
      // no re-asking. See DestinationDetail.jsx for how this is passed.
      goToSection(section, initialDestinationId, initialLocationId);
      return;
    }
    setSelectedSection(section);
    setStep('context');
  }

  if (!open) return null;

  return (
    <Modal open={open} onClose={handleClose} title="Add to Dossier">
      {step === 'type' && <TypeStep onSelect={handleSelectSection} />}
      {step === 'context' && selectedSection && (
        <ContextStep
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

function ContextStep({ onBack, onContinue }) {
  const [destinations, setDestinations] = useState(null);
  const [destinationId, setDestinationId] = useState('');
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState('');

  useEffect(() => {
    listDestinations().then(setDestinations);
  }, []);

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
        <p className="quick-add__hint">You don't have any destinations yet. Create one first from Home.</p>
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
        <Select label="City (optional)" hint="Leave blank if this applies to the whole destination." value={locationId} onChange={e => setLocationId(e.target.value)}>
          <option value="">Whole destination</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      )}

      <div className="quick-add__actions">
        <Button variant="secondary" onClick={onBack}>Back</Button>
        <Button disabled={!destinationId} onClick={() => onContinue(destinationId, locationId || null)}>Continue</Button>
      </div>
    </div>
  );
}
