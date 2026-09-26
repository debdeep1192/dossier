import { useState, useCallback } from 'react';
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
    // Research records referenced by timeline items are resolved here,
    // once, for the whole page — never duplicated onto the timeline
    // item itself. Only fetched for the ref types actually in use.
    const researchByTypeAndId = {};
    if (planning) {
      const refTypesUsed = [...new Set(timelineItems.map(i => i.researchRefType).filter(Boolean))];
      const sectionListFns = { attractions: listAttractions, restaurants: listRestaurantEntries, accommodations: listAccommodations, transport: listTransportEntries };
      await Promise.all(refTypesUsed.map(async (type) => {
        const records = await sectionListFns[type](planning.destinationId);
        researchByTypeAndId[type] = Object.fromEntries(records.map(r => [r.id, r]));
      }));
    }
    return { destinations, people, planning, destination, timelineItems, optionGroups, researchByTypeAndId };
  }, [planningId, isNew]);
  const { data, error, loading, refresh } = useCachedQuery(`planning:${planningId || 'new'}`, fetcher);

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading…" />;

  const { destinations, people, planning, destination, timelineItems, optionGroups, researchByTypeAndId } = data;

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
          onChange={afterTimelineChange}
        />
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
function DaysTimeline({ planning, destinationId, timelineItems, optionGroups, researchByTypeAndId, onChange }) {
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
                      items={groupedItemsByGroupId[group.id] || []}
                      researchByTypeAndId={researchByTypeAndId}
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
function OptionGroupPanel({ group, items, researchByTypeAndId, onSelectOption, onDeleteGroup, onEditItem, onDeleteItem, onAddItemToOption, onAddNewOption }) {
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
function TimelineItemRow({ item, researchByTypeAndId, onEdit, onDelete }) {
  const referencedRecord = item.researchRefType ? researchByTypeAndId[item.researchRefType]?.[item.researchRefId] : null;
  const title = item.researchRefId ? describeReferencedRecord(item.researchRefType, referencedRecord) : item.title;
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
function TimelineItemForm({ planningId, destinationId, dayNumber, partLabel, optionGroupId, optionLabel, record, referencedRecord, researchByTypeAndId, onClose, onSaved }) {
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
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function handlePicked(picked) {
    setResearchRef(picked);
    setPickerOpen(false);
  }

  function clearResearchRef() {
    setResearchRef(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!researchRef && !title.trim()) { setError('Give this item a title, or attach it to a Research record.'); return; }
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

        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>

      {pickerOpen && (
        <Modal open onClose={() => setPickerOpen(false)} title="Attach a Research item">
          <ResearchPicker destinationId={destinationId} onSelect={handlePicked} />
        </Modal>
      )}

      {record && <ItemAlternativesPanel timelineItemId={record.id} destinationId={destinationId} researchByTypeAndId={researchByTypeAndId || {}} />}
    </Modal>
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
function ItemAlternativesPanel({ timelineItemId, destinationId, researchByTypeAndId }) {
  const [adding, setAdding] = useState(false);

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
            return (
              <li key={alt.id} className={`item-alternatives__item${alt.selected ? ' item-alternatives__item--selected' : ''}`}>
                <button type="button" className="item-alternatives__select" onClick={() => handleSelect(alt)}>
                  {alt.selected ? '✓ ' : ''}{label}{alt.rank ? ` (rank ${alt.rank})` : ''}
                </button>
                <button type="button" className="entry-card__delete" onClick={() => handleDelete(alt)}>Delete</button>
              </li>
            );
          })}
        </ul>
      )}
      {adding && (
        <ItemAlternativeForm
          timelineItemId={timelineItemId}
          destinationId={destinationId}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); refresh(); }}
        />
      )}
    </div>
  );
}

function ItemAlternativeForm({ timelineItemId, destinationId, onClose, onSaved }) {
  const [researchRef, setResearchRef] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [rank, setRank] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!researchRef && !title.trim()) { setError('Give this alternative a title, or attach it to a Research record.'); return; }
    setSubmitting(true);
    try {
      await createItemAlternative(timelineItemId, {
        researchRefType: researchRef?.researchRefType || null,
        researchRefId: researchRef?.researchRefId || null,
        title: researchRef ? '' : title.trim(),
        notes,
        rank: rank === '' ? null : Number(rank),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="New alternative">
      <form onSubmit={handleSubmit}>
        <div className="field">
          <span className="field__label">Content</span>
          {researchRef ? (
            <div className="timeline-item-form__ref">
              <span className="timeline-item-form__ref-label">{researchRef.label}</span>
              <button type="button" className="entry-card__delete" onClick={() => setResearchRef(null)}>Remove</button>
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
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
      {pickerOpen && (
        <Modal open onClose={() => setPickerOpen(false)} title="Attach a Research item">
          <ResearchPicker destinationId={destinationId} onSelect={(picked) => { setResearchRef(picked); setPickerOpen(false); }} />
        </Modal>
      )}
    </Modal>
  );
}
