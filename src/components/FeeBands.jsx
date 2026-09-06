import { Input, Select } from './Field';
import { CurrencyPicker } from './Money';
import { CORE_CURRENCIES } from '../db/currency.js';
import { FEE_STATUS_OPTIONS, emptyFeeBand } from '../lib/feeBands.js';
import './FeeBands.css';

export function FeeBandsField({ label = 'Entry fee', bands, onChange, currencies = CORE_CURRENCIES, defaultCurrency, onAddCurrency }) {
  const list = bands && bands.length > 0 ? bands : [emptyFeeBand()];

  function updateBand(index, patch) {
    onChange(list.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }

  function addBand() {
    onChange([...list, emptyFeeBand()]);
  }

  function removeBand(index) {
    const next = list.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : [emptyFeeBand()]);
  }

  return (
    <div className="fee-bands">
      <span className="fee-bands__label">{label}</span>
      {list.map((band, i) => (
        <div key={band.id || i} className="fee-bands__band">
          {list.length > 1 && (
            <Input placeholder="Label, e.g. Adult, Child" aria-label="Fee band label" value={band.label} onChange={e => updateBand(i, { label: e.target.value })} />
          )}
          <Select aria-label="Fee status" value={band.status} onChange={e => updateBand(i, { status: e.target.value })}>
            {FEE_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          {(band.status === 'paid' || band.status === 'nominal') && (
            <div className="fee-bands__amount-row">
              <Input type="number" min="0" step="0.01" placeholder="Amount" aria-label="Fee amount" value={band.amount} onChange={e => updateBand(i, { amount: e.target.value })} />
              <CurrencyPicker value={band.currency || defaultCurrency || ''} onChange={c => updateBand(i, { currency: c })} currencies={currencies} onAddCurrency={onAddCurrency} />
            </div>
          )}
          {list.length > 1 && (
            <div className="fee-bands__age-row">
              <Input type="number" min="0" placeholder="Min age (optional)" aria-label="Minimum age" value={band.minAge} onChange={e => updateBand(i, { minAge: e.target.value })} />
              <Input type="number" min="0" placeholder="Max age (optional)" aria-label="Maximum age" value={band.maxAge} onChange={e => updateBand(i, { maxAge: e.target.value })} />
            </div>
          )}
          {list.length > 1 && (
            <button type="button" className="fee-bands__remove" onClick={() => removeBand(i)}>Remove this band</button>
          )}
        </div>
      ))}
      <button type="button" className="fee-bands__add" onClick={addBand}>+ Add another fee band (e.g. for a child rate)</button>
    </div>
  );
}
