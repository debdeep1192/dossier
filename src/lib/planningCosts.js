// Planning cost calculation — pure, computed rollup, no new store.
//
// Planning costs are ESTIMATES, not actual expense tracking. Every
// function here reads live Planning/timelineItems/Research data and
// computes a number; nothing is cached or persisted as "the total" —
// recalculating after any edit (a fee band toggled, an override typed,
// an Option reselected) is simply calling these functions again with
// the current data, the same "no stored warning to go stale" principle
// planningValidation.js already established for date/time validation.
//
// Reuses, rather than duplicates:
//   - db/currency.js's convertAmount() for any currency conversion
//   - the existing Money shape ({amount, currency, unit, note})
//   - the existing feeBands shape on Attractions
//   - the existing extraPersonCharges shape on Accommodations
//   - Chunk 3's Option-group / item-alternative inclusion mechanism
//     (planningOptionGroups.selectedOptionLabel, itemAlternatives)

// --- Inclusion context (reuses, does not duplicate, Chunk 3's own rules) ---------------------------------------------

// Whether a timeline item counts as part of the CURRENTLY selected
// itinerary — i.e. whether its cost should count toward the Planning
// total. Mirrors exactly the inclusion logic already exercised by
// Chunk 3/4's own tests (`currentGroup.selectedOptionLabel ===
// item.optionLabel`): an ordinary item (no optionGroupId) is always
// current; an item that belongs to an Option only counts if that
// Option's group has THIS item's optionLabel as its
// selectedOptionLabel. An unresolved group (selectedOptionLabel:
// null) means nothing in it counts yet — never "count everything",
// which would double- (or triple-, or N-) count competing sequences.
//
// `optionGroupsById` is a plain `{ [groupId]: group }` map — the
// caller already has this loaded (see PlanningDetailPage.jsx's own
// existing groupsByDay-style lookups) and passing it in keeps this a
// pure function with no data-fetching of its own.
export function isTimelineItemCurrentlyIncluded(item, optionGroupsById) {
  if (!item.optionGroupId) return true;
  const group = optionGroupsById[item.optionGroupId];
  if (!group) return false; // the group was deleted/not found — nothing to compare against, so not current
  return group.selectedOptionLabel === item.optionLabel;
}

// Whether an item alternative counts toward the Planning total: its
// OWN `selected` flag, AND its parent item must itself be currently
// included (an alternative under an unselected Option's item never
// counts, regardless of its own selected flag — see the design note
// in itemAlternatives.js). This is inheritance, not a separate state:
// nothing about "is this alternative in the current itinerary" is
// stored anywhere; it's always re-derived from the parent.
export function isAlternativeCurrentlyIncluded(alternative, parentItem, optionGroupsById) {
  if (!alternative.selected) return false;
  return isTimelineItemCurrentlyIncluded(parentItem, optionGroupsById);
}

// --- Traveller age (as of the Planning's start date) ---------------------------------------------

// Age in whole years as of a given reference date (the Planning's
// startDate, per the agreed design — age is computed once for the
// whole trip, not per calendar day, since fee-band brackets are about
// "child vs adult for this trip", not a day-by-day recalculation).
export function ageAsOf(dob, referenceDateStr) {
  if (!dob || !referenceDateStr) return null;
  const birth = new Date(`${dob}T00:00:00`);
  const reference = new Date(`${referenceDateStr}T00:00:00`);
  let age = reference.getFullYear() - birth.getFullYear();
  const hasNotHadBirthdayYet =
    reference.getMonth() < birth.getMonth() ||
    (reference.getMonth() === birth.getMonth() && reference.getDate() < birth.getDate());
  if (hasNotHadBirthdayYet) age -= 1;
  return age >= 0 ? age : null;
}

