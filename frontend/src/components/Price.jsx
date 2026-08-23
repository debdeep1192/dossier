import { Input, Select } from './Field';
import './Price.css';

// A small, fixed set of common travel-research currencies plus an
// "Other" escape hatch (free text) — not a currency-management system,
// just enough to make the common case (INR home, LKR/USD/EUR/etc. while
// researching) one tap instead of typing a code every time.
const COMMON_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'LKR', 'THB', 'AED', 'SGD', 'JPY'];

// Structured price editor: amount + currency + unit + note. Never
// silently converts or overwrites the original currency — this is the
// only place a price is entered, and it always stores exactly what the
// person typed.
export function PriceField({ label = 'Price', value, onChange }) {
  const amount = value?.amount ?? '';
  const currency = value?.currency ?? '';
  const unit = value?.unit ?? '';
  const note = value?.note ?? '';

  function update(patch) {
    const next = { amount, currency, unit, note, ...patch };
    // Treat a fully-empty price as "no price" rather than an empty
    // object, so callers can rely on `value == null` to mean "not set."
    const isEmpty = !next.amount && !next.currency && !next.unit && !next.note;
    onChange(isEmpty ? null : next);
  }

  return (
    <div className="price-field">
      <span className="price-field__label">{label}</span>
      <div className="price-field__row">
        <Input
          type="number"
          min="0"
          step="0.01"
          placeholder="Amount"
          aria-label={`${label} amount`}
          value={amount}
          onChange={e => update({ amount: e.target.value })}
        />
        <Select
          aria-label={`${label} currency`}
          value={COMMON_CURRENCIES.includes(currency) ? currency : (currency ? 'OTHER' : '')}
          onChange={e => update({ currency: e.target.value === 'OTHER' ? '' : e.target.value })}
        >
          <option value="">Currency</option>
          {COMMON_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          <option value="OTHER">Other…</option>
        </Select>
      </div>
      {!COMMON_CURRENCIES.includes(currency) && currency !== '' && (
        <Input
          placeholder="Currency code, e.g. VND"
          aria-label={`${label} currency code`}
          value={currency}
          onChange={e => update({ currency: e.target.value.toUpperCase() })}
        />
      )}
      {(currency && currency !== 'OTHER') || amount ? (
        <div className="price-field__row">
          <Input
            placeholder="Unit, e.g. per person, per night"
            aria-label={`${label} unit`}
            value={unit}
            onChange={e => update({ unit: e.target.value })}
          />
        </div>
      ) : null}
      <Input
        placeholder="Note, e.g. children under 5 free"
        aria-label={`${label} note`}
        value={note}
        onChange={e => update({ note: e.target.value })}
      />
    </div>
  );
}

// Formats a structured price for display. Always shows the ORIGINAL
// currency and amount — this is not a conversion display.
export function formatPrice(price) {
  if (!price) return null;
  const parts = [];
  if (price.amount || price.currency) {
    parts.push([price.currency, price.amount].filter(Boolean).join(' '));
  }
  if (price.unit) parts.push(price.unit);
  let text = parts.join(' · ');
  if (price.note) text = text ? `${text} (${price.note})` : price.note;
  return text || null;
}

export function PriceDisplay({ price }) {
  const text = formatPrice(price);
  if (!text) return null;
  return <span className="price-display">{text}</span>;
}
