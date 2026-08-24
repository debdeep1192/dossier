import { commonMetadata, emptyMoney } from '../shared.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';

const STORE = 'transport';

// An endpoint is always at least a label (e.g. "Colombo"); `place` is
// optional richer detail (address/coordinates/maps link) for when the
// endpoint is a specific point (a station, an airport) rather than just
// a city name.
export function emptyEndpoint() {
  return { label: '', place: null };
}

export function emptyTransportEntry() {
  return {
    from: emptyEndpoint(),
    to: emptyEndpoint(),
    mode: '', // free text: bus/train/tuk-tuk/flight/ferry/taxi
    price: emptyMoney(),
    duration: '',
    schedule: '', // frequency/timing notes
    bookingNotes: '',
  };
}

export function listTransportEntries(destinationId) {
  return listActive(STORE, destinationId);
}

export function getTransportEntry(id) {
  return getActive(STORE, id);
}

export function createTransportEntry(destinationId, fields) {
  const record = { ...commonMetadata({ destinationId }), ...emptyTransportEntry(), ...fields };
  if (!record.from?.label?.trim() || !record.to?.label?.trim()) throw new Error('Both "From" and "To" are required.');
  return save(STORE, record);
}

export function updateTransportEntry(id, fields) {
  return patch(STORE, id, fields);
}

export function deleteTransportEntry(id) {
  return softDelete(STORE, id);
}
