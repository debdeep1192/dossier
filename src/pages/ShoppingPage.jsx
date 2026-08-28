import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getDestination } from '../db/stores/destinations';
import { listShoppingItems, createShoppingItem, updateShoppingItem, deleteShoppingItem, emptyShoppingItem } from '../db/stores/shoppingItems';
import { listShopsForItem, createShop, deleteShop, emptyShop } from '../db/stores/shops';
import { useCachedQuery, invalidateCachedQuery, invalidateCachedQueryPrefix } from '../hooks/useCachedQuery';
import SectionPageLayout from '../components/SectionPageLayout';
import Card from '../components/Card';
import Button from '../components/Button';
import Modal from '../components/Modal';
import { Input, TextArea, Select } from '../components/Field';
import { PriorityBadge } from '../components/Badge';
import { PlaceField, PlaceSummary } from '../components/Place';
import { EmptyState, LoadingState, ErrorState } from '../components/States';

export default function ShoppingPage() {
  const { destinationId } = useParams();
  const [editingItem, setEditingItem] = useState(null);
  const [expandedItemId, setExpandedItemId] = useState(null);
  const [addingShopFor, setAddingShopFor] = useState(null);

  const fetcher = useCallback(async () => {
    const [destination, items] = await Promise.all([getDestination(destinationId), listShoppingItems(destinationId)]);
    return { destination, items };
  }, [destinationId]);
  const { data, error, loading, refresh } = useCachedQuery(`shoppingItems:${destinationId}`, fetcher);

  function afterMutation() {
    invalidateCachedQuery(`shoppingItems:${destinationId}`);
    invalidateCachedQueryPrefix(`destination:${destinationId}`);
    refresh();
  }

  async function handleDeleteItem(item) {
    if (!window.confirm(`Delete "${item.name}"? This won't delete shops already linked to it — remove those separately if needed.`)) return;
    await deleteShoppingItem(item.id);
    afterMutation();
  }

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading shopping…" />;

  const { destination, items } = data;

  return (
    <SectionPageLayout destination={destination} destinationId={destinationId} title="Shopping" onAdd={() => setEditingItem({})}>
      {items.length === 0 ? (
        <EmptyState icon="🛍️" title="Nothing to shop for yet" description="Start with what you want to buy, then add where you can buy it." actionLabel="+ Add" onAction={() => setEditingItem({})} />
      ) : (
        items.map(item => (
          <ShoppingItemCard
            key={item.id}
            item={item}
            destinationId={destinationId}
            expanded={expandedItemId === item.id}
            onToggleExpand={() => setExpandedItemId(expandedItemId === item.id ? null : item.id)}
            onEdit={() => setEditingItem(item)}
            onDelete={() => handleDeleteItem(item)}
            onAddShop={() => setAddingShopFor(item)}
            afterShopMutation={afterMutation}
          />
        ))
      )}

      {editingItem !== null && (
        <ShoppingItemForm
          destinationId={destinationId}
          record={editingItem.id ? editingItem : null}
          onClose={() => setEditingItem(null)}
          onSaved={() => { setEditingItem(null); afterMutation(); }}
        />
      )}

      {addingShopFor && (
        <ShopForm
          destinationId={destinationId}
          shoppingItemId={addingShopFor.id}
          onClose={() => setAddingShopFor(null)}
          onSaved={() => { setAddingShopFor(null); setExpandedItemId(addingShopFor.id); afterMutation(); }}
        />
      )}
    </SectionPageLayout>
  );
}

