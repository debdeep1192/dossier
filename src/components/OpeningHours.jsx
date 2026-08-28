import { Input } from './Field';
import { OPENING_HOURS_DAYS, emptyOpeningHours } from '../lib/openingHours.js';
import './OpeningHours.css';

export function OpeningHoursField({ value, onChange }) {
  const groups = value && value.length > 0 ? value : emptyOpeningHours();

  function updateGroup(index, patch) {
    onChange(groups.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }

  function updateRange(groupIndex, rangeIndex, patch) {
    const group = groups[groupIndex];
    const ranges = group.ranges.map((r, i) => (i === rangeIndex ? { ...r, ...patch } : r));
    updateGroup(groupIndex, { ranges });
  }

  function addRange(groupIndex) {
    const group = groups[groupIndex];
    updateGroup(groupIndex, { ranges: [...group.ranges, { start: '', end: '' }] });
  }

  function removeRange(groupIndex, rangeIndex) {
    const group = groups[groupIndex];
    const ranges = group.ranges.filter((_, i) => i !== rangeIndex);
    updateGroup(groupIndex, { ranges: ranges.length > 0 ? ranges : [{ start: '', end: '' }] });
  }

  function addGroup() {
    onChange([...groups, { id: crypto.randomUUID(), days: [], ranges: [{ start: '', end: '' }] }]);
  }

  function removeGroup(index) {
    const next = groups.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : emptyOpeningHours());
  }

  function toggleDay(groupIndex, dayKey) {
    const group = groups[groupIndex];
    const days = group.days.includes('daily') ? [] : group.days;
    const nextDays = days.includes(dayKey) ? days.filter(d => d !== dayKey) : [...days, dayKey];
    updateGroup(groupIndex, { days: nextDays });
  }

  function setDaily(groupIndex) {
    updateGroup(groupIndex, { days: ['daily'] });
  }

  return (
    <div className="opening-hours">
      <span className="opening-hours__label">Opening hours</span>
      {groups.map((group, gi) => (
        <div key={group.id || gi} className="opening-hours__group">
          {groups.length > 1 && (
            <div className="opening-hours__day-picker">
              <button type="button" className={`opening-hours__day-chip ${group.days.includes('daily') ? 'opening-hours__day-chip--active' : ''}`} onClick={() => setDaily(gi)}>Daily</button>
              {OPENING_HOURS_DAYS.map(d => (
                <button
                  key={d.key}
                  type="button"
                  className={`opening-hours__day-chip ${group.days.includes(d.key) ? 'opening-hours__day-chip--active' : ''}`}
                  onClick={() => toggleDay(gi, d.key)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}
          {group.ranges.map((range, ri) => (
            <div key={ri} className="opening-hours__range-row">
              <Input type="time" aria-label="Opens at" value={range.start} onChange={e => updateRange(gi, ri, { start: e.target.value })} />
              <span aria-hidden="true">–</span>
              <Input type="time" aria-label="Closes at" value={range.end} onChange={e => updateRange(gi, ri, { end: e.target.value })} />
              {group.ranges.length > 1 && (
                <button type="button" className="opening-hours__remove-range" onClick={() => removeRange(gi, ri)} aria-label="Remove this time range">×</button>
              )}
            </div>
          ))}
          <button type="button" className="opening-hours__add-range" onClick={() => addRange(gi)}>+ Add another time range (split hours)</button>
          {groups.length > 1 && (
            <button type="button" className="opening-hours__remove-group" onClick={() => removeGroup(gi)}>Remove this day group</button>
          )}
        </div>
      ))}
      <button type="button" className="opening-hours__add-group" onClick={addGroup}>+ Different hours on specific days</button>
    </div>
  );
}
