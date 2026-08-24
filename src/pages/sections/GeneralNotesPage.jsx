import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getDestination } from '../../db/stores/destinations';
import { listGeneralNotes, createGeneralNote, updateGeneralNote, deleteGeneralNote, emptyGeneralNote } from '../../db/stores/generalNotes';
import { useCachedQuery, invalidateCachedQuery, invalidateCachedQueryPrefix } from '../../hooks/useCachedQuery';
import SectionPageLayout from '../../components/SectionPageLayout';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { Input, TextArea } from '../../components/Field';
import { EmptyState, LoadingState, ErrorState } from '../../components/States';

export default function GeneralNotesPage() {
  const { destinationId } = useParams();
  const [editing, setEditing] = useState(null);

  const fetcher = useCallback(async () => {
    const [destination, items] = await Promise.all([getDestination(destinationId), listGeneralNotes(destinationId)]);
    return { destination, items };
  }, [destinationId]);
  const { data, error, loading, refresh } = useCachedQuery(`generalNotes:${destinationId}`, fetcher);

  function afterMutation() {
    invalidateCachedQuery(`generalNotes:${destinationId}`);
    invalidateCachedQueryPrefix(`destination:${destinationId}`);
    refresh();
  }

  async function handleDelete(item) {
    if (!window.confirm(`Delete "${item.title}"?`)) return;
    await deleteGeneralNote(item.id);
    afterMutation();
  }

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading notes…" />;

  const { destination, items } = data;

  return (
    <SectionPageLayout destination={destination} destinationId={destinationId} title="General Notes" onAdd={() => setEditing({})}>
      {items.length === 0 ? (
        <EmptyState icon="📝" title="No general notes yet" description="Anything that doesn't fit the other sections." actionLabel="+ Add" onAction={() => setEditing({})} />
      ) : (
        items.map(item => (
          <Card key={item.id} interactive padding="sm" accentColor="var(--color-neutral-400)" className="entry-card" onClick={() => setEditing(item)}>
            <div className="entry-card__main">
              <span className="entry-card__title">{item.title}</span>
              {item.content && <p className="entry-card__meta">{item.content}</p>}
            </div>
            <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); handleDelete(item); }}>Delete</button>
          </Card>
        ))
      )}

      {editing !== null && (
        <GeneralNoteForm destinationId={destinationId} record={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); afterMutation(); }} />
      )}
    </SectionPageLayout>
  );
}

function GeneralNoteForm({ destinationId, record, onClose, onSaved }) {
  const base = record || emptyGeneralNote();
  const [title, setTitle] = useState(base.title || '');
  const [content, setContent] = useState(base.content || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) { setError('Give this note a title.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fields = { title: title.trim(), content };
      if (record) await updateGeneralNote(record.id, fields);
      else await createGeneralNote(destinationId, fields);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={record ? 'Edit Note' : 'New Note'}>
      <form onSubmit={handleSubmit}>
        <Input label="Title" required autoFocus value={title} onChange={e => setTitle(e.target.value)} />
        <TextArea label="Content" value={content} onChange={e => setContent(e.target.value)} rows={6} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}
