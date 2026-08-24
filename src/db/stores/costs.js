import { commonMetadata, emptyMoney } from '../shared.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';

const STORE = 'costs';

export function emptyCostEntry() {
  return {
    item: '', // what the cost is for, e.g. "Local SIM card"
    price: emptyMoney(),
    context: '', // free text
  };
}

export function listCostEntries(destinationId) {
  return listActive(STORE, destinationId);
}

export function getCostEntry(id) {
  return getActive(STORE, id);
}

export function createCostEntry(destinationId, fields) {
  const record = { ...commonMetadata({ destinationId }), ...emptyCostEntry(), ...fields };
  if (!record.item?.trim()) throw new Error('Give this cost a name.');
  return save(STORE, record);
}

export function updateCostEntry(id, fields) {
  return patch(STORE, id, fields);
}

export function deleteCostEntry(id) {
  return softDelete(STORE, id);
}
