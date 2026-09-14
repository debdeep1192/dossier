import { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getDestination } from '../db/stores/destinations';
import { getCurrencyOptions, getDestinationDefaultCurrency, setDestinationDefaultCurrency, addDestinationCurrency, listExchangeRates, setExchangeRate, convertAmount } from '../db/currency.js';
import { useCachedQuery, invalidateCachedQuery } from '../hooks/useCachedQuery';
import Card from '../components/Card';
import Button from '../components/Button';
import { Input, Select } from '../components/Field';
import { LoadingState, ErrorState } from '../components/States';
import '../components/SectionPageLayout.css';

export default function CurrencySettingsPage() {
  const { destinationId } = useParams();
  const [newCurrency, setNewCurrency] = useState('');
  const [rateInputs, setRateInputs] = useState({});
  const [preview, setPreview] = useState(null);
  const [previewFrom, setPreviewFrom] = useState('INR');
  const [previewTo, setPreviewTo] = useState('USD');

  const fetcher = useCallback(async () => {
    const [destination, rates] = await Promise.all([getDestination(destinationId), listExchangeRates()]);
    return { destination, rates };
  }, [destinationId]);
  const { data, error, loading, refresh } = useCachedQuery(`currencySettings:${destinationId}`, fetcher);

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading currency settings…" />;

  const { destination, rates } = data;
  const currencies = getCurrencyOptions(destination);
  const defaultCurrency = getDestinationDefaultCurrency(destination);

  async function handleChangeDefault(code) {
    await setDestinationDefaultCurrency(destinationId, code);
    invalidateCachedQuery(`currencySettings:${destinationId}`);
    invalidateCachedQuery(`destination:${destinationId}`);
    refresh();
  }

  async function handleAddCurrency(e) {
    e.preventDefault();
    if (!newCurrency.trim()) return;
    await addDestinationCurrency(destinationId, newCurrency);
    setNewCurrency('');
    invalidateCachedQuery(`currencySettings:${destinationId}`);
    refresh();
  }

  async function handleSetRate(from, to) {
    const value = rateInputs[`${from}_${to}`];
    if (!value) return;
    await setExchangeRate(from, to, value);
    invalidateCachedQuery(`currencySettings:${destinationId}`);
    refresh();
  }

  async function handlePreview(from, to, amount) {
    const converted = await convertAmount(amount, from, to);
    setPreview({ from, to, amount, converted });
  }

  return (
    <div className="section-page">
      <div className="section-page__breadcrumb">
        <Link to="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/destinations/${destinationId}`}>{destination?.name}</Link>
        <span aria-hidden="true">/</span>
        <span>Currency</span>
      </div>
      <header className="section-page__header">
        <h1>Currency & Exchange Rates</h1>
      </header>

      <Card className="entry-card" style={{ display: 'block', marginBottom: 'var(--space-5)' }}>
        <p className="entry-card__meta" style={{ marginBottom: 'var(--space-3)' }}>
          New monetary fields for {destination.name} default to this currency. Changing it never rewrites amounts you've already saved — each of those keeps its own original currency permanently.
        </p>
        <Select label="Default currency" value={defaultCurrency} onChange={e => handleChangeDefault(e.target.value)}>
          {currencies.map(c => <option key={c} value={c}>{c}</option>)}
        </Select>
      </Card>

      <Card className="entry-card" style={{ display: 'block', marginBottom: 'var(--space-5)' }}>
        <p className="entry-card__meta" style={{ marginBottom: 'var(--space-3)' }}>
          Currencies available for this destination. INR and USD are always available. Original research amounts never change — exchange rates are only used for an approximate display conversion.
        </p>
        <div className="currency-page__chips">
          {currencies.map(c => <span key={c} className="badge badge--section">{c}{c === defaultCurrency ? ' (default)' : ''}</span>)}
        </div>
        <form onSubmit={handleAddCurrency} className="currency-page__add-form">
          <Input placeholder="Add currency code, e.g. THB" value={newCurrency} onChange={e => setNewCurrency(e.target.value)} />
          <Button type="submit" size="sm">Add</Button>
        </form>
      </Card>

      <h2>Exchange rates</h2>
      <p className="entry-card__meta" style={{ marginBottom: 'var(--space-4)' }}>
        Rates are set against USD — enter how much of each currency equals 1 USD. Dossier works out conversions between any two currencies you've added through USD automatically. Changing a rate only affects future display conversions — it never edits research records you've already saved.
      </p>

      {currencies.filter(c => c !== 'USD').map((code) => {
        const existing = rates.find(r => r.pair === `USD_${code}`);
        const inverseExisting = !existing && rates.find(r => r.pair === `${code}_USD`);
        const key = `USD_${code}`;
        return (
          <Card key={code} padding="sm" className="entry-card" style={{ marginBottom: 'var(--space-3)', display: 'block' }}>
            <p className="entry-card__title">1 USD = ? {code}</p>
            {existing ? (
              <p className="entry-card__meta">Current: 1 USD = {existing.rate} {code}</p>
            ) : inverseExisting ? (
              <p className="entry-card__meta">Current (derived from a saved {code} → USD rate): 1 USD ≈ {(1 / inverseExisting.rate).toFixed(4)} {code}</p>
            ) : (
              <p className="entry-card__meta">No rate set yet.</p>
            )}
            <div className="currency-page__rate-row">
              <Input
                type="number"
                step="0.0001"
                placeholder={`e.g. 88`}
                value={rateInputs[key] || ''}
                onChange={e => setRateInputs(prev => ({ ...prev, [key]: e.target.value }))}
              />
              <Button size="sm" onClick={() => handleSetRate('USD', code)}>Save rate</Button>
            </div>
          </Card>
        );
      })}

      {currencies.filter(c => c !== 'USD').length >= 2 && (
        <Card padding="sm" className="entry-card" style={{ marginBottom: 'var(--space-3)', display: 'block' }}>
          <p className="entry-card__title">Check a conversion</p>
          <p className="entry-card__meta" style={{ marginBottom: 'var(--space-2)' }}>Cross-currency conversions (e.g. LKR → INR) are worked out through USD automatically, using the rates above.</p>
          <div className="currency-page__rate-row">
            <Select aria-label="From currency" value={previewFrom} onChange={e => setPreviewFrom(e.target.value)}>
              {currencies.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Select aria-label="To currency" value={previewTo} onChange={e => setPreviewTo(e.target.value)}>
              {currencies.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Button size="sm" variant="ghost" onClick={() => handlePreview(previewFrom, previewTo, 100)}>Preview 100 {previewFrom}</Button>
          </div>
          {preview && preview.from === previewFrom && preview.to === previewTo && (
            <p className="entry-card__meta">
              {preview.converted !== null ? `100 ${preview.from} ≈ ${preview.converted.toFixed(2)} ${preview.to}` : `No rate available for ${preview.from} → ${preview.to} yet.`}
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
