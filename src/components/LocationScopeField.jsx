import { useState } from 'react';
import { Select } from './Field';
import './LocationScopeField.css';

// Shared "where does this apply" control — item 3-4, 6 of the spec.
// `locationId` means ONLY a real location id or null (whole
// destination); this field never represents journey/between-cities
// context — see JourneyField.jsx for that, which is a separate,
// opt-in control only certain sections use.
//
// Props:
//   locations        - the destination's Location[] (from db/stores/locations.js)
//   value            - current locationId (a real location id, or null)
//   onChange(nextLocationId)
//   lockedLocationId - when set (context already known — e.g. opened from
//                       inside a specific location's section page), the
//                       location is shown as fixed text instead of an
//                       editable picker, so the person is never asked to
//                       re-enter something the app already knows.
export default function LocationScopeField({ locations, value, onChange, lockedLocationId }) {
  // Hook must run unconditionally, before any early return, per rules
  // of hooks — the `locations.length === 0` guard below cannot come
  // first even though it makes this state irrelevant in that case.
  const [unlocked, setUnlocked] = useState(false);

  if (locations.length === 0) return null; // nothing to choose from a destination with no locations yet

  // "Locked" is a helpful DEFAULT, not a restriction: the person came
  // here already inside a specific location's context, so re-asking
  // would be repeating something the app already knows. But per the
  // spec ("I must still be able to change the location or make the
  // entry destination-wide if appropriate"), a small escape hatch is
  // always present — tapping "Change" reveals the normal editable
  // picker for this one record, without altering the context of the
  // page the person came from.
  if (lockedLocationId && !unlocked) {
    const loc = locations.find(l => l.id === lockedLocationId);
    return (
      <p className="location-scope-field__locked">
        📍 {loc ? loc.name : 'This location'}
        <button type="button" className="location-scope-field__change" onClick={() => setUnlocked(true)}>Change</button>
      </p>
    );
  }

  return (
    <div className="location-scope-field">
      <Select label="Applies to" value={value || ''} onChange={e => onChange(e.target.value || null)}>
        <option value="">Whole destination</option>
        {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
      </Select>
    </div>
  );
}
