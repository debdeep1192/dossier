import { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getDestination } from '../db/stores/destinations';
import { getCurrencyOptions, addDestinationCurrency, listExchangeRates, setExchangeRate, convertAmount } from '../db/currency.js';
import { useCachedQuery, invalidateCachedQuery } from '../hooks/useCachedQuery';
import Card from '../components/Card';
import Button from '../components/Button';
import { Input } from '../components/Field';
import { LoadingState, ErrorState } from '../components/States';
import '../components/SectionPageLayout.css';

export default function CurrencySettingsPage() {
  const { destinationId } = useParams();
  const [newCurrency, setNewCurrency] = useState('');
  const [rateInputs, setRateInputs] = useState({});
  const [preview, setPreview] = useState(null);

  const fetcher = useCallback(async () => {
    const [destination, rates] = await Promise.all([getDestination(destinationId), listExchangeRates()]);
    return { destination, rates };
  }, [destinationId]);
  const { data, error, loading, refresh } = useCachedQuery(`currencySettings:${destinationId}`, fetcher);

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading currency settings…" />;

  const { destination, rates } = data;
  const currencies = getCurrencyOptions(destination);

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
        <Link to="/">Research</Link>
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
          Currencies available for this destination. INR and USD are always available. Original research amounts never change — exchange rates are only used for an approximate display conversion.
        </p>
        <div className="currency-page__chips">
          {currencies.map(c => <span key={c} className="badge badge--section">{c}</span>)}
        </div>
        <form onSubmit={handleAddCurrency} className="currency-page__add-form">
          <Input placeholder="Add currency code, e.g. THB" value={newCurrency} onChange={e => setNewCurrency(e.target.value)} />
          <Button type="submit" size="sm">Add</Button>
        </form>
      </Card>

      <h2>Exchange rates</h2>
      <p className="entry-card__meta" style={{ marginBottom: 'var(--space-4)' }}>Set a rate between any two currencies you're using. Changing a rate only affects future display conversions — it never edits research records you've already saved.</p>

      {currencies.flatMap((from, i) => currencies.slice(i + 1).map(to => (
        <Card key={`${from}_${to}`} padding="sm" className="entry-card" style={{ marginBottom: 'var(--space-3)', display: 'block' }}>
          <p className="entry-card__title">{from} → {to}</p>
          {(() => {
            const existing = rates.find(r => r.pair === `${from}_${to}`);
            return existing ? <p className="entry-card__meta">Current rate: 1 {from} = {existing.rate} {to}</p> : <p className="entry-card__meta">No rate set yet.</p>;
          })()}
          <div className="currency-page__rate-row">
            <Input
              type="number"
              step="0.0001"
              placeholder={`e.g. 1 ${from} = ? ${to}`}
              value={rateInputs[`${from}_${to}`] || ''}
              onChange={e => setRateInputs(prev => ({ ...prev, [`${from}_${to}`]: e.target.value }))}
            />
            <Button size="sm" onClick={() => handleSetRate(from, to)}>Save rate</Button>
            <Button size="sm" variant="ghost" onClick={() => handlePreview(from, to, 100)}>Preview 100 {from}</Button>
          </div>
          {preview && preview.from === from && preview.to === to && (
            <p className="entry-card__meta">
              {preview.converted !== null ? `100 ${from} ≈ ${preview.converted.toFixed(2)} ${to}` : 'No rate set for this pair yet.'}
            </p>
          )}
        </Card>
      )))}
    </div>
  );
}
