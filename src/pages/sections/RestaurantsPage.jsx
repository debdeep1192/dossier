import { useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAutoOpenNewForm } from '../../hooks/useAutoOpenNewForm';
import { getDestination } from '../../db/stores/destinations';
import { listRestaurantEntries, createRestaurantEntry, updateRestaurantEntry, deleteRestaurantEntry, emptyRestaurantEntry, isPlaceBased } from '../../db/stores/restaurants';
import { listDishes, createDish, updateDish, deleteDish, emptyDish, linkDishToRestaurant, unlinkDishFromRestaurant } from '../../db/stores/dishes';
import { listLocations, describeLocationContext } from '../../db/stores/locations';
import { useCachedQuery, invalidateCachedQuery, invalidateCachedQueryPrefix } from '../../hooks/useCachedQuery';
import SectionPageLayout from '../../components/SectionPageLayout';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { Input, TextArea, Select, Checkbox } from '../../components/Field';
import { PriceTierBadge } from '../../components/Badge';
import { PlaceField, PlaceSummary } from '../../components/Place';
import { MoneyField, MoneyDisplay, formatMoney } from '../../components/Money';
import { EmptyState, LoadingState, ErrorState } from '../../components/States';
import { getCurrencyOptions, getDestinationDefaultCurrency, addDestinationCurrency } from '../../db/currency.js';
import { RESTAURANT_PRICE_UNITS, RESTAURANT_DEFAULT_UNIT } from '../../lib/priceUnits.js';
import Disclosure from '../../components/Disclosure';
import { hasAdvancedContent } from '../../lib/formHelpers.js';
import { isMoneyEmpty } from '../../db/shared.js';
import { CATEGORY_HINTS } from '../../lib/placeLookup.js';
import LocationScopeField from '../../components/LocationScopeField';
import './RestaurantsPage.css';

// "Food & Restaurants" (Phase 3 Chunk 11) — one section, presented as
// two sub-tabs (Restaurants, Dishes) sharing this page. This is
// conceptual grouping ONLY: Restaurant and Dish remain fully separate
// entities/stores (db/stores/restaurants.js, db/stores/dishes.js),
// with their existing many-to-many relationship untouched. See
// DishesPage's old standalone route (still present, now redirecting
// here) for the previous separate-page structure this replaces.
const TABS = ['restaurants', 'dishes'];

