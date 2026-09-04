import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getDestination } from '../../db/stores/destinations';
import { listRestaurantEntries, createRestaurantEntry, updateRestaurantEntry, deleteRestaurantEntry, emptyRestaurantEntry, isPlaceBased } from '../../db/stores/restaurants';
import { useCachedQuery, invalidateCachedQuery, invalidateCachedQueryPrefix } from '../../hooks/useCachedQuery';
import SectionPageLayout from '../../components/SectionPageLayout';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { Input, TextArea, Select, Checkbox } from '../../components/Field';
import { PriorityBadge } from '../../components/Badge';
import { PlaceField, PlaceSummary } from '../../components/Place';
import { MoneyField, MoneyDisplay } from '../../components/Money';
import { EmptyState, LoadingState, ErrorState } from '../../components/States';
import { getCurrencyOptions, addDestinationCurrency } from '../../db/currency.js';
import { RESTAURANT_PRICE_UNITS, RESTAURANT_DEFAULT_UNIT } from '../../lib/priceUnits.js';
import Disclosure from '../../components/Disclosure';
import { hasAdvancedContent } from '../../lib/formHelpers.js';
import { isMoneyEmpty } from '../../db/shared.js';

export default function RestaurantsPage() {
  const { destinationId } = useParams();
  const [editing, setEditing] = useState(null);

  const fetcher = useCallback(async () => {
    const [destination, items] = await Promise.all([getDestination(destinationId), listRestaurantEntries(destinationId)]);
    return { destination, items };
  }, [destinationId]);
  const { data, error, loading, refresh } = useCachedQuery(`restaurants:${destinationId}`, fetcher);

  function afterMutation() {
    invalidateCachedQuery(`restaurants:${destinationId}`);
    invalidateCachedQueryPrefix(`destination:${destinationId}`);
    refresh();
  }

  async function handleDelete(item) {
    if (!window.confirm(`Delete "${item.place?.name || item.dishName || 'this entry'}"?`)) return;
    await deleteRestaurantEntry(item.id);
    afterMutation();
  }

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading restaurants & food…" />;

  const { destination, items } = data;
  const currencies = getCurrencyOptions(destination);

  async function handleAddCurrency(code) {
    await addDestinationCurrency(destinationId, code);
    invalidateCachedQuery(`destination:${destinationId}`);
    refresh();
  }

  return (
    <SectionPageLayout destination={destination} destinationId={destinationId} title="Restaurants & Food" onAdd={() => setEditing({})}>
      {items.length === 0 ? (
        <EmptyState icon="🍽️" title="Nothing here yet" description="Add a specific restaurant, or a general food/dish note." actionLabel="+ Add" onAction={() => setEditing({})} />
      ) : (
        items.map(item => (
          <Card key={item.id} interactive padding="sm" accentColor="var(--color-coral)" className="entry-card" onClick={() => setEditing(item)}>
            <div className="entry-card__main">
              <div className="entry-card__title-line">
                {isPlaceBased(item) ? <PlaceSummary place={item.place} destinationName={destination.name} /> : <span className="entry-card__title">{item.dishName || 'Food note'}</span>}
                <PriorityBadge priority={item.priority} />
              </div>
              {item.cuisine && <p className="entry-card__meta">{item.cuisine}</p>}
              {item.price && <p className="entry-card__meta"><MoneyDisplay money={item.price} /></p>}
              {item.mustTryDishes?.length > 0 && <p className="entry-card__meta">Try: {item.mustTryDishes.join(', ')}</p>}
            </div>
            <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); handleDelete(item); }}>Delete</button>
          </Card>
        ))
      )}

      {editing !== null && (
        <RestaurantForm destinationId={destinationId} record={editing.id ? editing : null} currencies={currencies} onAddCurrency={handleAddCurrency} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); afterMutation(); }} />
      )}
    </SectionPageLayout>
  );
}

function RestaurantForm({ destinationId, record, currencies, onAddCurrency, onClose, onSaved }) {
  const base = record || emptyRestaurantEntry();
  const [hasPlace, setHasPlace] = useState(Boolean(base.place && base.place.name));
  const [place, setPlace] = useState(base.place || {});
  const [dishName, setDishName] = useState(base.dishName || '');
  const [cuisine, setCuisine] = useState(base.cuisine || '');
  const [price, setPrice] = useState(base.price || null);
  const [mustTryDishes, setMustTryDishes] = useState((base.mustTryDishes || []).join(', '));
  const [dietaryNotes, setDietaryNotes] = useState(base.dietaryNotes || '');
  const [priority, setPriority] = useState(base.priority || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const advancedHasContent = hasAdvancedContent(
    !isMoneyEmpty(base.price),
    (base.mustTryDishes || []).length > 0,
    base.priority,
  );

  async function handleSubmit(e) {
    e.preventDefault();
    if (hasPlace && !place.name) { setError('Place name is required, or switch to a general food note.'); return; }
    if (!hasPlace && !dishName.trim()) { setError('Give this food note a short name.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fields = {
        place: hasPlace ? place : null,
        dishName: hasPlace ? '' : dishName,
        cuisine, price,
        mustTryDishes: mustTryDishes.split(',').map(s => s.trim()).filter(Boolean),
        dietaryNotes,
        priority: priority || null,
      };
      if (record) await updateRestaurantEntry(record.id, fields);
      else await createRestaurantEntry(destinationId, fields);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={record ? 'Edit Entry' : 'New Restaurant / Food Note'}>
      <form onSubmit={handleSubmit}>
        <Checkbox label="This is a specific restaurant (has a place)" checked={hasPlace} onChange={e => setHasPlace(e.target.checked)} />
        {hasPlace ? (
          <PlaceField value={place} onChange={setPlace} />
        ) : (
          <Input label="Dish / food note name" required value={dishName} onChange={e => setDishName(e.target.value)} placeholder="e.g. Hoppers" />
        )}
        <Input label="Cuisine" value={cuisine} onChange={e => setCuisine(e.target.value)} />
        <TextArea label="Dietary notes" value={dietaryNotes} onChange={e => setDietaryNotes(e.target.value)} rows={2} placeholder="A quick note is enough to save this — add price and must-try dishes below if you have them." />

        <Disclosure label="Add more details" defaultOpen={advancedHasContent}>
          <MoneyField value={price} onChange={setPrice} currencies={currencies} defaultCurrency="INR" unitOptions={RESTAURANT_PRICE_UNITS} defaultUnit={RESTAURANT_DEFAULT_UNIT} onAddCurrency={onAddCurrency} />
          <Input label="Must-try dishes (comma separated)" value={mustTryDishes} onChange={e => setMustTryDishes(e.target.value)} />
          <Select label="Priority" value={priority} onChange={e => setPriority(e.target.value)}>
            <option value="">No priority set</option>
            <option value="must_know">Must Know</option>
            <option value="useful">Useful</option>
            <option value="optional">Optional</option>
            <option value="reference">Reference</option>
          </Select>
        </Disclosure>

        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}
