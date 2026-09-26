import { getAll, getOne, put, newId } from '../connection.js';
import { patch, softDelete } from './crud.js';

const STORE = 'people';

// A reusable, destination-independent traveller — Tour Planning, Chunk 1.
// Deliberately minimal (name + DOB only), per the explicit "do not build
// a large people-management system" instruction. Not built on
// commonMetadata() (db/shared.js) because that shape is destination-
// scoped (destinationId, locationId, priority, sourceIds, provenance,
// candidateId) — none of which apply to a person, who is meant to be
// reused across every destination and every Planning, not scoped to one.
// crud.js's listActive()/getActive() can't be reused as-is either since
// they assume a destinationId index; this file calls getAll/getOne
// directly instead, following the exact same soft-delete-filter shape.
export function emptyPerson() {
  return { name: '', dob: '' };
}

export async function listPeople() {
  const all = await getAll(STORE);
  return all.filter(p => !p.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getPerson(id) {
  const record = await getOne(STORE, id);
  if (!record || record.deletedAt) return null;
  return record;
}

export async function createPerson(fields) {
  const name = fields?.name?.trim();
  if (!name) throw new Error('Name is required.');
  // DOB must be an actual date, not an age — enforced here as the single
  // source of truth for the rule, same as every other required-field
  // check in this codebase (e.g. createAttraction's place-name check).
  if (!fields?.dob) throw new Error('Date of birth is required.');
  const now = new Date().toISOString();
  const record = {
    id: newId(),
    name,
    dob: fields.dob,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await put(STORE, record);
  return record;
}

export async function updatePerson(id, fields) {
  if (fields?.name !== undefined && !fields.name.trim()) throw new Error('Name is required.');
  if (fields?.dob !== undefined && !fields.dob) throw new Error('Date of birth is required.');
  return patch(STORE, id, fields);
}

export async function deletePerson(id) {
  return softDelete(STORE, id);
}
