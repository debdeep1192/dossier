import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getDestination } from '../../db/stores/destinations';
import { listWeatherNotes, createWeatherNote, updateWeatherNote, deleteWeatherNote, emptyWeatherNote, normalizeWeatherNote } from '../../db/stores/weatherNotes';
import { useCachedQuery, invalidateCachedQuery, invalidateCachedQueryPrefix } from '../../hooks/useCachedQuery';
import SectionPageLayout from '../../components/SectionPageLayout';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { Input, TextArea, Select } from '../../components/Field';
import { EmptyState, LoadingState, ErrorState } from '../../components/States';
import { WEATHER_PRECIPITATION_LEVELS, WEATHER_RECOMMENDATIONS, MONTHS } from '../../lib/weatherOptions.js';

const RECOMMENDATION_LABEL = Object.fromEntries(WEATHER_RECOMMENDATIONS.map(r => [r.value, r.label]));

export default function WeatherPage() {
  const { destinationId } = useParams();
  const [editing, setEditing] = useState(null);

  const fetcher = useCallback(async () => {
    const [destination, rawItems] = await Promise.all([getDestination(destinationId), listWeatherNotes(destinationId)]);
    return { destination, items: rawItems.map(normalizeWeatherNote) };
  }, [destinationId]);
  const { data, error, loading, refresh } = useCachedQuery(`weatherNotes:${destinationId}`, fetcher);

  function afterMutation() {
    invalidateCachedQuery(`weatherNotes:${destinationId}`);
    invalidateCachedQueryPrefix(`destination:${destinationId}`);
    refresh();
  }

  async function handleDelete(item) {
    if (!window.confirm(`Delete "${item.period}"?`)) return;
    await deleteWeatherNote(item.id);
    afterMutation();
  }

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading weather notes…" />;

  const { destination, items } = data;

  return (
    <SectionPageLayout destination={destination} destinationId={destinationId} title="Weather & Best Time" onAdd={() => setEditing({})}>
      {items.length === 0 ? (
        <EmptyState icon="☀️" title="No weather notes yet" description="Describe the year — pick months or a range, then add typical conditions." actionLabel="+ Add" onAction={() => setEditing({})} />
      ) : (
        items.map(item => (
          <Card key={item.id} interactive padding="sm" accentColor="var(--color-saffron)" className="entry-card" onClick={() => setEditing(item)}>
            <div className="entry-card__main">
              <div className="entry-card__title-line">
                <span className="entry-card__title">{item.period}</span>
                {item.recommendation && <span className={`badge weather-recommendation weather-recommendation--${item.recommendation}`}>{RECOMMENDATION_LABEL[item.recommendation]}</span>}
              </div>
              {(item.temperatureMin || item.temperatureMax) && (
                <p className="entry-card__meta">{item.temperatureMin || '?'}–{item.temperatureMax || '?'}°{item.temperatureUnit || 'C'}</p>
              )}
              <p className="entry-card__meta">Rain: {item.rain || 'Rare'} · Snow: {item.snow || 'Rare'}</p>
              {item.description && <p className="entry-card__meta">{item.description}</p>}
            </div>
            <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); handleDelete(item); }}>Delete</button>
          </Card>
        ))
      )}

      {editing !== null && (
        <WeatherForm destinationId={destinationId} record={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); afterMutation(); }} />
      )}
    </SectionPageLayout>
  );
}

function WeatherForm({ destinationId, record, onClose, onSaved }) {
  const base = record || emptyWeatherNote();
  const [period, setPeriod] = useState(base.period || '');
  const [description, setDescription] = useState(base.description || '');
  const [temperatureMin, setTemperatureMin] = useState(base.temperatureMin ?? '');
  const [temperatureMax, setTemperatureMax] = useState(base.temperatureMax ?? '');
  const [temperatureUnit, setTemperatureUnit] = useState(base.temperatureUnit || 'C');
  const [rain, setRain] = useState(base.rain || 'Rare');
  const [snow, setSnow] = useState(base.snow || 'Rare');
  const [recommendation, setRecommendation] = useState(base.recommendation || '');
  const [recommendationNotes, setRecommendationNotes] = useState(base.recommendationNotes || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function handlePresetPick(e) {
    const v = e.target.value;
    if (v) setPeriod(v);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!period.trim()) { setError('Give this a period, e.g. "December–February" or pick a month.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fields = { period: period.trim(), description, temperatureMin, temperatureMax, temperatureUnit, rain, snow, recommendation, recommendationNotes };
      if (record) await updateWeatherNote(record.id, fields);
      else await createWeatherNote(destinationId, fields);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={record ? 'Edit Weather Note' : 'New Weather Note'}>
      <form onSubmit={handleSubmit}>
        <Select label="Pick a month (optional shortcut)" value="" onChange={handlePresetPick}>
          <option value="">Or type a custom period below…</option>
          {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
        </Select>
        <Input label="Period" required value={period} onChange={e => setPeriod(e.target.value)} placeholder="e.g. December–February, or a single month" />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-2)' }}>
          <Input label="Min temp" type="number" value={temperatureMin} onChange={e => setTemperatureMin(e.target.value)} />
          <Input label="Max temp" type="number" value={temperatureMax} onChange={e => setTemperatureMax(e.target.value)} />
          <Select label="Unit" value={temperatureUnit} onChange={e => setTemperatureUnit(e.target.value)}>
            <option value="C">°C</option>
            <option value="F">°F</option>
          </Select>
        </div>

        <Select label="Rain" value={rain} onChange={e => setRain(e.target.value)}>
          {WEATHER_PRECIPITATION_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
        </Select>
        <Select label="Snow" value={snow} onChange={e => setSnow(e.target.value)}>
          {WEATHER_PRECIPITATION_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
        </Select>

        <Select label="Recommendation" value={recommendation} onChange={e => setRecommendation(e.target.value)}>
          <option value="">Not set</option>
          {WEATHER_RECOMMENDATIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </Select>
        <TextArea label="Recommendation notes (optional)" value={recommendationNotes} onChange={e => setRecommendationNotes(e.target.value)} rows={2} />

        <TextArea label="Description" value={description} onChange={e => setDescription(e.target.value)} rows={3} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}