// Whether a traveller's age qualifies for a fee band's [minAge, maxAge]
// range. Both bounds are optional free-form strings on the existing
// feeBands shape (see lib/feeBands.js) — blank means "no bound on this
// side", not zero. A band with neither bound set qualifies everyone
// (e.g. a simple single-price-for-all attraction).
export function ageQualifiesForBand(age, band) {
  if (age === null || age === undefined) return false;
  const min = band.minAge !== '' && band.minAge !== null && band.minAge !== undefined ? Number(band.minAge) : null;
  const max = band.maxAge !== '' && band.maxAge !== null && band.maxAge !== undefined ? Number(band.maxAge) : null;
  if (min !== null && age < min) return false;
  if (max !== null && age > max) return false;
  return true;
}

// --- Per-category cost calculation ---------------------------------------------
//
// Every calculate* function below returns either:
//   { amount: number, currency: string, estimated: true, ... }   — a real, usable estimate
//   { amount: null, currency: null, estimated: false, ... }      — genuinely "not estimated" (no
//                                                                    Research price AND no override)
// `estimated: false` is never conflated with `amount: 0` — a free
// attraction (feeBand status 'free', amount effectively 0) IS
// estimated (at zero cost); an attraction with no fee band selected at
// all is NOT estimated. This distinction is what lets the UI show
// "not estimated" rather than silently treating missing data as ₹0,
// per the explicit requirement.

// Attractions: sum of the SELECTED fee bands (never all bands
// automatically — the person must explicitly choose which charges
// apply, per the approved design; camera/video charges are just
// additional optional Money fields on the attraction, not bands, and
// are never auto-included either). Each selected band contributes
// band.amount ONCE per qualifying traveller (age-gated), in the
// band's own currency — bands are not assumed to share one currency,
// though in practice they usually will.
//
// `costSelections` on the timeline item is `{ selectedFeeBandIds: [id, ...] }`.
// A selected id that no longer matches any of the attraction's current
// feeBands (Research was edited/a band removed) is silently skipped —
// "preserve dangling ids safely" per the requirement: the stale id
// stays stored (never silently dropped from costSelections itself,
// in case the band comes back or this was a transient read), it just
// contributes nothing to the total while dangling.
export function calculateAttractionCost({ costSelections, attraction, travellerAges }) {
  const selectedIds = costSelections?.selectedFeeBandIds || [];
  if (selectedIds.length === 0 || !attraction?.feeBands) {
    return { amount: null, currency: null, estimated: false, lineItems: [] };
  }
  const lineItems = [];
  let currency = null;
  let total = 0;
  let anyResolved = false;

  for (const bandId of selectedIds) {
    const band = attraction.feeBands.find(b => b.id === bandId);
    if (!band) continue; // dangling id — Research changed since selection; safely skipped, not an error
    // A band explicitly marked 'free' is a real, known cost of zero —
    // distinct from a band whose amount simply hasn't been entered.
    // Treating both as "no amount" would make a free attraction show
    // as "not estimated", exactly the free-vs-unknown confusion the
    // requirements say to avoid.
    const isFree = band.status === 'free';
    const bandAmount = isFree
      ? 0
      : (band.amount !== '' && band.amount !== null && band.amount !== undefined ? Number(band.amount) : null);
    if (bandAmount === null) continue; // a selected band with no amount entered yet contributes nothing, not zero-by-assumption

    const qualifyingCount = travellerAges.filter(age => ageQualifiesForBand(age, band)).length;
    if (qualifyingCount === 0) continue;

    anyResolved = true;
    currency = currency || band.currency || null;
    const bandTotal = bandAmount * qualifyingCount;
    total += bandTotal;
    lineItems.push({ bandId, label: band.label || 'Fee', amount: bandTotal, currency: band.currency || currency, qualifyingCount });
  }

  if (!anyResolved) return { amount: null, currency: null, estimated: false, lineItems: [] };
  return { amount: total, currency, estimated: true, lineItems };
}

// Restaurants: Research's reference `price` is the initial estimate;
// a Planning-level override (costSelections.estimateOverride, a Money
// shape or null) takes precedence when set. Never both — the override
// REPLACES the Research value for the purposes of the total, it
// doesn't add to it.
export function calculateRestaurantCost({ costSelections, restaurant }) {
  return resolveOverridableMoneyEstimate(costSelections, restaurant?.price);
}

