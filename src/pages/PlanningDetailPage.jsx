import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getPlanning, createPlanning, updatePlanning, deletePlanning, listPlanningDays } from '../db/stores/plannings';
import { listDestinations, getDestination } from '../db/stores/destinations';
import { listPeople } from '../db/stores/people';
import { listTimelineItems, createTimelineItem, updateTimelineItem, deleteTimelineItem, TIMELINE_ITEM_TYPES } from '../db/stores/timelineItems';
import { listOptionGroupsForPlanning, createOptionGroup, selectOption, deleteOptionGroup } from '../db/stores/planningOptionGroups';
import { listAlternativesForItem, createItemAlternative, updateItemAlternative, deleteItemAlternative } from '../db/stores/itemAlternatives';
import { listAttractions } from '../db/stores/attractions';
import { listRestaurantEntries, isPlaceBased } from '../db/stores/restaurants';
import { listAccommodations } from '../db/stores/accommodations';
import { listTransportEntries } from '../db/stores/transport';
import { weekdayKeyForDate, validateTimelineItem } from '../lib/planningValidation';
import {
  ageAsOf, nightsForAccommodationItem, calculateItemCost,
  calculatePlanningCostBreakdown, convertTotalToHomeCurrency, COST_CATEGORIES,
  calculateAttractionCost, calculateRestaurantCost, calculateTransportCost, calculateAccommodationCost, calculateCustomItemCost,
} from '../lib/planningCosts';
import { isFeeBandEmpty } from '../lib/feeBands';
import { getCurrencyOptions, convertAmount, CORE_CURRENCIES } from '../db/currency';
import { getHomeCurrency, setHomeCurrency } from '../db/appSettings';
import { MoneyField, formatMoney } from '../components/Money';
import { useCachedQuery, invalidateCachedQuery } from '../hooks/useCachedQuery';
import Card from '../components/Card';
import Button from '../components/Button';
import Modal from '../components/Modal';
import ResearchPicker from '../components/ResearchPicker';
import { Input, TextArea, Select, Checkbox } from '../components/Field';
import { LoadingState, ErrorState } from '../components/States';
import './PlanningDetailPage.css';

const ITEM_TYPE_LABELS = {
  travel: 'Travel',
  attraction: 'Attraction / Activity',
  meal: 'Meal',
  accommodation: 'Accommodation',
  free_time: 'Free time',
  custom: 'Custom / general',
};

const COST_CATEGORY_LABELS = {
  accommodation: 'Accommodation',
  transport: 'Transport',
  attractions: 'Attractions / Activities',
  food: 'Food / Restaurants',
  other: 'Other',
};

// The next Option label after whatever's already in use for a group —
// A, B, C, ... Z, then giving up (26 competing sequences for one part
// of one day is well beyond anything this feature is meant for; a
// person planning that many alternatives has outgrown "simple", so
// there's no need to invent AA/AB-style labels).
const OPTION_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
function nextOptionLabel(existingLabels) {
  return OPTION_LABELS.find(l => !existingLabels.includes(l)) || null;
}

// Resolves a timeline item's display title: a Research-referenced item
// shows the referenced record's own name (never a copy stored on the
// timeline item itself — see timelineItems.js); a custom item shows its
// own title. Mirrors the same per-section fallback naming already used
// by ResearchPicker.jsx / each section page's own card rendering.
function describeReferencedRecord(refType, record) {
  if (!record) return '(Research item no longer available)';
  switch (refType) {
    case 'attractions':
    case 'accommodations':
      return record.place?.name || 'Untitled';
    case 'restaurants':
      return isPlaceBased(record) ? (record.place?.name || 'Untitled') : (record.dishName || 'Food note');
    case 'transport':
      if (record.travelType === 'local') return `Local transport${record.mode ? ` — ${record.mode}` : ''}`;
      return `${record.from?.label || '?'} → ${record.to?.label || '?'}`;
    default:
      return 'Untitled';
  }
}

// Small local display helper for one fee band's amount, inside the
// cost-editing checkboxes below — deliberately not reaching into
// lib/feeBands.js's own formatSingleBand (a private helper of that
// file's formatFeeBands, not exported) since this needs a slightly
// different, more compact phrasing suited to a checkbox label.
function formatSingleFeeBandAmount(band) {
  if (band.status === 'free') return 'Free';
  if (band.status === 'nominal') return band.amount ? `${band.currency} ${band.amount} (nominal)` : 'Nominal/donation';
  if (band.status === 'paid' && band.amount) return `${band.currency} ${band.amount}`;
  return 'Amount not set';
}

// Handles both /plannings/new (planningId undefined) and
// /plannings/:planningId (edit) — same shape of dual-purpose page as
// several section forms already have (e.g. record ? update : create).
// Chunk 3 adds itinerary Options (competing sequences for a day-part,
// via planningOptionGroups) on top of Chunk 2's plain timeline items.
// Item Alternatives (per-slot Research choices) are managed from
// inside each item's edit form. No opening-hours/best-time/duration
// validation, no cost calculation yet — later chunks, per the approved
// design.
export default function PlanningDetailPage() {
  const { planningId } = useParams();
  const navigate = useNavigate();
  const isNew = !planningId;

  const fetcher = useCallback(async () => {
    const [destinations, people, planning] = await Promise.all([
      listDestinations(),
      listPeople(),
      isNew ? Promise.resolve(null) : getPlanning(planningId),
    ]);
    if (!isNew && !planning) throw new Error('Planning not found.');
    const [destination, timelineItems, optionGroups] = await Promise.all([
      planning ? getDestination(planning.destinationId) : Promise.resolve(null),
      planning ? listTimelineItems(planning.id) : Promise.resolve([]),
      planning ? listOptionGroupsForPlanning(planning.id) : Promise.resolve([]),
    ]);
    // Research records referenced by timeline items/alternatives are
    // resolved here, once, for the whole page — never duplicated onto
    // the timeline item itself. All four itinerary-relevant Research
    // types are loaded (not just types already in use), since a newly
    // attached Research item, or an item alternative, can reference a
    // type no existing timeline item uses yet — and cost calculation
    // needs the referenced record's prices/fee bands for those too.
    // Same small, single-destination data scale ResearchPicker.jsx
    // already assumes, so this is four cheap indexed reads.
    const researchByTypeAndId = {};
    if (planning) {
      const sectionListFns = { attractions: listAttractions, restaurants: listRestaurantEntries, accommodations: listAccommodations, transport: listTransportEntries };
      await Promise.all(Object.entries(sectionListFns).map(async ([type, listFn]) => {
        const records = await listFn(planning.destinationId);
        researchByTypeAndId[type] = Object.fromEntries(records.map(r => [r.id, r]));
      }));
    }
    return { destinations, people, planning, destination, timelineItems, optionGroups, researchByTypeAndId };
  }, [planningId, isNew]);
  const { data, error, loading, refresh } = useCachedQuery(`planning:${planningId || 'new'}`, fetcher);

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading…" />;

  const { destinations, people, planning, destination, timelineItems, optionGroups, researchByTypeAndId } = data;

  // Traveller ages as of the Planning's start date — computed once here
  // and shared by the cost summary and the per-item cost editor, so
  // both always agree. Recomputed on every render from the live
  // startDate/dob values, never stored.
  const travellerAges = planning
    ? people.filter(p => planning.travellerIds.includes(p.id)).map(p => ageAsOf(p.dob, planning.startDate)).filter(age => age !== null)
    : [];
  const currencyOptions = getCurrencyOptions(destination);

  async function handleDelete() {
    if (!window.confirm(`Delete "${planning.name}"?`)) return;
    await deletePlanning(planning.id);
    invalidateCachedQuery('plannings');
    navigate('/plannings');
  }

  function afterTimelineChange() {
    invalidateCachedQuery(`planning:${planning.id}`);
    refresh();
  }

  return (
    <div className="section-page">
      <div className="section-page__breadcrumb">
        <Link to="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link to="/plannings">Plannings</Link>
        <span aria-hidden="true">/</span>
        <span>{isNew ? 'New Planning' : planning.name}</span>
      </div>

      <header className="section-page__header">
        <h1>{isNew ? 'New Planning' : planning.name}</h1>
        {!isNew && <Button variant="danger" onClick={handleDelete}>Delete Planning</Button>}
      </header>

      <PlanningForm
        destinations={destinations}
        people={people}
        planning={planning}
        onSaved={(saved) => {
          invalidateCachedQuery('plannings');
          invalidateCachedQuery(`planning:${saved.id}`);
          if (isNew) navigate(`/plannings/${saved.id}`);
          else refresh();
        }}
      />

      {!isNew && (
        <DaysTimeline
          planning={planning}
          destinationId={destination?.id}
          timelineItems={timelineItems}
          optionGroups={optionGroups}
          researchByTypeAndId={researchByTypeAndId}
          travellerAges={travellerAges}
          currencyOptions={currencyOptions}
          onChange={afterTimelineChange}
        />
      )}

      {!isNew && (
        <PlanningCostSummary
          planning={planning}
          travellerAges={travellerAges}
          timelineItems={timelineItems}
          optionGroups={optionGroups}
          researchByTypeAndId={researchByTypeAndId}
        />
      )}
    </div>
  );
}

