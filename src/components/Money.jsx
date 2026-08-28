import { useState } from 'react';
import { Input, Select } from './Field';
import { CORE_CURRENCIES } from '../db/currency.js';
import './Money.css';

// Standalone currency select with an inline "+ Add currency…" escape —
// reused by MoneyField and by FeeBandsField (which needs a currency
// picker without MoneyField's unit/note fields).
export function CurrencyPicker({ value, onChange, currencies = CORE_CURRENCIES, onAddCurrency, label }) {
  const [addingCurrency, setAddingCurrency] = useState(false);
  const [newCurrencyCode, setNewCurrencyCode] = useState('');

  async function handleSelect(e) {
    if (e.target.value === '__ADD__') { setAddingCurrency(true); return; }
    onChange(e.target.value);
  }

  async function handleAddConfirm() {
    if (!newCurrencyCode.trim() || !onAddCurrency) { setAddingCurrency(false); return; }
    const code = newCurrencyCode.trim().toUpperCase();
    await onAddCurrency(code);
    onChange(code);
    setNewCurrencyCode('');
    setAddingCurrency(false);
  }

  return (
    <>
      <Select aria-label={label || 'Currency'} value={value || ''} onChange={handleSelect}>
        <option value="">Currency</option>
        {currencies.map(c => <option key={c} value={c}>{c}</option>)}
        {onAddCurrency && <option value="__ADD__">+ Add currency…</option>}
      </Select>
      {addingCurrency && (
        <div className="money-field__row">
          <Input placeholder="Currency code, e.g. THB" autoFocus value={newCurrencyCode} onChange={e => setNewCurrencyCode(e.target.value)} />
          <button type="button" className="money-field__add-btn" onClick={handleAddConfirm}>Add</button>
        </div>
      )}
    </>
  );
}

// unitOptions, when provided, renders the unit as a controlled dropdown
// (with an "Other" escape to free text) instead of a free Input — used
// by sections where the unit is meaningful structured data for future
// cost calculations (restaurant party size, accommodation price basis,
// transport pricing basis). When omitted, unit stays a free-text hint,
// matching the original behavior for sections where it's just a note.
//
// currencies, when provided, drives the currency dropdown; otherwise
// falls back to the two core currencies. onAddCurrency, when provided,
// adds a "+ Add currency…" option that reveals a small inline prompt —
// this is what lets a destination's currency list grow (e.g. adding THB
// for a Thailand leg) without ever showing a giant permanent list.
export function MoneyField({ label = 'Price', value, onChange, currencies = CORE_CURRENCIES, defaultCurrency, unitOptions, defaultUnit, onAddCurrency }) {
  const amount = value?.amount ?? '';
  const currency = value?.currency ?? defaultCurrency ?? '';
  const unit = value?.unit ?? defaultUnit ?? '';
  const note = value?.note ?? '';
  const [unitOtherMode, setUnitOtherMode] = useState(false);

  function update(patch) {
    const next = { amount, currency, unit, note, ...patch };
    const isEmpty = next.amount === '' && !next.currency && !next.unit && !next.note;
    onChange(isEmpty ? null : next);
  }

  const showUnitSelect = Array.isArray(unitOptions) && unitOptions.length > 0;
  const unitIsCustom = showUnitSelect && (unitOtherMode || (unit && !unitOptions.includes(unit)));

  return (
    <div className="money-field">
      {label && <span className="money-field__label">{label}</span>}
      <div className="money-field__row">
        <Input type="number" min="0" step="0.01" placeholder="Amount" aria-label={`${label} amount`} value={amount} onChange={e => update({ amount: e.target.value })} />
        <CurrencyPicker value={currency} onChange={c => update({ currency: c })} currencies={currencies} onAddCurrency={onAddCurrency} label={`${label} currency`} />
      </div>
      {showUnitSelect ? (
        <>
          <Select aria-label={`${label} unit`} value={unitIsCustom ? 'OTHER' : unit} onChange={e => { if (e.target.value === 'OTHER') { setUnitOtherMode(true); update({ unit: '' }); } else { setUnitOtherMode(false); update({ unit: e.target.value }); } }}>
            <option value="">Unit</option>
            {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
            <option value="OTHER">Other…</option>
          </Select>
          {unitIsCustom && (
            <Input placeholder="Describe the unit" value={unit} onChange={e => update({ unit: e.target.value })} />
          )}
        </>
      ) : (
        <Input placeholder="Unit, e.g. per person, per night" aria-label={`${label} unit`} value={unit} onChange={e => update({ unit: e.target.value })} />
      )}
      <Input placeholder="Note" aria-label={`${label} note`} value={note} onChange={e => update({ note: e.target.value })} />
    </div>
  );
}

export function formatMoney(money) {
  if (!money) return null;
  const parts = [];
  if ((money.amount !== '' && money.amount !== undefined && money.amount !== null) || money.currency) {
    parts.push([money.currency, money.amount].filter(v => v !== '' && v !== undefined && v !== null).join(' '));
  }
  if (money.unit) parts.push(money.unit);
  let text = parts.join(' · ');
  if (money.note) text = text ? `${text} (${money.note})` : money.note;
  return text || null;
}

export function MoneyDisplay({ money }) {
  const text = formatMoney(money);
  if (!text) return null;
  return <span className="money-display tabular-nums">{text}</span>;
}

// Shows a converted approximation alongside the original — never
// replaces it. Renders nothing if no amount/currency or no rate is on
// file, rather than guessing a conversion.
export function ConvertedMoneyDisplay({ money, targetCurrency, convertedAmount }) {
  if (!money || !money.currency || convertedAmount === null || convertedAmount === undefined) return null;
  if (money.currency === targetCurrency) return null;
  return (
    <span className="money-display__converted tabular-nums">
      ≈ {targetCurrency} {convertedAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
    </span>
  );
}
