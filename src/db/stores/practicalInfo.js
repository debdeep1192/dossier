import { commonMetadata } from '../shared.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';

const STORE = 'practicalInfo';

export function emptyPracticalInfoEntry() {
  return {
    topic: '', // controlled dropdown — see lib/practicalInfoOptions.js
    topicOther: '', // free-text explanation when topic === 'Other' — see components/OtherSelect.jsx
    // All contact fields are optional structured data for when a topic
    // genuinely has a specific contact (e.g. Emergency -> a police
    // station's phone number). Most entries will only ever use
    // topic + details.
    name: '',
    location: '',
    address: '',
    phone: '',
    email: '',
    website: '',
    googleMapsUrl: '',
    details: '',
  };
}

export function listPracticalInfoEntries(destinationId) {
  return listActive(STORE, destinationId);
}

export function getPracticalInfoEntry(id) {
  return getActive(STORE, id);
}

export function createPracticalInfoEntry(destinationId, fields) {
  const record = { ...commonMetadata({ destinationId }), ...emptyPracticalInfoEntry(), ...fields };
  if (!record.topic?.trim()) throw new Error('Give this a topic.');
  return save(STORE, record);
}

export function updatePracticalInfoEntry(id, fields) {
  return patch(STORE, id, fields);
}

export function deletePracticalInfoEntry(id) {
  return softDelete(STORE, id);
}