// Planning cost summary — estimates only, never actual-spending
// tracking. Computed live from timelineItems + itemAlternatives +
// their resolved Research records + the Planning's own travellers,
// via lib/planningCosts.js — nothing here is persisted as "the
// total"; every render recalculates fresh, so an Option reselection,
// a fee-band toggle, or an override edit is reflected immediately
// with no separate "recompute" step. Only currently-included items
// (see isTimelineItemCurrentlyIncluded/isAlternativeCurrentlyIncluded)
// contribute — an unselected Option's items, or an unresolved Option
// group's items, contribute nothing, exactly per the approved design.
function PlanningCostSummary({ planning, travellerAges, timelineItems, optionGroups, researchByTypeAndId }) {
  const [homeTotal, setHomeTotal] = useState(undefined); // undefined = not yet computed, null = no rate available
  // The home currency is a small GLOBAL setting (db/appSettings.js),
  // deliberately independent of this (or any) destination's own
  // defaultCurrency — a Planning's home-currency total should not
  // silently change meaning just because the destination's default
  // currency happens to be set to something else. See the correction
  // note in db/appSettings.js for why this isn't destination-scoped.
  const [homeCurrency, setHomeCurrencyState] = useState(null); // null = not yet loaded

  useEffect(() => {
    let cancelled = false;
    getHomeCurrency().then(code => { if (!cancelled) setHomeCurrencyState(code); });
    return () => { cancelled = true; };
  }, []);

  async function handleHomeCurrencyChange(code) {
    await setHomeCurrency(code);
    setHomeCurrencyState(code);
  }

  const optionGroupsById = Object.fromEntries(optionGroups.map(g => [g.id, g]));

  function getRecordForItem(item) {
    if (!item.researchRefId) return null;
    return researchByTypeAndId[item.researchRefType]?.[item.researchRefId] || null;
  }

  // Item alternatives aren't part of the page's main fetch (they're
  // loaded per-item, on demand, inside ItemAlternativesPanel while
  // editing one item — see below) — the cost summary needs ALL of
  // them across the whole Planning, so it loads them itself here via
  // the same cache key shape ItemAlternativesPanel already uses,
  // ensuring both stay in sync after an edit invalidates that key.
  const alternativesFetcher = useCallback(async () => {
    const results = await Promise.all(timelineItems.map(async (item) => {
      const alts = await listAlternativesForItem(item.id);
      return alts.map(alternative => ({ alternative, parentItem: item }));
    }));
    return results.flat();
  }, [timelineItems]);
  const { data: alternatives } = useCachedQuery(`planning-cost-alternatives:${planning.id}`, alternativesFetcher);

  const breakdown = calculatePlanningCostBreakdown({
    items: timelineItems,
    alternatives: alternatives || [],
    optionGroupsById,
    getRecordForItem,
    travellerAges,
  });

  // Recompute the converted home-currency total whenever the
  // underlying currency composition, or the home currency itself,
  // changes. Keyed by JSON.stringify(overallByCurrency) rather than
  // the object itself, since a fresh object is recomputed every render
  // even when its contents haven't changed — this avoids re-fetching a
  // conversion rate on every keystroke elsewhere on the page. Skipped
  // entirely until homeCurrency has loaded from appSettings.
  useEffect(() => {
    if (!homeCurrency) return;
    let cancelled = false;
    convertTotalToHomeCurrency(breakdown.overallByCurrency, homeCurrency, convertAmount).then(total => {
      if (!cancelled) setHomeTotal(total);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content (JSON.stringify), not object identity, deliberately
  }, [JSON.stringify(breakdown.overallByCurrency), homeCurrency]);

  return (
    <div className="planning-cost-summary">
      <h2>Estimated cost</h2>
      <p className="planning-cost-summary__disclaimer">Estimates only — not actual spending.</p>

      <div className="planning-cost-summary__categories">
        {COST_CATEGORIES.map(category => {
          const amounts = breakdown.categoryTotals[category];
          const hasAny = Object.keys(amounts).length > 0;
          return (
            <div key={category} className="planning-cost-summary__category">
              <span className="planning-cost-summary__category-label">{COST_CATEGORY_LABELS[category]}</span>
              <span className="planning-cost-summary__category-amount">
                {hasAny
                  ? Object.entries(amounts).map(([currency, amount]) => `${currency === '—' ? '' : currency} ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`).join(' + ')
                  : '—'}
              </span>
            </div>
          );
        })}
      </div>

      <div className="planning-cost-summary__total">
        <span className="planning-cost-summary__total-label">Overall estimate</span>
        <span className="planning-cost-summary__total-amount">
          {Object.keys(breakdown.overallByCurrency).length > 0
            ? Object.entries(breakdown.overallByCurrency).map(([currency, amount]) => `${currency === '—' ? '' : currency} ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`).join(' + ')
            : 'Not estimated yet'}
        </span>
      </div>

      {homeTotal !== undefined && homeTotal !== null && (
        <p className="planning-cost-summary__home-total">≈ {homeCurrency} {homeTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
      )}

      {breakdown.unestimatedItems.length > 0 && (
        <p className="planning-cost-summary__unestimated">
          {breakdown.unestimatedItems.length} item{breakdown.unestimatedItems.length === 1 ? '' : 's'} not yet estimated.
        </p>
      )}

      {/* A small, inline way to change the global home currency —
          deliberately not a Settings page (none exists, and this
          correction explicitly asks not to build one). Changing it
          here affects every Planning's home-currency total, not just
          this one, since it's a single global setting. */}
      {homeCurrency && (
        <div className="planning-cost-summary__home-currency-picker">
          <Select
            label="Home currency"
            value={homeCurrency}
            onChange={e => handleHomeCurrencyChange(e.target.value)}
          >
            {[...new Set([...CORE_CURRENCIES, homeCurrency])].map(code => <option key={code} value={code}>{code}</option>)}
          </Select>
        </div>
      )}
    </div>
  );
}

function PlanningForm({ destinations, people, planning, onSaved }) {
  const base = planning || { destinationId: '', name: '', startDate: '', endDate: '', notes: '', travellerIds: [] };
  const [destinationId, setDestinationId] = useState(base.destinationId);
  const [name, setName] = useState(base.name);
  const [startDate, setStartDate] = useState(base.startDate);
  const [endDate, setEndDate] = useState(base.endDate);
  const [notes, setNotes] = useState(base.notes);
  const [travellerIds, setTravellerIds] = useState(base.travellerIds || []);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function toggleTraveller(id) {
    setTravellerIds(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!destinationId) { setError('Destination is required.'); return; }
    if (!name.trim()) { setError('Planning name is required.'); return; }
    if (!startDate) { setError('Start date is required.'); return; }
    if (!endDate) { setError('End date is required.'); return; }
    if (endDate < startDate) { setError('End date cannot be before start date.'); return; }
    setSubmitting(true);
    try {
      const fields = { name: name.trim(), startDate, endDate, notes, travellerIds };
      const saved = planning ? await updatePlanning(planning.id, fields) : await createPlanning(destinationId, fields);
      onSaved(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card padding="md" className="planning-form">
      <form onSubmit={handleSubmit}>
        <Select
          label="Destination"
          required
          value={destinationId}
          onChange={e => setDestinationId(e.target.value)}
          // A Planning's destination is fixed once created — Research
          // items are looked up by this id, so changing it after the
          // fact would silently disconnect existing Planning content
          // (including every timeline item added in Chunk 2/3). Locking
          // it on edit avoids inventing move-between-destinations
          // behavior that wasn't asked for.
          disabled={!!planning}
        >
          <option value="">Select a destination…</option>
          {destinations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>

        <Input label="Planning name" required autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Northern Sri Lanka, January 2026" />

        <div className="planning-form__dates">
          <Input label="Start date" type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} />
          <Input label="End date" type="date" required value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>

        <TextArea label="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3} />

        <div className="field">
          <span className="field__label">Travellers</span>
          {people.length === 0 ? (
            <p className="field__hint">No travellers yet — add people from the Travellers page first.</p>
          ) : (
            <div className="planning-form__travellers">
              {people.map(person => (
                <Checkbox key={person.id} label={person.name} checked={travellerIds.includes(person.id)} onChange={() => toggleTraveller(person.id)} />
              ))}
            </div>
          )}
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : (planning ? 'Save' : 'Create Planning')}</Button>
      </form>
    </Card>
  );
}

// Derived Days (Chunk 1), each day's plain timeline items (Chunk 2),
// and now (Chunk 3) each day's itinerary Option groups. Still no
// planningDays store — dayNumber -> calendar date is always computed
// fresh from the Planning's current startDate (see plannings.js's
// listPlanningDays). Items and groups are both keyed by dayNumber,
// which is exactly why they stay attached to "Day 1" when startDate
// shifts: nothing here is keyed by calendar date.
//
// A day's items split into two kinds, per the approved design:
//   - "ordinary" items: optionGroupId is null — ungrouped, always
//     current, exactly Chunk 2's behavior, unaffected by Chunk 3.
//   - "grouped" items: belong to one of the day's Option groups,
//     rendered under that group with Option tabs, a Selection-pending
//     indicator, and a way to pick the current Option.
function DaysTimeline({ planning, destinationId, timelineItems, optionGroups, researchByTypeAndId, travellerAges, currencyOptions, onChange }) {
  const [addingToDay, setAddingToDay] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [addingGroupToDay, setAddingGroupToDay] = useState(null);
  const [addingItemToOption, setAddingItemToOption] = useState(null); // { dayNumber, group, optionLabel }

  const days = listPlanningDays(planning);

  function sortByTime(items) {
    return [...items].sort((a, b) => {
      if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
      if (a.startTime) return -1;
      if (b.startTime) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }

  const ordinaryItemsByDay = {};
  const groupedItemsByGroupId = {};
  for (const item of timelineItems) {
    if (item.optionGroupId) {
      (groupedItemsByGroupId[item.optionGroupId] ||= []).push(item);
    } else {
      (ordinaryItemsByDay[item.dayNumber] ||= []).push(item);
    }
  }
  for (const dayNumber of Object.keys(ordinaryItemsByDay)) ordinaryItemsByDay[dayNumber] = sortByTime(ordinaryItemsByDay[dayNumber]);
  for (const groupId of Object.keys(groupedItemsByGroupId)) groupedItemsByGroupId[groupId] = sortByTime(groupedItemsByGroupId[groupId]);

  const groupsByDay = {};
  for (const group of optionGroups) (groupsByDay[group.dayNumber] ||= []).push(group);

  // Day-level indicator (Chunk 4): true if ANY item scheduled on this
  // day — ordinary or inside any Option, selected or not, since an
  // unselected Option's items are still "planned possibilities" worth
  // knowing about — has a critical or warning-level finding. Purely
  // derived for display; nothing here is persisted.
  function dayHasWarning(dayNumber, weekdayKey) {
    const dayItems = [
      ...(ordinaryItemsByDay[dayNumber] || []),
      ...(groupsByDay[dayNumber] || []).flatMap(g => groupedItemsByGroupId[g.id] || []),
    ];
    return dayItems.some(item => {
      if (!item.researchRefId) return false;
      const record = researchByTypeAndId[item.researchRefType]?.[item.researchRefId];
      if (!record) return false;
      const findings = validateTimelineItem({ item, record, weekdayKey });
      return Boolean(findings.openingHours);
    });
  }

  async function handleDeleteItem(item) {
    if (!window.confirm('Remove this item?')) return;
    await deleteTimelineItem(item.id);
    onChange();
  }

  async function handleSelectOption(group, optionLabel) {
    // Clicking the already-selected Option's tab clears the selection
    // back to "Selection pending" — a simple, explicit toggle, matching
    // the approved design's "unselecting reopens the pending state"
    // reasoning without needing a separate "clear" control.
    await selectOption(group.id, group.selectedOptionLabel === optionLabel ? null : optionLabel);
    onChange();
  }

  async function handleDeleteGroup(group) {
    const itemCount = (groupedItemsByGroupId[group.id] || []).length;
    const message = itemCount > 0
      ? `Delete this Option group? Its ${itemCount} item(s) will remain but will no longer belong to any Option.`
      : 'Delete this Option group?';
    if (!window.confirm(message)) return;
    // Deleting the group is intentionally non-destructive to its items
    // — they simply revert to plain, ungrouped timeline items (their
    // optionGroupId/optionLabel just become stale references pointing
    // at a soft-deleted group, treated the same as "no group" by the
    // rendering logic above, which only looks items up BY a group's
    // own id from the currently-active groups list).
    await deleteOptionGroup(group.id);
    onChange();
  }

  return (
    <div className="planning-days">
      <h2>Days</h2>
      <div className="planning-days__list planning-days__list--timeline">
        {days.map(day => {
          const dayGroups = groupsByDay[day.dayNumber] || [];
          const dayOrdinaryItems = ordinaryItemsByDay[day.dayNumber] || [];
          return (
            <Card key={day.dayNumber} padding="sm" className="planning-day">
              <div className="planning-day__header">
                <div>
                  <span className="planning-days__number">Day {day.dayNumber}</span>
                  <span className="planning-days__date">{day.date}</span>
                  {dayHasWarning(day.dayNumber, weekdayKeyForDate(day.date)) && (
                    <span className="planning-day__warning-badge" title="At least one item on this day has an opening-hours issue">⚠️</span>
                  )}
                </div>
                <div className="planning-day__header-actions">
                  <Button variant="secondary" size="sm" onClick={() => setAddingGroupToDay(day.dayNumber)}>+ Add Option group</Button>
                  <Button variant="secondary" size="sm" onClick={() => setAddingToDay(day.dayNumber)}>+ Add item</Button>
                </div>
              </div>

              {dayGroups.length === 0 && dayOrdinaryItems.length === 0 ? (
                <p className="planning-day__empty">Nothing scheduled yet.</p>
              ) : (
                <>
                  {dayGroups.map(group => (
                    <OptionGroupPanel
                      key={group.id}
                      group={group}
                      travellerAges={travellerAges}
                      items={groupedItemsByGroupId[group.id] || []}
                      researchByTypeAndId={researchByTypeAndId}
                      weekdayKey={weekdayKeyForDate(day.date)}
                      onSelectOption={(label) => handleSelectOption(group, label)}
                      onDeleteGroup={() => handleDeleteGroup(group)}
                      onEditItem={setEditingItem}
                      onDeleteItem={handleDeleteItem}
                      onAddItemToOption={(optionLabel) => setAddingItemToOption({ dayNumber: day.dayNumber, group, optionLabel })}
                      onAddNewOption={() => {
                        const existing = [...new Set((groupedItemsByGroupId[group.id] || []).map(i => i.optionLabel))];
                        const label = nextOptionLabel(existing);
                        if (label) setAddingItemToOption({ dayNumber: day.dayNumber, group, optionLabel: label });
                      }}
                    />
                  ))}

                  {dayOrdinaryItems.length > 0 && (
                    <ul className="planning-day__items">
                      {dayOrdinaryItems.map(item => (
                        <TimelineItemRow
                          key={item.id}
                          item={item}
                          researchByTypeAndId={researchByTypeAndId}
                          travellerAges={travellerAges}
                          weekdayKey={weekdayKeyForDate(day.date)}
                          onEdit={() => setEditingItem(item)}
                          onDelete={() => handleDeleteItem(item)}
                        />
                      ))}
                    </ul>
                  )}
                </>
              )}
            </Card>
          );
        })}
      </div>

      {addingToDay !== null && (
        <TimelineItemForm
          planningId={planning.id}
          destinationId={destinationId}
          researchByTypeAndId={researchByTypeAndId}
          travellerAges={travellerAges}
          currencyOptions={currencyOptions}
          dayNumber={addingToDay}
          onClose={() => setAddingToDay(null)}
          onSaved={() => { setAddingToDay(null); onChange(); }}
        />
      )}
      {editingItem !== null && (
        <TimelineItemForm
          planningId={planning.id}
          destinationId={destinationId}
          dayNumber={editingItem.dayNumber}
          record={editingItem}
          referencedRecord={editingItem.researchRefType ? researchByTypeAndId[editingItem.researchRefType]?.[editingItem.researchRefId] : null}
          researchByTypeAndId={researchByTypeAndId}
          travellerAges={travellerAges}
          currencyOptions={currencyOptions}
          onClose={() => setEditingItem(null)}
          onSaved={() => { setEditingItem(null); onChange(); }}
        />
      )}
      {addingGroupToDay !== null && (
        <OptionGroupForm
          planningId={planning.id}
          dayNumber={addingGroupToDay}
          onClose={() => setAddingGroupToDay(null)}
          onSaved={() => { setAddingGroupToDay(null); onChange(); }}
        />
      )}
      {addingItemToOption !== null && (
        <TimelineItemForm
          planningId={planning.id}
          destinationId={destinationId}
          researchByTypeAndId={researchByTypeAndId}
          travellerAges={travellerAges}
          currencyOptions={currencyOptions}
          dayNumber={addingItemToOption.dayNumber}
          partLabel={addingItemToOption.group.partLabel}
          optionGroupId={addingItemToOption.group.id}
          optionLabel={addingItemToOption.optionLabel}
          onClose={() => setAddingItemToOption(null)}
          onSaved={() => { setAddingItemToOption(null); onChange(); }}
        />
      )}
    </div>
  );
}

// One Itinerary Option group for a day-part — e.g. "Morning: Option A
// vs Option B". Distinct from Item Alternatives (managed per-item, see
// TimelineItemForm) per the approved design. Shows every Option that
// currently has at least one item, plus an explicit "+ Add new Option"
// action so the person isn't limited to only the Options that already
// exist — the group itself is created empty (see OptionGroupForm) and
// Options are populated by adding items to them one at a time.
function OptionGroupPanel({ group, items, researchByTypeAndId, travellerAges, weekdayKey, onSelectOption, onDeleteGroup, onEditItem, onDeleteItem, onAddItemToOption, onAddNewOption }) {
  const itemsByOption = {};
  for (const item of items) (itemsByOption[item.optionLabel] ||= []).push(item);
  const optionLabels = Object.keys(itemsByOption).sort();

  return (
    <div className="option-group">
      <div className="option-group__header">
        <span className="option-group__part-label">{group.partLabel}</span>
        {group.selectedOptionLabel === null ? (
          <span className="option-group__pending">⚠️ Selection pending</span>
        ) : (
          <span className="option-group__selected">Option {group.selectedOptionLabel} selected</span>
        )}
        <button type="button" className="entry-card__delete" onClick={onDeleteGroup}>Delete group</button>
      </div>

      <div className="option-group__options">
        {optionLabels.length === 0 && (
          <p className="option-group__empty">No Options yet — add items to Option A to get started.</p>
        )}
        {optionLabels.map(label => (
          <div key={label} className={`option-group__option${group.selectedOptionLabel === label ? ' option-group__option--selected' : ''}`}>
            <div className="option-group__option-header">
              <button type="button" className="option-group__option-tab" onClick={() => onSelectOption(label)}>
                Option {label}{group.selectedOptionLabel === label ? ' ✓' : ''}
              </button>
              <Button variant="secondary" size="sm" onClick={() => onAddItemToOption(label)}>+ Add item</Button>
            </div>
            <ul className="planning-day__items">
              {itemsByOption[label].map(item => (
                <TimelineItemRow
                  key={item.id}
                  item={item}
                  researchByTypeAndId={researchByTypeAndId}
                  travellerAges={travellerAges}
                  weekdayKey={weekdayKey}
                  onEdit={() => onEditItem(item)}
                  onDelete={() => onDeleteItem(item)}
                />
              ))}
            </ul>
          </div>
        ))}
        <Button variant="secondary" size="sm" onClick={onAddNewOption}>+ Add new Option</Button>
      </div>
    </div>
  );
}

// One row in a timeline list — used both for ordinary (ungrouped)
// items and for items inside an Option, so the two always look and
// behave the same way.
//
// Chunk 4: runs the pure validation checks (opening hours / typical
// duration / best-time) against the item's resolved Research record,
// purely for display — nothing here is persisted, and nothing here
// moves, blocks, or alters the item itself. This runs identically
// whether the item's Option is currently selected or not (an
// unselected Option's items are still worth flagging, since they're
// still a "planned possibility" per Chunk 3's own inclusion rules) —
// this component has no awareness of Option selection state at all,
// deliberately, since opening-hours/duration/best-time facts about a
// place don't depend on whether this particular sequence was chosen.
function TimelineItemRow({ item, researchByTypeAndId, travellerAges, weekdayKey, onEdit, onDelete }) {
  const referencedRecord = item.researchRefType ? researchByTypeAndId[item.researchRefType]?.[item.researchRefId] : null;
  const title = item.researchRefId ? describeReferencedRecord(item.researchRefType, referencedRecord) : item.title;
  const findings = item.researchRefId ? validateTimelineItem({ item, record: referencedRecord, weekdayKey }) : { openingHours: null, duration: null, bestTime: null };
  // This item's own cost estimate, shown regardless of whether its
  // Option is currently selected (an unselected Option's items are
  // still worth seeing an estimate for while comparing Options) —
  // whether it COUNTS toward the Planning total is decided separately,
  // in the cost summary, by the inclusion rules. Free/zero-cost items
  // with no costSelections at all and no Research reference (a plain
  // custom item nobody put a price on) simply show nothing rather than
  // a "not estimated" line, so the timeline isn't cluttered by every
  // free-time/custom entry.
  const cost = calculateItemCost(item, { record: referencedRecord, travellerAges, nights: item.researchRefType === 'accommodations' ? nightsForAccommodationItem(item) : undefined });
  const isCostBearingType = ['attractions', 'restaurants', 'accommodations', 'transport'].includes(item.researchRefType);

  return (
    <li className="planning-item" onClick={onEdit}>
      <div className="planning-item__main">
        <div className="planning-item__title-line">
          {item.startTime && <span className="planning-item__time">{item.startTime}</span>}
          <span className="planning-item__title">{title}</span>
          {item.status === 'optional' && <span className="planning-item__badge">Optional</span>}
        </div>
        <p className="planning-item__meta">
          {ITEM_TYPE_LABELS[item.itemType]}
          {item.plannedDuration ? ` · ${item.plannedDuration} min` : ''}
          {item.buffer ? ` · +${item.buffer} min buffer` : ''}
        </p>
        {item.notes && <p className="planning-item__notes">{item.notes}</p>}
        {cost.estimated && (
          <p className="planning-item__cost">Est. {cost.currency || ''} {cost.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}{cost.overridden ? ' (overridden)' : ''}</p>
        )}
        {!cost.estimated && isCostBearingType && (
          <p className="planning-item__cost planning-item__cost--unknown">Cost not estimated</p>
        )}
        {findings.openingHours && (
          <p className={`planning-item__finding planning-item__finding--${findings.openingHours.level}`}>
            {findings.openingHours.level === 'critical' ? '⚠️ ' : ''}{findings.openingHours.message}
          </p>
        )}
        {findings.duration && (
          <p className="planning-item__finding planning-item__finding--info">{findings.duration.message}</p>
        )}
        {findings.bestTime && (
          <p className="planning-item__finding planning-item__finding--hint">💡 {findings.bestTime.message}</p>
        )}
      </div>
      <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); onDelete(); }}>Delete</button>
    </li>
  );
}

// Explicit creation of an Option group for one day-part, per the
// approved instruction that the UI must provide a deliberate way to
// create/manage a group rather than only detecting multiple options
// after the fact. partLabel is free text — Morning/Afternoon/Evening
// are suggested via the placeholder, but any label is accepted, since
// parts are flexible, not a fixed enum, per the approved design.
function OptionGroupForm({ planningId, dayNumber, onClose, onSaved }) {
  const [partLabel, setPartLabel] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!partLabel.trim()) { setError('A part label is required (e.g. Morning, Afternoon, or a custom name).'); return; }
    setError('');
    setSubmitting(true);
    try {
      await createOptionGroup(planningId, { dayNumber, partLabel: partLabel.trim() });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`New Option group — Day ${dayNumber}`}>
      <form onSubmit={handleSubmit}>
        <Input label="Part of the day" required autoFocus placeholder="e.g. Morning, Afternoon, Evening" value={partLabel} onChange={e => setPartLabel(e.target.value)} />
        <p className="field__hint">You'll add items to Option A, Option B, etc. next.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Creating…' : 'Create Option group'}</Button>
      </form>
    </Modal>
  );
}