// Transport: identical override pattern to Restaurants.
export function calculateTransportCost({ costSelections, transport }) {
  return resolveOverridableMoneyEstimate(costSelections, transport?.price);
}

// Shared "Research reference price, Planning can override" resolution
// used by both Restaurants and Transport (and available for a custom
// item's own manual estimate — see calculateCustomItemCost below).
function resolveOverridableMoneyEstimate(costSelections, researchPrice) {
  const override = costSelections?.estimateOverride;
  if (override && override.amount !== '' && override.amount !== null && override.amount !== undefined) {
    return { amount: Number(override.amount), currency: override.currency || null, estimated: true, overridden: true };
  }
  if (researchPrice && researchPrice.amount !== '' && researchPrice.amount !== null && researchPrice.amount !== undefined) {
    return { amount: Number(researchPrice.amount), currency: researchPrice.currency || null, estimated: true, overridden: false };
  }
  return { amount: null, currency: null, estimated: false, overridden: false };
}

// Accommodation: nightly rate x nights-covered-by-this-timeline-item,
// plus applicable extra-person charges, unless overridden wholesale.
// `nights` is supplied by the caller (see nightsForAccommodationItem
// below) rather than computed here, keeping this function a pure
// number-crunching step independent of how "nights" was derived.
// extraPersonCharges apply per selected charge (costSelections.
// selectedExtraChargeIds), same "explicit selection, never silently
// guessed" rule as attraction fee bands — the requirement says "apply
// applicable extra-person charges where the Research data supports
// them", and since a charge is meaningful per stay (not per night, per
// the existing extraPersonCharges shape being a flat Money with no
// per-night wording), it's added once per selected charge, not
// multiplied by nights.
//
// `nights` being null/0/negative here means "unknown" (no check-out
// day set, or an otherwise invalid range) — treated exactly like a
// missing Research nightly rate: not estimated, never a guessed
// single-night default.
export function calculateAccommodationCost({ costSelections, accommodation, nights }) {
  const override = costSelections?.estimateOverride;
  if (override && override.amount !== '' && override.amount !== null && override.amount !== undefined) {
    return { amount: Number(override.amount), currency: override.currency || null, estimated: true, overridden: true, lineItems: [] };
  }

  const nightly = accommodation?.price;
  const hasNightlyRate = nightly && nightly.amount !== '' && nightly.amount !== null && nightly.amount !== undefined;
  const hasValidNights = Number.isFinite(nights) && nights > 0;
  if (!hasNightlyRate || !hasValidNights) {
    return { amount: null, currency: null, estimated: false, overridden: false, lineItems: [] };
  }

  const currency = nightly.currency || null;
  let total = Number(nightly.amount) * nights;
  const lineItems = [{ label: `${nightly.amount} × ${nights} night${nights === 1 ? '' : 's'}`, amount: Number(nightly.amount) * nights, currency }];

  const selectedChargeLabels = costSelections?.selectedExtraChargeLabels || [];
  for (const label of selectedChargeLabels) {
    const charge = (accommodation?.extraPersonCharges || []).find(c => c.label === label);
    if (!charge) continue; // dangling reference — Research changed since selection; safely skipped
    const chargeAmount = charge.price?.amount;
    if (chargeAmount === '' || chargeAmount === null || chargeAmount === undefined) continue;
    total += Number(chargeAmount);
    lineItems.push({ label: charge.label, amount: Number(chargeAmount), currency: charge.price?.currency || currency });
  }

  return { amount: total, currency, estimated: true, overridden: false, lineItems };
}

