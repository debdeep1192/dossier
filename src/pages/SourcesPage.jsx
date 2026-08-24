import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getDestination } from '../db/stores/destinations';
import { listSources, createSource, updateSource, deleteSource, emptySource } from '../db/stores/sources';
import { useCachedQuery, invalidateCachedQuery, invalidateCachedQueryPrefix } from '../hooks/useCachedQuery';
import SectionPageLayout from '../components/SectionPageLayout';
import Card from '../components/Card';
import Button from '../components/Button';
import Modal from '../components/Modal';
import { Input, TextArea, Select } from '../components/Field';
import { EmptyState, LoadingState, ErrorState } from '../components/States';

export default function SourcesPage() {
  const { destinationId } = useParams();
  const [editing, setEditing] = useState(null);

  const fetcher = useCallback(async () => {
    const [destination, items] = await Promise.all([getDestination(destinationId), listSources(destinationId)]);
    return { destination, items };
  }, [destinationId]);
  const { data, error, loading, refresh } = useCachedQuery(`sources:${destinationId}`, fetcher);

  function afterMutation() {
    invalidateCachedQuery(`sources:${destinationId}`);
    invalidateCachedQueryPrefix(`destination:${destinationId}`);
    refresh();
  }

  async function handleDelete(item) {
    if (!window.confirm(`Delete "${item.title || item.url}"?`)) return;
    await deleteSource(item.id);
    afterMutation();
  }

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading sources…" />;

  const { destination, items } = data;

  return (
    <SectionPageLayout destination={destination} destinationId={destinationId} title="Sources & References" onAdd={() => setEditing({})}>
      {items.length === 0 ? (
        <EmptyState icon="🔗" title="No sources yet" description="Articles, videos, or people you've consulted for this destination." actionLabel="+ Add" onAction={() => setEditing({})} />
      ) : (
        items.map(item => (
          <Card key={item.id} interactive padding="sm" className="entry-card" onClick={() => setEditing(item)}>
            <div className="entry-card__main">
              <span className="entry-card__title">{item.title || item.url}</span>
              {item.url && <p className="entry-card__meta"><a href={item.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>{item.url}</a></p>}
              {item.notes && <p className="entry-card__meta">{item.notes}</p>}
            </div>
            <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); handleDelete(item); }}>Delete</button>
          </Card>
        ))
      )}

      {editing !== null && (
        <SourceForm destinationId={destinationId} record={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); afterMutation(); }} />
      )}
    </SectionPageLayout>
  );
}

function SourceForm({ destinationId, record, onClose, onSaved }) {
  const base = record || emptySource();
  const [title, setTitle] = useState(base.title || '');
  const [url, setUrl] = useState(base.url || '');
  const [type, setType] = useState(base.type || 'website');
  const [notes, setNotes] = useState(base.notes || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim() && !url.trim()) { setError('Give this source a title or a URL.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fields = { title, url, type, notes, accessedAt: new Date().toISOString() };
      if (record) await updateSource(record.id, fields);
      else await createSource(destinationId, fields);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={record ? 'Edit Source' : 'New Source'}>
      <form onSubmit={handleSubmit}>
        <Input label="Title" autoFocus value={title} onChange={e => setTitle(e.target.value)} />
        <Input label="URL" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" />
        <Select label="Type" value={type} onChange={e => setType(e.target.value)}>
          <option value="website">Website</option>
          <option value="video">Video</option>
          <option value="document">Document</option>
          <option value="other">Other</option>
        </Select>
        <TextArea label="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}
