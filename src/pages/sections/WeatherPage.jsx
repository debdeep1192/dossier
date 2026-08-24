import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getDestination } from '../../db/stores/destinations';
import { listWeatherNotes, createWeatherNote, updateWeatherNote, deleteWeatherNote, emptyWeatherNote } from '../../db/stores/weatherNotes';
import { useCachedQuery, invalidateCachedQuery, invalidateCachedQueryPrefix } from '../../hooks/useCachedQuery';
import SectionPageLayout from '../../components/SectionPageLayout';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { Input, TextArea } from '../../components/Field';
import { EmptyState, LoadingState, ErrorState } from '../../components/States';

export default function WeatherPage() {
  const { destinationId } = useParams();
  const [editing, setEditing] = useState(null);

  const fetcher = useCallback(async () => {
    const [destination, items] = await Promise.all([getDestination(destinationId), listWeatherNotes(destinationId)]);
    return { destination, items };
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
        <EmptyState icon="☀️" title="No weather notes yet" description="Best time to visit, seasonal patterns, climate notes." actionLabel="+ Add" onAction={() => setEditing({})} />
      ) : (
        items.map(item => (
          <Card key={item.id} interactive padding="sm" accentColor="var(--color-saffron)" className="entry-card" onClick={() => setEditing(item)}>
            <div className="entry-card__main">
              <span className="entry-card__title">{item.period}</span>
              {item.description && <p className="entry-card__meta">{item.description}</p>}
              {item.recommendation && <p className="entry-card__meta">{item.recommendation}</p>}
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
  const [recommendation, setRecommendation] = useState(base.recommendation || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!period.trim()) { setError('Give this a period, e.g. "December–February".'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fields = { period: period.trim(), description, recommendation };
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
        <Input label="Period" required autoFocus value={period} onChange={e => setPeriod(e.target.value)} placeholder="e.g. December–February" />
        <TextArea label="Description" value={description} onChange={e => setDescription(e.target.value)} rows={3} />
        <TextArea label="Recommendation" value={recommendation} onChange={e => setRecommendation(e.target.value)} rows={2} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}