// How many nights a specific accommodation timeline item's estimate
// should be calculated for — derived from its check-in day (the
// item's own dayNumber) and checkOutDayNumber (see the design note
// atop timelineItems.js): nights = checkOutDayNumber - dayNumber.
// Replaces an earlier, temporary "enter nights directly" mechanism
// (costSelections.nights) entirely — that field is no longer read or
// written anywhere. Both day numbers are Planning-relative, never
// calendar dates, so this stays correct across a Planning startDate
// shift with no extra work, exactly like every other day-number-based
// fact in this app (see plannings.js's listPlanningDays). Returns null
// (never a guessed default) when checkOutDayNumber is unset or the
// range is otherwise invalid — timelineItems.js's own validation
// already rejects a checkOutDayNumber <= dayNumber at write time, but
// this function stays defensive against any record it's handed
// (e.g. a value predating that validation, or a directly-constructed
// test fixture) rather than assuming every record it sees is valid.
export function nightsForAccommodationItem(item) {
  const checkOutDayNumber = item?.checkOutDayNumber;
  if (!Number.isFinite(checkOutDayNumber) || !Number.isFinite(item?.dayNumber)) return null;
  const nights = checkOutDayNumber - item.dayNumber;
  return nights > 0 ? nights : null;
}

// Custom/other items: no Research reference at all, so the ONLY
// possible source of an estimate is a Planning-entered override —
// same shape (costSelections.estimateOverride) as Restaurants/
// Transport, reused rather than inventing a separate field.
export function calculateCustomItemCost({ costSelections }) {
  return resolveOverridableMoneyEstimate(costSelections, null);
}

// --- Per-item dispatch ---------------------------------------------

// Resolves the cost for one timeline item, dispatching by
// researchRefType (or treating it as a custom/other item when there is
// none). `context` supplies whatever each category's calculator needs
// that isn't on the item itself: the resolved Research record,
// traveller ages, accommodation nights. Shopping is deliberately never
// routed through the "automatic Research-price" path — per the
// requirement, Shopping only contributes if the person explicitly
// entered a Planning estimate, which for a shopping-type item is
// exactly the same "custom item with an override, no Research price"
// path calculateCustomItemCost already provides, since Shopping isn't
// one of TIMELINE_RESEARCH_REF_TYPES to begin with.
export function calculateItemCost(item, context) {
  switch (item.researchRefType) {
    case 'attractions':
      return calculateAttractionCost({ costSelections: item.costSelections, attraction: context.record, travellerAges: context.travellerAges });
    case 'restaurants':
      return calculateRestaurantCost({ costSelections: item.costSelections, restaurant: context.record });
    case 'transport':
      return calculateTransportCost({ costSelections: item.costSelections, transport: context.record });
    case 'accommodations':
      return calculateAccommodationCost({ costSelections: item.costSelections, accommodation: context.record, nights: context.nights });
    default:
      return calculateCustomItemCost({ costSelections: item.costSelections });
  }
}

// Which cost-rollup category a timeline item's estimate belongs in.
// Based on researchRefType (matching how the item's own cost is
// calculated), falling back to itemType for a custom item so a
// custom "accommodation"-typed or "meal"-typed entry still lands in a
// sensible bucket rather than always defaulting to Other.
export function costCategoryForItem(item) {
  if (item.researchRefType === 'attractions') return 'attractions';
  if (item.researchRefType === 'restaurants') return 'food';
  if (item.researchRefType === 'transport') return 'transport';
  if (item.researchRefType === 'accommodations') return 'accommodation';
  if (item.itemType === 'accommodation') return 'accommodation';
  if (item.itemType === 'meal') return 'food';
  if (item.itemType === 'travel') return 'transport';
  return 'other';
}

export const COST_CATEGORIES = ['accommodation', 'transport', 'attractions', 'food', 'other'];

// --- Planning-level rollup ---------------------------------------------

