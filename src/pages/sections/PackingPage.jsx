import { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getDestination } from '../../db/stores/destinations';
import { listPackingNotes, createPackingNote, updatePackingNote, deletePackingNote, togglePackingNoteChecked, normalizePackingNote } from '../../db/stores/packingNotes';
import { useCachedQuery, invalidateCachedQuery } from '../../hooks/useCachedQuery';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { Input, TextArea, Checkbox, Select } from '../../components/Field';
import { LoadingState, ErrorState } from '../../components/States';
import { PACKING_CATEGORIES, PACKING_PRESETS } from '../../lib/packingOptions.js';
import '../../components/SectionPageLayout.css';
import './PackingPage.css';

export default function PackingPage() {
  const { destinationId } = useParams();
  const [editingItem, setEditingItem] = useState(null); // a packing note record, for the quantity/remarks editor
  const [addingToCategory, setAddingToCategory] = useState(null); // category name, for the add-item picker

  const fetcher = useCallback(async () => {
    const [destination, rawItems] = await Promise.all([getDestination(destinationId), listPackingNotes(destinationId)]);
    return { destination, items: rawItems.map(normalizePackingNote) };
  }, [destinationId]);
  const { data, error, loading, refresh } = useCachedQuery(`packingNotes:${destinationId}`, fetcher);

  function afterMutation() {
    invalidateCachedQuery(`packingNotes:${destinationId}`);
    refresh();
  }

  async function handleToggle(item) {
    await togglePackingNoteChecked(item.id, !item.checked);
    afterMutation();
  }

  async function handleDelete(item) {
    await deletePackingNote(item.id);
    afterMutation();
  }

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading packing checklist…" />;

  const { destination, items } = data;
  const itemsByCategory = Object.fromEntries(PACKING_CATEGORIES.map(c => [c, items.filter(i => i.category === c)]));

  return (
    <div className="section-page packing-page">
      <div className="section-page__breadcrumb">
        <Link to="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/destinations/${destinationId}`}>{destination?.name}</Link>
        <span aria-hidden="true">/</span>
        <span>Packing & Preparation</span>
      </div>
      <header className="section-page__header">
        <h1>Packing & Preparation</h1>
      </header>

      {PACKING_CATEGORIES.map(category => (
        <section key={category} className="packing-page__category">
          <div className="packing-page__category-header">
            <h2>{category}</h2>
            <button type="button" className="packing-page__add-link" onClick={() => setAddingToCategory(category)}>+ Add</button>
          </div>
          {itemsByCategory[category].length === 0 ? (
            <p className="packing-page__empty">Nothing added yet.</p>
          ) : (
            <ul className="packing-page__list">
              {itemsByCategory[category].map(item => (
                <li key={item.id} className="packing-page__row">
                  <label className="packing-page__checkbox-label">
                    <input type="checkbox" checked={item.checked} onChange={() => handleToggle(item)} />
                    <span className={item.checked ? 'packing-page__item-text packing-page__item-text--checked' : 'packing-page__item-text'}>
                      {item.item}
                      {item.essential && <span className="packing-page__essential-tag">Essential</span>}
                    </span>
                  </label>
                  <button type="button" className="packing-page__edit-link" onClick={() => setEditingItem(item)}>Edit</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {addingToCategory && (
        <AddItemModal
          destinationId={destinationId}
          category={addingToCategory}
          existingItems={itemsByCategory[addingToCategory].map(i => i.item)}
          onClose={() => setAddingToCategory(null)}
          onAdded={() => { afterMutation(); }}
        />
      )}

      {editingItem && (
        <EditItemModal
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSaved={() => { setEditingItem(null); afterMutation(); }}
          onDelete={() => { setEditingItem(null); handleDelete(editingItem); }}
        />
      )}
    </div>
  );
}

function AddItemModal({ destinationId, category, existingItems, onClose, onAdded }) {
  const [customItem, setCustomItem] = useState('');
  const [error, setError] = useState('');
  const presets = (PACKING_PRESETS[category] || []).filter(p => !existingItems.includes(p));

  async function addItem(name) {
    if (!name.trim()) return;
    setError('');
    try {
      await createPackingNote(destinationId, { category, item: name.trim() });
      onAdded();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCustomSubmit(e) {
    e.preventDefault();
    await addItem(customItem);
    setCustomItem('');
  }

  return (
    <Modal open onClose={onClose} title={`Add to ${category}`}>
      {presets.length > 0 && (
        <div className="packing-page__preset-list">
          {presets.map(p => (
            <button key={p} type="button" className="packing-page__preset-chip" onClick={() => addItem(p)}>+ {p}</button>
          ))}
        </div>
      )}
      <form onSubmit={handleCustomSubmit}>
        <Input label="Custom item" value={customItem} onChange={e => setCustomItem(e.target.value)} placeholder="Type an item name" autoFocus />
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth>Add item</Button>
      </form>
    </Modal>
  );
}

function EditItemModal({ item, onClose, onSaved, onDelete }) {
  const [itemName, setItemName] = useState(item.item);
  const [category, setCategory] = useState(item.category);
  const [essential, setEssential] = useState(item.essential);
  const [quantity, setQuantity] = useState(item.quantity || '');
  const [remarks, setRemarks] = useState(item.remarks || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!itemName.trim()) { setError('Item name cannot be empty.'); return; }
    setError('');
    setSubmitting(true);
    try {
      await updatePackingNote(item.id, { item: itemName.trim(), category, essential, quantity, remarks });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Edit Item">
      <form onSubmit={handleSubmit}>
        <Input label="Item" required value={itemName} onChange={e => setItemName(e.target.value)} />
        <Select label="Category" value={category} onChange={e => setCategory(e.target.value)}>
          {PACKING_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Input label="Quantity (optional)" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="e.g. 3" />
        <TextArea label="Remarks (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />
        <Checkbox label="Essential" checked={essential} onChange={e => setEssential(e.target.checked)} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="packing-page__edit-actions">
          <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
          <Button type="button" variant="danger" onClick={onDelete}>Remove item</Button>
        </div>
      </form>
    </Modal>
  );
}
