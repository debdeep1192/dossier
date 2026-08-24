import { Input, Select } from './Field';
import './Money.css';

const COMMON_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'LKR', 'THB', 'AED', 'SGD', 'JPY'];

export function MoneyField({ label = 'Price', value, onChange }) {
  const amount = value?.amount ?? '';
  const currency = value?.currency ?? '';
  const unit = value?.unit ?? '';
  const note = value?.note ?? '';

  function update(patch) {
    const next = { amount, currency, unit, note, ...patch };
    const isEmpty = next.amount === '' && !next.currency && !next.unit && !next.note;
    onChange(isEmpty ? null : next);
  }

  return (
    <div className="money-field">
      <span className="money-field__label">{label}</span>
      <div className="money-field__row">
        <Input type="number" min="0" step="0.01" placeholder="Amount" aria-label={`${label} amount`} value={amount} onChange={e => update({ amount: e.target.value })} />
        <Select aria-label={`${label} currency`} value={COMMON_CURRENCIES.includes(currency) ? currency : (currency ? 'OTHER' : '')} onChange={e => update({ currency: e.target.value === 'OTHER' ? '' : e.target.value })}>
          <option value="">Currency</option>
          {COMMON_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          <option value="OTHER">Other…</option>
        </Select>
      </div>
      {!COMMON_CURRENCIES.includes(currency) && currency !== '' && (
        <Input placeholder="Currency code" aria-label={`${label} currency code`} value={currency} onChange={e => update({ currency: e.target.value.toUpperCase() })} />
      )}
      <Input placeholder="Unit, e.g. per person, per night" aria-label={`${label} unit`} value={unit} onChange={e => update({ unit: e.target.value })} />
      <Input placeholder="Note" aria-label={`${label} note`} value={note} onChange={e => update({ note: e.target.value })} />
    </div>
  );
}

export function formatMoney(money) {
  if (!money) return null;
  const parts = [];
  if (money.amount !== '' && money.amount !== undefined && money.amount !== null || money.currency) {
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
