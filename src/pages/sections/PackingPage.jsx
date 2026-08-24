import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getDestination } from '../../db/stores/destinations';
import { listPackingNotes, createPackingNote, updatePackingNote, deletePackingNote, emptyPackingNote } from '../../db/stores/packingNotes';
import { useCachedQuery, invalidateCachedQuery, invalidateCachedQueryPrefix } from '../../hooks/useCachedQuery';
import SectionPageLayout from '../../components/SectionPageLayout';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { Input, TextArea, Checkbox } from '../../components/Field';
import { EmptyState, LoadingState, ErrorState } from '../../components/States';

export default function PackingPage() {
  const { destinationId } = useParams();
  const [editing, setEditing] = useState(null);

  const fetcher = useCallback(async () => {
    const [destination, items] = await Promise.all([getDestination(destinationId), listPackingNotes(destinationId)]);
    return { destination, items };
  }, [destinationId]);
  const { data, error, loading, refresh } = useCachedQuery(`packingNotes:${destinationId}`, fetcher);

  function afterMutation() {
    invalidateCachedQuery(`packingNotes:${destinationId}`);
    invalidateCachedQueryPrefix(`destination:${destinationId}`);
    refresh();
  }

  async function handleDelete(item) {
    if (!window.confirm(`Delete "${item.item}"?`)) return;
    await deletePackingNote(item.id);
    afterMutation();
  }

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading packing notes…" />;

  const { destination, items } = data;

  return (
    <SectionPageLayout destination={destination} destinationId={destinationId} title="Packing & Preparation" onAdd={() => setEditing({})}>
      {items.length === 0 ? (
        <EmptyState icon="🎒" title="No packing notes yet" description="What to bring, gear notes, preparation reminders." actionLabel="+ Add" onAction={() => setEditing({})} />
      ) : (
        items.map(item => (
          <Card key={item.id} interactive padding="sm" accentColor="var(--color-neutral-500)" className="entry-card" onClick={() => setEditing(item)}>
            <div className="entry-card__main">
              <div className="entry-card__title-line">
                <span className="entry-card__title">{item.item}</span>
                {item.essential && <span className="badge badge--priority-must_know">Essential</span>}
              </div>
              {item.notes && <p className="entry-card__meta">{item.notes}</p>}
            </div>
            <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); handleDelete(item); }}>Delete</button>
          </Card>
        ))
      )}

      {editing !== null && (
        <PackingForm destinationId={destinationId} record={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); afterMutation(); }} />
      )}
    </SectionPageLayout>
  );
}

function PackingForm({ destinationId, record, onClose, onSaved }) {
  const base = record || emptyPackingNote();
  const [item, setItem] = useState(base.item || '');
  const [notes, setNotes] = useState(base.notes || '');
  const [essential, setEssential] = useState(base.essential || false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!item.trim()) { setError('Give this an item name.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fields = { item: item.trim(), notes, essential };
      if (record) await updatePackingNote(record.id, fields);
      else await createPackingNote(destinationId, fields);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={record ? 'Edit Packing Note' : 'New Packing Note'}>
      <form onSubmit={handleSubmit}>
        <Input label="Item" required autoFocus value={item} onChange={e => setItem(e.target.value)} />
        <TextArea label="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
        <Checkbox label="Essential" checked={essential} onChange={e => setEssential(e.target.checked)} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}
