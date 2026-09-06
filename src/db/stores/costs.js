// ============================================================
// RETIRED FROM THE UI (kept for data safety) — see sectionRegistry.js.
//
// The standalone "Costs & Money" section is no longer reachable from
// navigation, the destination page, or Quick Add: costs are now
// recorded on the record they actually belong to (an attraction's fee,
// a restaurant's price, a transport fare, a shopping item's expected
// price, or a practical-info entry for things like visas/SIM/permits/
// tipping that don't belong to a specific place).
//
// This file, its store, and any records a person already saved here
// are INTENTIONALLY left fully intact and functional — this is a UI
// retirement, not a data deletion. Existing `costs` records remain in
// the database, remain readable via the functions below, and are
// exercised directly by foundation.test.js as part of the currency
// system's test coverage (a cost entry is a convenient, minimal
// standalone record for testing money/exchange-rate behavior). If a
// need for standalone cost records resurfaces later, this file and its
// data are already there to build back on top of, or a person's
// existing cost data could be reviewed and reassigned to the section
// it actually belongs to.
// ============================================================
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