function ShoppingItemCard({ item, expanded, onToggleExpand, onEdit, onDelete, onAddShop, afterShopMutation }) {
  const { data: shops, refresh: refreshShops } = useCachedQuery(expanded ? `shops:${item.id}` : null, useCallback(() => listShopsForItem(item.id), [item.id]));

  async function handleDeleteShop(shop) {
    if (!window.confirm(`Remove "${shop.place?.name}"?`)) return;
    await deleteShop(shop.id);
    invalidateCachedQuery(`shops:${item.id}`);
    refreshShops();
    afterShopMutation();
  }

  return (
    <Card padding="sm" className="entry-card shopping-item-card">
      <div className="entry-card__main" onClick={onToggleExpand} style={{ cursor: 'pointer' }}>
        <div className="entry-card__title-line">
          <span className="entry-card__title">{item.name}</span>
          <PriorityBadge priority={item.priority} />
        </div>
        {item.notes && <p className="entry-card__meta">{item.notes}</p>}
        <p className="entry-card__meta">{expanded ? '▾' : '▸'} {shops ? `${shops.length} shop${shops.length === 1 ? '' : 's'}` : 'Tap to see shops'}</p>
      </div>
      <div className="shopping-item-card__actions">
        <button type="button" className="entry-card__delete" onClick={onEdit}>Edit</button>
        <button type="button" className="entry-card__delete" onClick={onDelete}>Delete</button>
      </div>

      {expanded && (
        <div className="shopping-item-card__shops">
          {shops && shops.length > 0 && shops.map(shop => (
            <div key={shop.id} className="shopping-item-card__shop-row">
              <PlaceSummary place={shop.place} />
              {shop.openingHours && <span className="entry-card__meta">{shop.openingHours}</span>}
              <PriorityBadge priority={shop.priority} />
              <button type="button" className="entry-card__delete" onClick={() => handleDeleteShop(shop)}>Remove</button>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={onAddShop}>+ Add a shop</Button>
        </div>
      )}
    </Card>
  );
}

function ShoppingItemForm({ destinationId, record, onClose, onSaved }) {
  const base = record || emptyShoppingItem();
  const [name, setName] = useState(base.name || '');
  const [notes, setNotes] = useState(base.notes || '');
  const [priority, setPriority] = useState(base.priority || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Give this a name.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fields = { name: name.trim(), notes, priority: priority || null };
      if (record) await updateShoppingItem(record.id, fields);
      else await createShoppingItem(destinationId, fields);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={record ? 'Edit Shopping Item' : 'New Shopping Item'}>
      <form onSubmit={handleSubmit}>
        <Input label="What to buy" required autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Darjeeling loose-leaf muscatel tea" />
        <TextArea label="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
        <Select label="Priority" value={priority} onChange={e => setPriority(e.target.value)}>
          <option value="">No priority set</option>
          <option value="must_know">Must Know</option>
          <option value="useful">Useful</option>
          <option value="optional">Optional</option>
          <option value="reference">Reference</option>
        </Select>
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}

function ShopForm({ destinationId, shoppingItemId, onClose, onSaved }) {
  const base = emptyShop();
  const [place, setPlace] = useState(base.place);
  const [openingHours, setOpeningHours] = useState('');
  const [priceInfo, setPriceInfo] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState(base.priority || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!place.name) { setError('Shop name is required.'); return; }
    setError('');
    setSubmitting(true);
    try {
      await createShop(destinationId, { shoppingItemId, place, openingHours, priceInfo, notes, priority: priority || null });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="New Shop">
      <form onSubmit={handleSubmit}>
        <PlaceField value={place} onChange={setPlace} label="Shop" />
        <Input label="Opening hours" value={openingHours} onChange={e => setOpeningHours(e.target.value)} placeholder="e.g. 10 AM – 8 PM" />
        <Input label="Price info (optional)" value={priceInfo} onChange={e => setPriceInfo(e.target.value)} placeholder="e.g. ₹400-600 per 100g" />
        <TextArea label="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
        <Select label="Priority" value={priority} onChange={e => setPriority(e.target.value)}>
          <option value="">No priority set</option>
          <option value="must_know">Must Know</option>
          <option value="useful">Useful</option>
          <option value="optional">Optional</option>
          <option value="reference">Reference</option>
        </Select>
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}
