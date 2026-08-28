import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getDestination } from '../../db/stores/destinations';
import { listCostEntries, createCostEntry, updateCostEntry, deleteCostEntry, emptyCostEntry } from '../../db/stores/costs';
import { useCachedQuery, invalidateCachedQuery, invalidateCachedQueryPrefix } from '../../hooks/useCachedQuery';
import SectionPageLayout from '../../components/SectionPageLayout';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { Input, TextArea } from '../../components/Field';
import { MoneyField, MoneyDisplay } from '../../components/Money';
import { EmptyState, LoadingState, ErrorState } from '../../components/States';
import { getCurrencyOptions, addDestinationCurrency } from '../../db/currency.js';

export default function CostsPage() {
  const { destinationId } = useParams();
  const [editing, setEditing] = useState(null);

  const fetcher = useCallback(async () => {
    const [destination, items] = await Promise.all([getDestination(destinationId), listCostEntries(destinationId)]);
    return { destination, items };
  }, [destinationId]);
  const { data, error, loading, refresh } = useCachedQuery(`costs:${destinationId}`, fetcher);

  function afterMutation() {
    invalidateCachedQuery(`costs:${destinationId}`);
    invalidateCachedQueryPrefix(`destination:${destinationId}`);
    refresh();
  }

  async function handleAddCurrency(code) {
    await addDestinationCurrency(destinationId, code);
    invalidateCachedQuery(`destination:${destinationId}`);
    refresh();
  }

  async function handleDelete(item) {
    if (!window.confirm(`Delete "${item.item}"?`)) return;
    await deleteCostEntry(item.id);
    afterMutation();
  }

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading costs…" />;

  const { destination, items } = data;
  const currencies = getCurrencyOptions(destination);

  return (
    <SectionPageLayout destination={destination} destinationId={destinationId} title="Costs & Money" onAdd={() => setEditing({})}>
      {items.length === 0 ? (
        <EmptyState icon="💰" title="No cost notes yet" description="Track standalone costs like SIM cards, museum passes, or general budget notes." actionLabel="+ Add" onAction={() => setEditing({})} />
      ) : (
        items.map(item => (
          <Card key={item.id} interactive padding="sm" accentColor="var(--color-saffron)" className="entry-card" onClick={() => setEditing(item)}>
            <div className="entry-card__main">
              <span className="entry-card__title">{item.item}</span>
              {item.price && <p className="entry-card__meta"><MoneyDisplay money={item.price} /></p>}
              {item.context && <p className="entry-card__meta">{item.context}</p>}
            </div>
            <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); handleDelete(item); }}>Delete</button>
          </Card>
        ))
      )}

      {editing !== null && (
        <CostForm destinationId={destinationId} record={editing.id ? editing : null} currencies={currencies} onAddCurrency={handleAddCurrency} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); afterMutation(); }} />
      )}
    </SectionPageLayout>
  );
}

function CostForm({ destinationId, record, currencies, onAddCurrency, onClose, onSaved }) {
  const base = record || emptyCostEntry();
  const [item, setItem] = useState(base.item || '');
  const [price, setPrice] = useState(base.price || null);
  const [context, setContext] = useState(base.context || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!item.trim()) { setError('Give this cost a name.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fields = { item: item.trim(), price, context };
      if (record) await updateCostEntry(record.id, fields);
      else await createCostEntry(destinationId, fields);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={record ? 'Edit Cost' : 'New Cost'}>
      <form onSubmit={handleSubmit}>
        <Input label="Item" required autoFocus value={item} onChange={e => setItem(e.target.value)} placeholder="e.g. Local SIM card" />
        <MoneyField value={price} onChange={setPrice} currencies={currencies} defaultCurrency="INR" onAddCurrency={onAddCurrency} />
        <TextArea label="Context" value={context} onChange={e => setContext(e.target.value)} rows={2} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}