// Add/edit form for one timeline item. Two ways to give it content,
// per the approved Chunk 2 clarification: pick an existing Research
// record via ResearchPicker (Attractions/Restaurants/Accommodation/
// Transport only — the sections meaningful as itinerary content), or
// enter a free-text title for a custom/general item.
//
// When partLabel/optionGroupId/optionLabel are passed in (Chunk 3 —
// adding an item directly into a specific Option), they're applied
// automatically and are not user-editable here — an item's Option
// membership is set once, by which "+ Add item" button was used
// (inside an Option vs. the day's own ordinary "+ Add item"), not
// reassigned later in this chunk; moving an item between Options isn't
// something the approved design asked for, so it isn't invented here.
//
// rank/selected on the timeline item itself remain unexposed — they're
// inert for a timeline item's own purposes (see the design note atop
// timelineItems.js); rank/selected that matter in this chunk belong to
// Item Alternatives, managed below via ItemAlternativesPanel, shown
// only once an item is saved (an alternative needs a parent item id).
function TimelineItemForm({ planningId, destinationId, dayNumber, partLabel, optionGroupId, optionLabel, record, referencedRecord, researchByTypeAndId, travellerAges, currencyOptions, onClose, onSaved }) {
  const base = record || {};
  const [itemType, setItemType] = useState(base.itemType || 'custom');
  const [researchRef, setResearchRef] = useState(
    base.researchRefId ? { researchRefType: base.researchRefType, researchRefId: base.researchRefId, label: describeReferencedRecord(base.researchRefType, referencedRecord) } : null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [title, setTitle] = useState(base.title || '');
  const [startTime, setStartTime] = useState(base.startTime || '');
  const [plannedDuration, setPlannedDuration] = useState(base.plannedDuration ?? '');
  const [buffer, setBuffer] = useState(base.buffer ?? '');
  const [notes, setNotes] = useState(base.notes || '');
  const [status, setStatus] = useState(base.status || 'planned');
  const [costSelections, setCostSelections] = useState(base.costSelections || null);
  const [checkOutDayNumber, setCheckOutDayNumber] = useState(base.checkOutDayNumber ?? null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // The Research record for cost editing follows whatever is CURRENTLY
  // attached in this form (so picking a different Research item
  // immediately shows its own fee bands/prices), not just the record
  // the item was originally saved with.
  const currentRecord = researchRef ? (researchByTypeAndId?.[researchRef.researchRefType]?.[researchRef.researchRefId] || null) : null;

  function handlePicked(picked) {
    // Selections are specific to the Research record they were made
    // against (fee band ids, extra-charge labels) — a different record
    // has different bands, so carrying the old selections over would
    // just leave them dangling. Only reset when the referenced record
    // actually changes; re-picking the same one keeps its selections.
    // checkOutDayNumber is reset alongside costSelections whenever the
    // record itself changes to a different one, or to a non-
    // accommodation type, for the same reason — a stay-range only
    // means something in the context of a specific accommodation item.
    if (picked.researchRefId !== researchRef?.researchRefId) {
      setCostSelections(null);
      if (picked.researchRefType !== 'accommodations') setCheckOutDayNumber(null);
    }
    setResearchRef(picked);
    setPickerOpen(false);
  }

  function clearResearchRef() {
    setResearchRef(null);
    setCostSelections(null);
    setCheckOutDayNumber(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!researchRef && !title.trim()) { setError('Give this item a title, or attach it to a Research record.'); return; }
    // Same rule timelineItems.js's own store-level validation enforces
    // — checked here too so the person gets an inline error next to
    // the field, rather than only a generic thrown-error alert.
    if (checkOutDayNumber !== null && checkOutDayNumber <= dayNumber) {
      setError('Check-out day must be a later day than check-in.');
      return;
    }
    setSubmitting(true);
    try {
      const fields = {
        itemType,
        researchRefType: researchRef?.researchRefType || null,
        researchRefId: researchRef?.researchRefId || null,
        title: researchRef ? '' : title.trim(),
        startTime,
        plannedDuration: plannedDuration === '' ? null : Number(plannedDuration),
        buffer: buffer === '' ? null : Number(buffer),
        notes,
        status,
        costSelections,
        checkOutDayNumber: researchRef?.researchRefType === 'accommodations' ? checkOutDayNumber : null,
      };
      if (!record && optionGroupId) {
        // Only set when creating a NEW item directly into an Option —
        // an existing item's Option membership is not changed by this
        // form (see the comment above the component).
        fields.partLabel = partLabel;
        fields.optionGroupId = optionGroupId;
        fields.optionLabel = optionLabel;
      }
      if (record) await updateTimelineItem(record.id, fields);
      else await createTimelineItem(planningId, dayNumber, fields);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={
        record
          ? `Edit Day ${dayNumber} item`
          : optionGroupId
            ? `New item — Day ${dayNumber}, ${partLabel}, Option ${optionLabel}`
            : `New Day ${dayNumber} item`
      }
    >
      <form onSubmit={handleSubmit}>
        <Select label="Type" value={itemType} onChange={e => setItemType(e.target.value)}>
          {TIMELINE_ITEM_TYPES.map(t => <option key={t} value={t}>{ITEM_TYPE_LABELS[t]}</option>)}
        </Select>

        <div className="field">
          <span className="field__label">Content</span>
          {researchRef ? (
            <div className="timeline-item-form__ref">
              <span className="timeline-item-form__ref-label">{researchRef.label}</span>
              <button type="button" className="entry-card__delete" onClick={clearResearchRef}>Remove</button>
            </div>
          ) : (
            <>
              <Input placeholder="Title (e.g. Start travel to Ella)" aria-label="Item title" value={title} onChange={e => setTitle(e.target.value)} />
              <Button type="button" variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>Attach a Research item instead…</Button>
            </>
          )}
        </div>

        <div className="planning-form__dates">
          <Input label="Start time" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
          <Input label="Planned duration (min)" type="number" min="0" value={plannedDuration} onChange={e => setPlannedDuration(e.target.value)} />
        </div>
        <Input label="Buffer (min)" type="number" min="0" value={buffer} onChange={e => setBuffer(e.target.value)} />

        <TextArea label="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3} />

        <Select label="Status" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="planned">Planned</option>
          <option value="optional">Optional</option>
        </Select>

        <CostFields
          researchRefType={researchRef?.researchRefType || null}
          record={currentRecord}
          costSelections={costSelections}
          onChange={setCostSelections}
          travellerAges={travellerAges || []}
          dayNumber={dayNumber}
          checkOutDayNumber={checkOutDayNumber}
          onCheckOutDayNumberChange={setCheckOutDayNumber}
          currencyOptions={currencyOptions}
        />

        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>

      {pickerOpen && (
        <Modal open onClose={() => setPickerOpen(false)} title="Attach a Research item">
          <ResearchPicker destinationId={destinationId} onSelect={handlePicked} />
        </Modal>
      )}

      {record && (
        <ItemAlternativesPanel
          timelineItemId={record.id}
          destinationId={destinationId}
          researchByTypeAndId={researchByTypeAndId || {}}
          travellerAges={travellerAges || []}
          currencyOptions={currencyOptions}
          // An alternative has no check-in/check-out days of its own —
          // an alternative accommodation choice is understood to be
          // for the SAME stay as its parent item, so it reuses the
          // parent's already-computed nights rather than needing its
          // own day-range concept (which itemAlternatives.js's data
          // model deliberately doesn't have — see the design note in
          // ItemAlternativesPanel below).
          parentNights={record.researchRefType === 'accommodations' ? nightsForAccommodationItem(record) : undefined}
        />
      )}
    </Modal>
  );
}

// Per-item cost editing — the estimate/override relevant to whichever
// category this item belongs to, per the approved cost design.
// Deliberately different controls per researchRefType, since each
// category's cost model is genuinely different (explicit fee-band
// selection for Attractions vs. a simple override for
// Restaurants/Transport vs. nightly-rate + extra charges for
// Accommodation) — this mirrors calculateItemCost's own dispatch in
// lib/planningCosts.js rather than trying to force one generic form.
// A custom/other item (no Research reference at all) still gets the
// plain override field, since it's the only possible cost source for
// it (see calculateCustomItemCost).
function CostFields({ researchRefType, record, costSelections, onChange, travellerAges, dayNumber, checkOutDayNumber, onCheckOutDayNumberChange, currencyOptions, fixedNights }) {
  const selections = costSelections || {};

  function update(patch) {
    onChange({ ...selections, ...patch });
  }

  if (researchRefType === 'attractions') {
    if (!record) return null; // Research record not yet resolved/available — nothing to select fee bands from
    const selectedIds = selections.selectedFeeBandIds || [];
    const meaningfulBands = (record.feeBands || []).filter(b => !isFeeBandEmpty(b));
    const preview = calculateAttractionCost({ costSelections: selections, attraction: record, travellerAges });
    return (
      <div className="cost-fields">
        <h3>Cost estimate</h3>
        {meaningfulBands.length === 0 ? (
          <p className="cost-fields__not-estimated">This attraction has no fee information in Research yet.</p>
        ) : (
          <>
            <p className="cost-fields__reference">Choose which charges apply to your travellers:</p>
            {meaningfulBands.map(band => (
              <div key={band.id} className="cost-fields__fee-band">
                <Checkbox
                  label={`${band.label || 'Fee'} — ${formatSingleFeeBandAmount(band)}${band.minAge || band.maxAge ? ` (age ${band.minAge || '0'}–${band.maxAge || '∞'})` : ''}`}
                  checked={selectedIds.includes(band.id)}
                  onChange={() => update({ selectedFeeBandIds: selectedIds.includes(band.id) ? selectedIds.filter(id => id !== band.id) : [...selectedIds, band.id] })}
                />
              </div>
            ))}
            {preview.estimated ? (
              <p className="cost-fields__estimate">Estimated: {preview.currency} {preview.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
            ) : (
              <p className="cost-fields__not-estimated">Not estimated — select at least one applicable charge.</p>
            )}
          </>
        )}
      </div>
    );
  }

  if (researchRefType === 'restaurants' || researchRefType === 'transport') {
    const researchPrice = record?.price;
    const preview = researchRefType === 'restaurants'
      ? calculateRestaurantCost({ costSelections: selections, restaurant: record })
      : calculateTransportCost({ costSelections: selections, transport: record });
    return (
      <div className="cost-fields">
        <h3>Cost estimate</h3>
        {researchPrice && formatMoney(researchPrice) && (
          <p className="cost-fields__reference">Research reference price: {formatMoney(researchPrice)}</p>
        )}
        <MoneyField
          label="Planning estimate (optional override)"
          value={selections.estimateOverride}
          onChange={(value) => update({ estimateOverride: value })}
          currencies={currencyOptions}
          defaultCurrency={researchPrice?.currency}
        />
        {preview.estimated ? (
          <p className="cost-fields__estimate">Estimated: {preview.currency} {preview.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}{preview.overridden ? ' (overridden)' : ''}</p>
        ) : (
          <p className="cost-fields__not-estimated">Not estimated — no Research price and no override entered.</p>
        )}
      </div>
    );
  }

  if (researchRefType === 'accommodations') {
    const selectedCharges = selections.selectedExtraChargeLabels || [];
    // fixedNights (used by an item alternative — see ItemAlternativeForm)
    // skips the check-in/check-out day inputs entirely: an alternative
    // accommodation choice is for the same stay as its parent timeline
    // item, so it has no day-range of its own to edit.
    const previewNights = fixedNights !== undefined ? fixedNights : nightsForAccommodationItem({ dayNumber, checkOutDayNumber });
    const preview = calculateAccommodationCost({ costSelections: selections, accommodation: record, nights: previewNights });
    const checkOutError = fixedNights === undefined && checkOutDayNumber !== null && checkOutDayNumber !== '' && Number(checkOutDayNumber) <= dayNumber;
    return (
      <div className="cost-fields">
        <h3>Cost estimate</h3>
        {record?.price && formatMoney(record.price) && (
          <p className="cost-fields__reference">Research nightly rate: {formatMoney(record.price)}</p>
        )}
        {fixedNights !== undefined ? (
          <p className="cost-fields__reference">
            {fixedNights ? `${fixedNights} night${fixedNights === 1 ? '' : 's'} (same stay as the main item)` : 'Nights unknown — set a check-out day on the main item first.'}
          </p>
        ) : (
          <>
            <div className="planning-form__dates">
              <Input label="Check-in day" type="number" value={dayNumber} disabled hint="This item's own day — set by where it's placed on the itinerary." />
              <Input
                label="Check-out day"
                type="number"
                min={dayNumber + 1}
                value={checkOutDayNumber ?? ''}
                onChange={e => onCheckOutDayNumberChange(e.target.value === '' ? null : Number(e.target.value))}
                hint="The Planning day number this stay ends on."
              />
            </div>
            {checkOutError && <p className="form-error" role="alert">Check-out day must be a later day than check-in.</p>}
          </>
        )}
        {(record?.extraPersonCharges || []).length > 0 && (
          <div className="field">
            <span className="field__label">Extra-person charges</span>
            {record.extraPersonCharges.map(charge => (
              <Checkbox
                key={charge.label}
                label={`${charge.label} — ${formatMoney(charge.price) || 'no amount set'}`}
                checked={selectedCharges.includes(charge.label)}
                onChange={() => update({ selectedExtraChargeLabels: selectedCharges.includes(charge.label) ? selectedCharges.filter(l => l !== charge.label) : [...selectedCharges, charge.label] })}
              />
            ))}
          </div>
        )}
        <MoneyField
          label="Planning estimate (optional override — replaces the calculation above entirely)"
          value={selections.estimateOverride}
          onChange={(value) => update({ estimateOverride: value })}
          currencies={currencyOptions}
          defaultCurrency={record?.price?.currency}
        />
        {preview.estimated ? (
          <p className="cost-fields__estimate">Estimated: {preview.currency} {preview.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}{preview.overridden ? ' (overridden)' : ''}</p>
        ) : (
          <p className="cost-fields__not-estimated">
            {fixedNights !== undefined
              ? 'Not estimated — enter an override, or make sure Research has a nightly rate and the main item has a check-out day set.'
              : 'Not estimated — set a check-out day (or enter an override), and make sure Research has a nightly rate.'}
          </p>
        )}
      </div>
    );
  }

  // Custom/other item — the only possible source of a cost is a
  // Planning-entered override; Shopping-type items land here too
  // (Shopping is never one of TIMELINE_RESEARCH_REF_TYPES), matching
  // the requirement that Shopping never auto-contributes and only
  // counts if the person explicitly enters an estimate.
  const preview = calculateCustomItemCost({ costSelections: selections });
  return (
    <div className="cost-fields">
      <h3>Cost estimate (optional)</h3>
      <MoneyField
        label="Planning estimate"
        value={selections.estimateOverride}
        onChange={(value) => update({ estimateOverride: value })}
        currencies={currencyOptions}
      />
      {preview.estimated && (
        <p className="cost-fields__estimate">Estimated: {preview.currency} {preview.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
      )}
    </div>
  );
}

// Item Alternatives for one already-saved timeline item — a distinct
// mechanism from itinerary Options (see the design note atop
// itemAlternatives.js). Only shown when editing an existing item
// (alternatives need a parent item id, so a brand-new, unsaved item has
// nothing to attach them to yet — save the item first, then add
// alternatives). rank/selected are exposed here since this is exactly
// where they become meaningful, per the approved design; selection may
// remain unresolved, which is a valid, expected state — inclusion in
// the Planning is inherited entirely from the parent item's own
// Option context (see the design note atop itemAlternatives.js): an
// alternative under an item that belongs to a currently-unselected
// Option is not itself "included" any more than its parent item is.
function ItemAlternativesPanel({ timelineItemId, destinationId, researchByTypeAndId, travellerAges, currencyOptions, parentNights }) {
  const [adding, setAdding] = useState(false);
  const [editingAlt, setEditingAlt] = useState(null);

  const fetcher = useCallback(() => listAlternativesForItem(timelineItemId), [timelineItemId]);
  const { data: alternatives, refresh } = useCachedQuery(`item-alternatives:${timelineItemId}`, fetcher);

  async function handleDelete(alt) {
    if (!window.confirm('Remove this alternative?')) return;
    await deleteItemAlternative(alt.id);
    refresh();
  }

  async function handleSelect(alt) {
    // Selecting one alternative doesn't force-deselect the others here
    // — the approved design explicitly allows multiple planned
    // alternatives with an unresolved (or since-changed) selection;
    // this simple toggle mirrors handleSelectOption's own "click again
    // to clear" behavior for consistency.
    await updateItemAlternative(alt.id, { selected: !alt.selected });
    refresh();
  }

  return (
    <div className="item-alternatives">
      <div className="item-alternatives__header">
        <h3>Alternatives</h3>
        <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>+ Add alternative</Button>
      </div>
      {!alternatives || alternatives.length === 0 ? (
        <p className="field__hint">No alternatives yet. Selection may remain unresolved even once you add some.</p>
      ) : (
        <ul className="item-alternatives__list">
          {alternatives.map(alt => {
            const referencedRecord = alt.researchRefType ? researchByTypeAndId[alt.researchRefType]?.[alt.researchRefId] : null;
            const label = alt.researchRefId ? describeReferencedRecord(alt.researchRefType, referencedRecord) : alt.title;
            // Reuses the exact same per-item cost dispatch a timeline
            // item's own row uses (calculateItemCost) — an alternative
            // has the same researchRefType/costSelections shape as a
            // timeline item, so the same calculation rules apply with
            // no duplication. This is a display-only preview: whether
            // this estimate actually COUNTS toward the Planning total
            // is decided separately by inclusion context (selected +
            // parent currently included), computed in the cost
            // summary — showing it here doesn't imply it's included.
            const cost = calculateItemCost(alt, { record: referencedRecord, travellerAges, nights: parentNights });
            return (
              <li key={alt.id} className={`item-alternatives__item${alt.selected ? ' item-alternatives__item--selected' : ''}`}>
                <div className="item-alternatives__main">
                  <button type="button" className="item-alternatives__select" onClick={() => handleSelect(alt)}>
                    {alt.selected ? '✓ ' : ''}{label}{alt.rank ? ` (rank ${alt.rank})` : ''}
                  </button>
                  {cost.estimated && (
                    <span className="item-alternatives__cost">Est. {cost.currency || ''} {cost.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  )}
                </div>
                <div className="item-alternatives__actions">
                  <button type="button" className="item-alternatives__edit" onClick={() => setEditingAlt(alt)}>Edit</button>
                  <button type="button" className="entry-card__delete" onClick={() => handleDelete(alt)}>Delete</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {adding && (
        <ItemAlternativeForm
          timelineItemId={timelineItemId}
          destinationId={destinationId}
          researchByTypeAndId={researchByTypeAndId}
          travellerAges={travellerAges}
          currencyOptions={currencyOptions}
          parentNights={parentNights}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); refresh(); }}
        />
      )}
      {editingAlt && (
        <ItemAlternativeForm
          timelineItemId={timelineItemId}
          destinationId={destinationId}
          record={editingAlt}
          researchByTypeAndId={researchByTypeAndId}
          travellerAges={travellerAges}
          currencyOptions={currencyOptions}
          parentNights={parentNights}
          onClose={() => setEditingAlt(null)}
          onSaved={() => { setEditingAlt(null); refresh(); }}
        />
      )}
    </div>
  );
}

// Add/edit form for one item alternative. Mirrors TimelineItemForm's
// own shape closely on purpose (Research-or-title content, plus
// CostFields for the cost estimate) since an alternative IS, for cost
// purposes, the same kind of thing as a timeline item — same
// researchRefType values, same costSelections shape, same
// calculateItemCost dispatch. rank/selected (Chunk 3) remain editable
// here as before; cost fields are the only genuinely new part.
function ItemAlternativeForm({ timelineItemId, destinationId, record, researchByTypeAndId, travellerAges, currencyOptions, parentNights, onClose, onSaved }) {
  const base = record || {};
  const [researchRef, setResearchRef] = useState(
    base.researchRefId
      ? { researchRefType: base.researchRefType, researchRefId: base.researchRefId, label: describeReferencedRecord(base.researchRefType, researchByTypeAndId?.[base.researchRefType]?.[base.researchRefId]) }
      : null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [title, setTitle] = useState(base.title || '');
  const [notes, setNotes] = useState(base.notes || '');
  const [rank, setRank] = useState(base.rank ?? '');
  const [costSelections, setCostSelections] = useState(base.costSelections || null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const currentRecord = researchRef ? (researchByTypeAndId?.[researchRef.researchRefType]?.[researchRef.researchRefId] || null) : null;

  function handlePicked(picked) {
    if (picked.researchRefId !== researchRef?.researchRefId) setCostSelections(null);
    setResearchRef(picked);
    setPickerOpen(false);
  }

  function clearResearchRef() {
    setResearchRef(null);
    setCostSelections(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!researchRef && !title.trim()) { setError('Give this alternative a title, or attach it to a Research record.'); return; }
    setSubmitting(true);
    try {
      const fields = {
        researchRefType: researchRef?.researchRefType || null,
        researchRefId: researchRef?.researchRefId || null,
        title: researchRef ? '' : title.trim(),
        notes,
        rank: rank === '' ? null : Number(rank),
        costSelections,
      };
      if (record) await updateItemAlternative(record.id, fields);
      else await createItemAlternative(timelineItemId, fields);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={record ? 'Edit alternative' : 'New alternative'}>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <span className="field__label">Content</span>
          {researchRef ? (
            <div className="timeline-item-form__ref">
              <span className="timeline-item-form__ref-label">{researchRef.label}</span>
              <button type="button" className="entry-card__delete" onClick={clearResearchRef}>Remove</button>
            </div>
          ) : (
            <>
              <Input placeholder="Title (e.g. Backup restaurant)" aria-label="Alternative title" value={title} onChange={e => setTitle(e.target.value)} />
              <Button type="button" variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>Attach a Research item instead…</Button>
            </>
          )}
        </div>
        <Input label="Rank (optional)" type="number" min="1" value={rank} onChange={e => setRank(e.target.value)} />
        <TextArea label="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />

        {/* Reuses the exact same CostFields component a timeline item
            uses — no duplicated fee-band/override logic. An
            alternative has no check-in/check-out days of its own (see
            the design note where this form is opened, above) — an
            accommodation alternative is a different choice of PLACE
            for the same stay as its parent item, so its nights count
            is simply the parent's already-computed nights
            (parentNights), passed straight through as a fixed value
            rather than letting CostFields render its own check-in/
            check-out day inputs. */}
        <CostFields
          researchRefType={researchRef?.researchRefType || null}
          record={currentRecord}
          costSelections={costSelections}
          onChange={setCostSelections}
          travellerAges={travellerAges || []}
          fixedNights={parentNights}
          currencyOptions={currencyOptions}
        />

        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
      {pickerOpen && (
        <Modal open onClose={() => setPickerOpen(false)} title="Attach a Research item">
          <ResearchPicker destinationId={destinationId} onSelect={handlePicked} />
        </Modal>
      )}
    </Modal>
  );
}