export default function RestaurantsPage() {
  const { destinationId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = TABS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'restaurants';
  const contextLocationId = searchParams.get('location') || null;
  const [editingRestaurant, setEditingRestaurant] = useState(null);
  const [editingDish, setEditingDish] = useState(null);
  useAutoOpenNewForm(useCallback((v) => (activeTab === 'dishes' ? setEditingDish(v) : setEditingRestaurant(v)), [activeTab]));

  const fetcher = useCallback(async () => {
    const [destination, restaurants, dishes, locations] = await Promise.all([
      getDestination(destinationId), listRestaurantEntries(destinationId), listDishes(destinationId), listLocations(destinationId),
    ]);
    return { destination, restaurants, dishes, locations };
  }, [destinationId]);
  const { data, error, loading, refresh } = useCachedQuery(`foodAndRestaurants:${destinationId}`, fetcher);

  function afterMutation() {
    invalidateCachedQuery(`foodAndRestaurants:${destinationId}`);
    invalidateCachedQueryPrefix(`destination:${destinationId}`);
    refresh();
  }

  async function handleAddCurrency(code) {
    await addDestinationCurrency(destinationId, code);
    invalidateCachedQuery(`destination:${destinationId}`);
    refresh();
  }

  async function handleDeleteRestaurant(item) {
    if (!window.confirm(`Delete "${item.place?.name || item.dishName || 'this entry'}"?`)) return;
    await deleteRestaurantEntry(item.id);
    afterMutation();
  }

  async function handleDeleteDish(item) {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    await deleteDish(item.id);
    afterMutation();
  }

  function setTab(tab) {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next);
  }

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading Food & Restaurants…" />;

  const { destination, restaurants, dishes, locations } = data;
  const currencies = getCurrencyOptions(destination);
  const defaultCurrency = getDestinationDefaultCurrency(destination);
  const contextLocation = locations.find(l => l.id === contextLocationId) || null;

  return (
    <SectionPageLayout
      destination={destination}
      destinationId={destinationId}
      locationLabel={contextLocation?.name}
      title="Food & Restaurants"
      onAdd={() => (activeTab === 'dishes' ? setEditingDish({}) : setEditingRestaurant({}))}
      addLabel={activeTab === 'dishes' ? '+ Add Dish' : '+ Add Restaurant'}
    >
      <div className="food-tabs">
        <button type="button" className={`food-tabs__tab ${activeTab === 'restaurants' ? 'food-tabs__tab--active' : ''}`} onClick={() => setTab('restaurants')}>Restaurants</button>
        <button type="button" className={`food-tabs__tab ${activeTab === 'dishes' ? 'food-tabs__tab--active' : ''}`} onClick={() => setTab('dishes')}>Dishes</button>
      </div>

      {activeTab === 'restaurants' ? (
        <RestaurantsTab
          destination={destination}
          destinationId={destinationId}
          restaurants={restaurants}
          dishes={dishes}
          onEdit={setEditingRestaurant}
          onDelete={handleDeleteRestaurant}
        />
      ) : (
        <DishesTab
          destinationId={destinationId}
          dishes={dishes}
          restaurants={restaurants}
          locations={locations}
          contextLocationId={contextLocationId}
          onEdit={setEditingDish}
          onDelete={handleDeleteDish}
        />
      )}

      {editingRestaurant !== null && (
        <RestaurantForm
          destinationId={destinationId}
          destinationName={destination.name}
          record={editingRestaurant.id ? editingRestaurant : null}
          currencies={currencies}
          defaultCurrency={defaultCurrency}
          dishes={dishes}
          onAddCurrency={handleAddCurrency}
          onClose={() => setEditingRestaurant(null)}
          onSaved={() => { setEditingRestaurant(null); afterMutation(); }}
          onLinksChanged={afterMutation}
        />
      )}
      {editingDish !== null && (
        <DishForm
          destinationId={destinationId}
          record={editingDish.id ? editingDish : null}
          currencies={currencies}
          defaultCurrency={defaultCurrency}
          locations={locations}
          restaurants={restaurants}
          contextLocationId={contextLocationId}
          onAddCurrency={handleAddCurrency}
          onClose={() => setEditingDish(null)}
          onSaved={() => { setEditingDish(null); afterMutation(); }}
        />
      )}
    </SectionPageLayout>
  );
}

function RestaurantsTab({ destination, restaurants, dishes, onEdit, onDelete }) {
  if (restaurants.length === 0) {
    return <EmptyState icon="🍽️" title="Nothing here yet" description="Add a specific restaurant, or a general food/dish note." actionLabel="+ Add" onAction={() => onEdit({})} />;
  }
  return restaurants.map(item => {
    const linkedDishes = dishes.filter(d => d.restaurantIds.includes(item.id));
    return (
      <Card key={item.id} interactive padding="sm" accentColor="var(--color-coral)" className="entry-card" onClick={() => onEdit(item)}>
        <div className="entry-card__main">
          <div className="entry-card__title-line">
            {isPlaceBased(item) ? <PlaceSummary place={item.place} destinationName={destination.name} /> : <span className="entry-card__title">{item.dishName || 'Food note'}</span>}
            <PriceTierBadge priceTier={item.priceTier} />
          </div>
          {item.cuisine && <p className="entry-card__meta">{item.cuisine}</p>}
          {item.price && <p className="entry-card__meta"><MoneyDisplay money={item.price} /></p>}
          {item.mustTryDishes?.length > 0 && <p className="entry-card__meta">Try (legacy note): {item.mustTryDishes.join(', ')}</p>}
          {linkedDishes.length > 0 && (
            <p className="entry-card__meta">
              Recommended dishes: {linkedDishes.map((d, i) => (
                <span key={d.id}>{i > 0 && ', '}{d.name}</span>
              ))}
            </p>
          )}
        </div>
        <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); onDelete(item); }}>Delete</button>
      </Card>
    );
  });
}