// Computes the full Planning cost breakdown: one total per category,
// an overall total, and the list of items that couldn't be estimated
// (for the UI's "not estimated" surfacing). Only items/alternatives
// that are CURRENTLY INCLUDED (see isTimelineItemCurrentlyIncluded /
// isAlternativeCurrentlyIncluded above) contribute — an unselected
// Option's items, or an Option group left unresolved, contribute
// nothing, exactly per the approved design. Both 'planned' and
// 'optional' status count when current; only inclusion (Option
// selection), never status, decides whether something counts here.
//
// Every amount is kept in ITS OWN currency and summed only against
// amounts already in that same currency — this function never
// converts anything (see convertPlanningTotals below for that, kept
// as a separate, explicit step using the existing convertAmount()).
// A Planning that mixes currencies across items will show one
// sub-total per currency per category, which the UI then displays
// alongside the converted total rather than silently mixing amounts
// from different currencies into one meaningless sum.
//
// `getRecordForItem(item)` and `travellerAges` are supplied by the
// caller (PlanningDetailPage.jsx already resolves Research records via
// researchByTypeAndId, and already computes traveller ages from the
// Planning's travellerIds — this function does no data-fetching of
// its own, matching planningValidation.js's own pure-function shape).
export function calculatePlanningCostBreakdown({ items, alternatives, optionGroupsById, getRecordForItem, travellerAges }) {
  const categoryTotals = Object.fromEntries(COST_CATEGORIES.map(c => [c, {}])); // { [category]: { [currency]: amount } }
  const unestimatedItems = [];

  function addToCategory(category, amount, currency) {
    if (amount === null || amount === undefined) return;
    // A genuinely-free item (estimated at zero, no currency) counts as
    // "estimated" for the not-estimated tally above, but adds nothing
    // to display — putting a "— 0" line in a category just because
    // something free was selected would be noise, not information.
    if (amount === 0 && !currency) return;
    const bucket = categoryTotals[category];
    const key = currency || '—'; // items with a real amount but no currency set still count, grouped under a placeholder key
    bucket[key] = (bucket[key] || 0) + amount;
  }

  for (const item of items) {
    if (!isTimelineItemCurrentlyIncluded(item, optionGroupsById)) continue; // unselected Option's item — never counted
    const record = getRecordForItem(item);
    const nights = item.researchRefType === 'accommodations' ? nightsForAccommodationItem(item) : undefined;
    const result = calculateItemCost(item, { record, travellerAges, nights });
    const category = costCategoryForItem(item);
    if (result.estimated) {
      addToCategory(category, result.amount, result.currency);
    } else {
      unestimatedItems.push({ itemId: item.id, category });
    }
  }

  for (const alt of alternatives) {
    if (!isAlternativeCurrentlyIncluded(alt.alternative, alt.parentItem, optionGroupsById)) continue;
    const record = getRecordForItem(alt.alternative);
    const result = calculateItemCost(alt.alternative, { record, travellerAges });
    const category = costCategoryForItem(alt.parentItem); // an alternative's category follows its parent slot's category
    if (result.estimated) {
      addToCategory(category, result.amount, result.currency);
    } else {
      unestimatedItems.push({ itemId: alt.alternative.id, category });
    }
  }

  const overallByCurrency = {};
  for (const category of COST_CATEGORIES) {
    for (const [currency, amount] of Object.entries(categoryTotals[category])) {
      overallByCurrency[currency] = (overallByCurrency[currency] || 0) + amount;
    }
  }

  return { categoryTotals, overallByCurrency, unestimatedItems };
}

// Converts a { [currency]: amount } map (as produced by
// calculatePlanningCostBreakdown) into a single home-currency total,
// using the EXISTING convertAmount() (db/currency.js) — never a new
// conversion mechanism. Returns null (not a guessed/partial number)
// if ANY currency present has no usable rate to the target — a
// partial conversion that silently drops an unconverted amount would
// misrepresent the total, which is worse than showing nothing.
export async function convertTotalToHomeCurrency(amountsByCurrency, homeCurrency, convertAmountFn) {
  const currencies = Object.keys(amountsByCurrency).filter(c => c !== '—');
  if (currencies.length === 0) return null;
  let total = 0;
  for (const currency of currencies) {
    if (currency === homeCurrency) {
      total += amountsByCurrency[currency];
      continue;
    }
    const converted = await convertAmountFn(amountsByCurrency[currency], currency, homeCurrency);
    if (converted === null) return null; // one unconvertible currency means the WHOLE total can't be trusted
    total += converted;
  }
  return total;
}
