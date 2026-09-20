import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAutoOpenNewForm } from '../hooks/useAutoOpenNewForm';
import { getDestination } from '../db/stores/destinations';
import { listShoppingItems, createShoppingItem, updateShoppingItem, deleteShoppingItem, emptyShoppingItem } from '../db/stores/shoppingItems';
import { listShopsForItem, createShop, deleteShop, emptyShop, normalizeShop } from '../db/stores/shops';
import { useCachedQuery, invalidateCachedQuery, invalidateCachedQueryPrefix } from '../hooks/useCachedQuery';
import SectionPageLayout from '../components/SectionPageLayout';
import Card from '../components/Card';
import Button from '../components/Button';
import Modal from '../components/Modal';
import { Input, TextArea } from '../components/Field';
import { PlaceField, PlaceSummary } from '../components/Place';
import { OpeningHoursField } from '../components/OpeningHours';
import { formatOpeningHours } from '../lib/openingHours.js';
import { EmptyState, LoadingState, ErrorState } from '../components/States';

export default function ShoppingPage() {
  const { destinationId } = useParams();
  const [editingItem, setEditingItem] = useState(null);
  useAutoOpenNewForm(setEditingItem);
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
    <SectionPageLayout destination={destination} destinationId={destinationId} title="Shopping">
      {items.length === 0 ? (
        <EmptyState icon="🛍️" title="Nothing to shop for yet" description="Use the + button below — start with what you want to buy, then add where you can buy it." />
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
  const { data: rawShops, refresh: refreshShops } = useCachedQuery(expanded ? `shops:${item.id}` : null, useCallback(() => listShopsForItem(item.id), [item.id]));
  const shops = rawShops ? rawShops.map(normalizeShop) : rawShops;

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
              {formatOpeningHours(shop.openingHours) && <span className="entry-card__meta">{formatOpeningHours(shop.openingHours)}</span>}
              {!formatOpeningHours(shop.openingHours) && shop.openingHoursLegacyText && <span className="entry-card__meta">{shop.openingHoursLegacyText}</span>}
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
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Give this a name.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fields = { name: name.trim(), notes };
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
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}

function ShopForm({ destinationId, shoppingItemId, onClose, onSaved }) {
  const base = emptyShop();
  const [place, setPlace] = useState(base.place);
  const [openingHours, setOpeningHours] = useState(base.openingHours);
  const [priceInfo, setPriceInfo] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!place.name) { setError('Shop name is required.'); return; }
    setError('');
    setSubmitting(true);
    try {
      await createShop(destinationId, { shoppingItemId, place, openingHours, priceInfo, notes });
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
        <OpeningHoursField value={openingHours} onChange={setOpeningHours} />
        <Input label="Price info (optional)" value={priceInfo} onChange={e => setPriceInfo(e.target.value)} placeholder="e.g. ₹400-600 per 100g" />
        <TextArea label="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}