function DishesTab({ dishes, restaurants, locations, contextLocationId, onEdit, onDelete }) {
  const visibleItems = contextLocationId ? dishes.filter(i => i.locationId === contextLocationId) : dishes;
  const restaurantById = Object.fromEntries(restaurants.map(r => [r.id, r]));

  if (visibleItems.length === 0) {
    return <EmptyState icon="🍜" title="No dishes yet" description="A dish worth remembering, even before you know the best restaurant for it — e.g. Momos in Darjeeling." actionLabel="+ Add" onAction={() => onEdit({})} />;
  }
  return visibleItems.map(item => (
    <Card key={item.id} interactive padding="sm" accentColor="var(--color-teal)" className="entry-card" onClick={() => onEdit(item)}>
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
              return <span key={id}>{i > 0 && ', '}{r.place?.name || r.dishName || 'Restaurant'}</span>;
            })}
          </p>
        )}
      </div>
      <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); onDelete(item); }}>Delete</button>
    </Card>
  ));
}

function RestaurantForm({ destinationId, destinationName, record, currencies, defaultCurrency, dishes, onAddCurrency, onClose, onSaved, onLinksChanged }) {
  const base = record || emptyRestaurantEntry();
  const [hasPlace, setHasPlace] = useState(Boolean(base.place && base.place.name));
  const [place, setPlace] = useState(base.place || {});
  const [dishName, setDishName] = useState(base.dishName || '');
  const [cuisine, setCuisine] = useState(base.cuisine || '');
  const [price, setPrice] = useState(base.price || null);
  const [dietaryNotes, setDietaryNotes] = useState(base.dietaryNotes || '');
  const [priceTier, setPriceTier] = useState(base.priceTier || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const advancedHasContent = hasAdvancedContent(
    !isMoneyEmpty(base.price),
    base.priceTier,
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
        // mustTryDishes is intentionally NOT set here — it's retired
        // from the active form (Phase 3 Chunk 11), superseded by the
        // real Restaurant<->Dish relationship below. An existing
        // record's stored mustTryDishes is left completely untouched
        // by patch() when this field is simply absent from `fields`.
        dietaryNotes,
        priceTier: priceTier || null,
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
        <TextArea label="Dietary notes" value={dietaryNotes} onChange={e => setDietaryNotes(e.target.value)} rows={2} placeholder="A quick note is enough to save this — add price below if you have it." />

        {base.mustTryDishes?.length > 0 && (
          <p className="entry-card__meta" style={{ marginBottom: 'var(--space-3)' }}>
            Legacy must-try note (kept for reference, no longer editable here — use the Dishes tab to link real dishes instead): {base.mustTryDishes.join(', ')}
          </p>
        )}

        <Disclosure label="Add more details" defaultOpen={advancedHasContent}>
          <MoneyField value={price} onChange={setPrice} currencies={currencies} defaultCurrency={defaultCurrency} unitOptions={RESTAURANT_PRICE_UNITS} defaultUnit={RESTAURANT_DEFAULT_UNIT} onAddCurrency={onAddCurrency} />
          <Select label="Price range" value={priceTier} onChange={e => setPriceTier(e.target.value)}>
            <option value="">Not set</option>
            <option value="budget">Budget-friendly</option>
            <option value="regular">Regular</option>
            <option value="fine_dining">Fine dining</option>
          </Select>
        </Disclosure>

        {record && dishes.length > 0 && (
          <div className="field">
            <span className="field__label">Recommended / must-try dishes here</span>
            <p className="field__hint" style={{ marginTop: 0 }}>Tap a dish to link or unlink it — this updates the same relationship you'll see when viewing that dish on the Dishes tab.</p>
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
          <p className="entry-card__meta">No dishes added yet — add one from the Dishes tab, then come back here to link it.</p>
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
