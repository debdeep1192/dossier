import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getDestination } from '../../db/stores/destinations';
import { listPracticalInfoEntries, createPracticalInfoEntry, updatePracticalInfoEntry, deletePracticalInfoEntry, emptyPracticalInfoEntry } from '../../db/stores/practicalInfo';
import { useCachedQuery, invalidateCachedQuery, invalidateCachedQueryPrefix } from '../../hooks/useCachedQuery';
import SectionPageLayout from '../../components/SectionPageLayout';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { Input, TextArea } from '../../components/Field';
import { EmptyState, LoadingState, ErrorState } from '../../components/States';

export default function PracticalInfoPage() {
  const { destinationId } = useParams();
  const [editing, setEditing] = useState(null);

  const fetcher = useCallback(async () => {
    const [destination, items] = await Promise.all([getDestination(destinationId), listPracticalInfoEntries(destinationId)]);
    return { destination, items };
  }, [destinationId]);
  const { data, error, loading, refresh } = useCachedQuery(`practicalInfo:${destinationId}`, fetcher);

  function afterMutation() {
    invalidateCachedQuery(`practicalInfo:${destinationId}`);
    invalidateCachedQueryPrefix(`destination:${destinationId}`);
    refresh();
  }

  async function handleDelete(item) {
    if (!window.confirm(`Delete "${item.topic}"?`)) return;
    await deletePracticalInfoEntry(item.id);
    afterMutation();
  }

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading practical info…" />;

  const { destination, items } = data;

  return (
    <SectionPageLayout destination={destination} destinationId={destinationId} title="Practical Info" onAdd={() => setEditing({})}>
      {items.length === 0 ? (
        <EmptyState icon="🛂" title="No practical info yet" description="Visas, connectivity, safety, local customs — anything practical." actionLabel="+ Add" onAction={() => setEditing({})} />
      ) : (
        items.map(item => (
          <Card key={item.id} interactive padding="sm" accentColor="var(--color-teal-dark)" className="entry-card" onClick={() => setEditing(item)}>
            <div className="entry-card__main">
              <span className="entry-card__title">{item.topic}</span>
              {item.details && <p className="entry-card__meta">{item.details}</p>}
            </div>
            <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); handleDelete(item); }}>Delete</button>
          </Card>
        ))
      )}

      {editing !== null && (
        <PracticalInfoForm destinationId={destinationId} record={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); afterMutation(); }} />
      )}
    </SectionPageLayout>
  );
}

function PracticalInfoForm({ destinationId, record, onClose, onSaved }) {
  const base = record || emptyPracticalInfoEntry();
  const [topic, setTopic] = useState(base.topic || '');
  const [details, setDetails] = useState(base.details || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!topic.trim()) { setError('Give this a topic name.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fields = { topic: topic.trim(), details };
      if (record) await updatePracticalInfoEntry(record.id, fields);
      else await createPracticalInfoEntry(destinationId, fields);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={record ? 'Edit Practical Info' : 'New Practical Info'}>
      <form onSubmit={handleSubmit}>
        <Input label="Topic" required autoFocus value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Visa, Connectivity, Safety" />
        <TextArea label="Details" value={details} onChange={e => setDetails(e.target.value)} rows={5} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}
