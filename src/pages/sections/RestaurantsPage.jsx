import { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getDestination } from '../../db/stores/destinations';
import { listRestaurantEntries, createRestaurantEntry, updateRestaurantEntry, deleteRestaurantEntry, emptyRestaurantEntry, isPlaceBased } from '../../db/stores/restaurants';
import { listDishes, linkDishToRestaurant, unlinkDishFromRestaurant } from '../../db/stores/dishes';
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
import { getCurrencyOptions, getDestinationDefaultCurrency, addDestinationCurrency } from '../../db/currency.js';
import { RESTAURANT_PRICE_UNITS, RESTAURANT_DEFAULT_UNIT } from '../../lib/priceUnits.js';
import Disclosure from '../../components/Disclosure';
import { hasAdvancedContent } from '../../lib/formHelpers.js';
import { isMoneyEmpty } from '../../db/shared.js';
import { CATEGORY_HINTS } from '../../lib/placeLookup.js';

export default function RestaurantsPage() {
  const { destinationId } = useParams();
  const [editing, setEditing] = useState(null);

  const fetcher = useCallback(async () => {
    const [destination, items, dishes] = await Promise.all([getDestination(destinationId), listRestaurantEntries(destinationId), listDishes(destinationId)]);
    return { destination, items, dishes };
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

  const { destination, items, dishes } = data;
  const currencies = getCurrencyOptions(destination);
  const defaultCurrency = getDestinationDefaultCurrency(destination);

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
        items.map(item => {
          const linkedDishes = dishes.filter(d => d.restaurantIds.includes(item.id));
          return (
          <Card key={item.id} interactive padding="sm" accentColor="var(--color-coral)" className="entry-card" onClick={() => setEditing(item)}>
            <div className="entry-card__main">
              <div className="entry-card__title-line">
                {isPlaceBased(item) ? <PlaceSummary place={item.place} destinationName={destination.name} /> : <span className="entry-card__title">{item.dishName || 'Food note'}</span>}
                <PriorityBadge priority={item.priority} />
              </div>
              {item.cuisine && <p className="entry-card__meta">{item.cuisine}</p>}
              {item.price && <p className="entry-card__meta"><MoneyDisplay money={item.price} /></p>}
              {item.mustTryDishes?.length > 0 && <p className="entry-card__meta">Try: {item.mustTryDishes.join(', ')}</p>}
              {linkedDishes.length > 0 && (
                <p className="entry-card__meta">
                  Recommended dishes: {linkedDishes.map((d, i) => (
                    <span key={d.id}>
                      {i > 0 && ', '}
                      <Link to={`/destinations/${destinationId}/dishes`} onClick={e => e.stopPropagation()}>{d.name}</Link>
                    </span>
                  ))}
                </p>
              )}
            </div>
            <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); handleDelete(item); }}>Delete</button>
          </Card>
          );
        })
      )}

      {editing !== null && (
        <RestaurantForm destinationId={destinationId} destinationName={destination.name} record={editing.id ? editing : null} currencies={currencies} defaultCurrency={defaultCurrency} dishes={dishes} onAddCurrency={handleAddCurrency} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); afterMutation(); }} onLinksChanged={afterMutation} />
      )}
    </SectionPageLayout>
  );
}

function RestaurantForm({ destinationId, destinationName, record, currencies, defaultCurrency, dishes, onAddCurrency, onClose, onSaved, onLinksChanged }) {
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
          <PlaceField value={place} onChange={setPlace} destinationName={destinationName} expectedCategory={CATEGORY_HINTS.restaurant} />
        ) : (
          <Input label="Dish / food note name" required value={dishName} onChange={e => setDishName(e.target.value)} placeholder="e.g. Hoppers" />
        )}
        <Input label="Cuisine" value={cuisine} onChange={e => setCuisine(e.target.value)} />
        <TextArea label="Dietary notes" value={dietaryNotes} onChange={e => setDietaryNotes(e.target.value)} rows={2} placeholder="A quick note is enough to save this — add price and must-try dishes below if you have them." />

        <Disclosure label="Add more details" defaultOpen={advancedHasContent}>
          <MoneyField value={price} onChange={setPrice} currencies={currencies} defaultCurrency={defaultCurrency} unitOptions={RESTAURANT_PRICE_UNITS} defaultUnit={RESTAURANT_DEFAULT_UNIT} onAddCurrency={onAddCurrency} />
          <Input label="Must-try dishes (comma separated)" value={mustTryDishes} onChange={e => setMustTryDishes(e.target.value)} />
          <Select label="Priority" value={priority} onChange={e => setPriority(e.target.value)}>
            <option value="">No priority set</option>
            <option value="must_know">Must Know</option>
            <option value="useful">Useful</option>
            <option value="optional">Optional</option>
            <option value="reference">Reference</option>
          </Select>
        </Disclosure>

        {record && dishes.length > 0 && (
          <div className="field">
            <span className="field__label">Recommended / must-try dishes here</span>
            <p className="field__hint" style={{ marginTop: 0 }}>Tap a dish to link or unlink it — this updates the same relationship you'll see when viewing that dish's own page.</p>
            <div className="dish-form__restaurant-list">
              {dishes.map(dish => {
                const linked = dish.restaurantIds.includes(record.id);
                return (
                  <label key={dish.id} className="field field--checkbox">
                    <input
                      type="checkbox"
                      checked={linked}
                      onChange={async (e) => {
                        if (e.target.checked) await linkDishToRestaurant(dish.id, record.id);
                        else await unlinkDishFromRestaurant(dish.id, record.id);
                        onLinksChanged();
                      }}
                    />
                    <span>{dish.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
        {record && dishes.length === 0 && (
          <p className="entry-card__meta">No dishes added yet — add one from the Dishes section, then come back here to link it.</p>
        )}
        {!record && dishes.length > 0 && (
          <p className="entry-card__meta">Save this restaurant first, then reopen it to link dishes to it.</p>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}
