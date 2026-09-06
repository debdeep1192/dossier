import { useState, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { getDestination } from '../../db/stores/destinations';
import { listDishes, createDish, updateDish, deleteDish, emptyDish } from '../../db/stores/dishes';
import { listRestaurantEntries } from '../../db/stores/restaurants';
import { listLocations, describeLocationContext } from '../../db/stores/locations';
import { addDestinationCurrency, getCurrencyOptions, getDestinationDefaultCurrency } from '../../db/currency.js';
import { useCachedQuery, invalidateCachedQuery, invalidateCachedQueryPrefix } from '../../hooks/useCachedQuery';
import SectionPageLayout from '../../components/SectionPageLayout';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { Input, TextArea } from '../../components/Field';
import { MoneyField, formatMoney } from '../../components/Money';
import { EmptyState, LoadingState, ErrorState } from '../../components/States';
import LocationScopeField from '../../components/LocationScopeField';

export default function DishesPage() {
  const { destinationId } = useParams();
  const [searchParams] = useSearchParams();
  const contextLocationId = searchParams.get('location') || null;
  const [editing, setEditing] = useState(null);

  const fetcher = useCallback(async () => {
    const [destination, items, restaurants, locations] = await Promise.all([
      getDestination(destinationId), listDishes(destinationId), listRestaurantEntries(destinationId), listLocations(destinationId),
    ]);
    return { destination, items, restaurants, locations };
  }, [destinationId]);
  const { data, error, loading, refresh } = useCachedQuery(`dishes:${destinationId}`, fetcher);

  function afterMutation() {
    invalidateCachedQuery(`dishes:${destinationId}`);
    invalidateCachedQueryPrefix(`destination:${destinationId}`);
    refresh();
  }

  async function handleAddCurrency(code) {
    await addDestinationCurrency(destinationId, code);
    invalidateCachedQuery(`destination:${destinationId}`);
    refresh();
  }

  async function handleDelete(item) {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    await deleteDish(item.id);
    afterMutation();
  }

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading dishes…" />;

  const { destination, items, restaurants, locations } = data;
  const currencies = getCurrencyOptions(destination);
  const defaultCurrency = getDestinationDefaultCurrency(destination);
  const contextLocation = locations.find(l => l.id === contextLocationId) || null;
  const visibleItems = contextLocationId ? items.filter(i => i.locationId === contextLocationId) : items;
  const restaurantById = Object.fromEntries(restaurants.map(r => [r.id, r]));

  return (
    <SectionPageLayout destination={destination} destinationId={destinationId} locationLabel={contextLocation?.name} title="Dishes" onAdd={() => setEditing({})}>
      {visibleItems.length === 0 ? (
        <EmptyState icon="🍜" title="No dishes yet" description="A dish worth remembering, even before you know the best restaurant for it — e.g. Momos in Darjeeling." actionLabel="+ Add" onAction={() => setEditing({})} />
      ) : (
        visibleItems.map(item => (
          <Card key={item.id} interactive padding="sm" accentColor="var(--color-teal)" className="entry-card" onClick={() => setEditing(item)}>
            <div className="entry-card__main">
              <div className="entry-card__title-line">
                <span className="place-summary__name">{item.name}</span>
              </div>
              {!contextLocationId && locations.length > 0 && <p className="entry-card__meta">{describeLocationContext(item.locationId, locations)}</p>}
              {item.cuisine && <p className="entry-card__meta">{item.cuisine}</p>}
              {formatMoney(item.price) && <p className="entry-card__meta">{formatMoney(item.price)}</p>}
              {item.restaurantIds.length > 0 && (
                <p className="entry-card__meta">
                  Try at: {item.restaurantIds.map((id, i) => {
                    const r = restaurantById[id];
                    if (!r) return null;
                    return (
                      <span key={id}>
                        {i > 0 && ', '}
                        <Link to={`/destinations/${destinationId}/restaurants`} onClick={e => e.stopPropagation()}>{r.place?.name || r.dishName || 'Restaurant'}</Link>
                      </span>
                    );
                  })}
                </p>
              )}
            </div>
            <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); handleDelete(item); }}>Delete</button>
          </Card>
        ))
      )}

      {editing !== null && (
        <DishForm
          destinationId={destinationId}
          record={editing.id ? editing : null}
          currencies={currencies}
          defaultCurrency={defaultCurrency}
          locations={locations}
          restaurants={restaurants}
          contextLocationId={contextLocationId}
          onAddCurrency={handleAddCurrency}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); afterMutation(); }}
        />
      )}
    </SectionPageLayout>
  );
}

function DishForm({ destinationId, record, currencies, defaultCurrency, locations, restaurants, contextLocationId, onAddCurrency, onClose, onSaved }) {
  const base = record || emptyDish();
  const [name, setName] = useState(base.name || '');
  const [locationId, setLocationId] = useState(base.locationId ?? contextLocationId ?? null);
  const [cuisine, setCuisine] = useState(base.cuisine || '');
  const [price, setPrice] = useState(base.price || null);
  const [notes, setNotes] = useState(base.notes || '');
  const [restaurantIds, setRestaurantIds] = useState(base.restaurantIds || []);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function toggleRestaurant(id) {
    setRestaurantIds(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Give this dish a name.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fields = { name: name.trim(), locationId, cuisine, price, notes, restaurantIds };
      if (record) await updateDish(record.id, fields);
      else await createDish(destinationId, fields);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={record ? 'Edit Dish' : 'New Dish'}>
      <form onSubmit={handleSubmit}>
        <Input label="Dish name" required autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Momos" />
        <LocationScopeField locations={locations} value={locationId} onChange={setLocationId} lockedLocationId={record ? null : contextLocationId} />
        <Input label="Cuisine" value={cuisine} onChange={e => setCuisine(e.target.value)} />
        <MoneyField label="Approximate price" value={price} onChange={setPrice} currencies={currencies} defaultCurrency={defaultCurrency} onAddCurrency={onAddCurrency} />
        <TextArea label="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />

        {restaurants.length > 0 && (
          <div className="field">
            <span className="field__label">Good at these restaurants (optional)</span>
            <div className="dish-form__restaurant-list">
              {restaurants.map(r => (
                <label key={r.id} className="field field--checkbox">
                  <input type="checkbox" checked={restaurantIds.includes(r.id)} onChange={() => toggleRestaurant(r.id)} />
                  <span>{r.place?.name || r.dishName || 'Unnamed restaurant'}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}
