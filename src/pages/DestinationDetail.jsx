import { useCallback, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { getDestination } from '../db/stores/destinations';
import { listLocations, createLocation, updateLocation, deleteLocation } from '../db/stores/locations';
import { useCachedQuery, invalidateCachedQuery } from '../hooks/useCachedQuery';
import { SECTIONS } from '../sectionRegistry';
import Card from '../components/Card';
import Button from '../components/Button';
import { Input } from '../components/Field';
import { LoadingState, ErrorState } from '../components/States';
import './DestinationDetail.css';

export default function DestinationDetail() {
  const { destinationId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeLocationId = searchParams.get('location') || '';
  const [managingLocations, setManagingLocations] = useState(false);

  const fetcher = useCallback(async () => {
    const destination = await getDestination(destinationId);
    if (!destination) throw new Error('Destination not found.');
    const [counts, locations] = await Promise.all([
      Promise.all(SECTIONS.map(s => s.list(destinationId))),
      listLocations(destinationId),
    ]);
    return { destination, locations, counts: Object.fromEntries(SECTIONS.map((s, i) => [s.key, counts[i].length])) };
  }, [destinationId]);

  const { data, error, loading, refresh } = useCachedQuery(`destination:${destinationId}`, fetcher);

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading destination…" />;

  const { destination, locations, counts } = data;
  const activeLocation = locations.find(l => l.id === activeLocationId) || null;

  function refreshAfterLocationChange() {
    invalidateCachedQuery(`destination:${destinationId}`);
    refresh();
  }

  // Selecting a location scopes the section grid below to that
  // location — the Quick Add button and each section's own "New X"
  // button carry that context forward (see item 3: context-aware
  // creation), so opening Attractions from inside "Phuket" doesn't ask
  // the person to pick Thailand or Phuket again.
  function selectLocation(locationId) {
    if (locationId) setSearchParams({ location: locationId });
    else setSearchParams({});
  }

  function sectionHref(section) {
    const base = `/destinations/${destinationId}/${section.path}`;
    return activeLocationId ? `${base}?location=${activeLocationId}` : base;
  }

  return (
    <div className="dest-detail">
      <div className="dest-detail__breadcrumb">
        <Link to="/">Home</Link>
        <span aria-hidden="true">/</span>
        <span>{destination.name}</span>
        {activeLocation && (
          <>
            <span aria-hidden="true">/</span>
            <span>{activeLocation.name}</span>
          </>
        )}
      </div>

      <header className="dest-detail__header">
        <h1>{activeLocation ? `${destination.name} — ${activeLocation.name}` : destination.name}</h1>
        {destination.overview && <p className="dest-detail__overview">{destination.overview}</p>}
      </header>

      <div className="dest-detail__actions">
        <Button variant="secondary" size="sm" onClick={() => navigate(`/destinations/${destinationId}/import`)}>+ Import from text</Button>
        <Button variant="ghost" size="sm" onClick={() => navigate(`/destinations/${destinationId}/currency`)}>Currency settings</Button>
      </div>

      <LocationsPanel
        destinationId={destinationId}
        locations={locations}
        activeLocationId={activeLocationId}
        onSelect={selectLocation}
        managing={managingLocations}
        onToggleManaging={() => setManagingLocations(m => !m)}
        onChanged={refreshAfterLocationChange}
      />

      <div className="dest-detail__section-grid">
        {SECTIONS.map(section => (
          <Card
            key={section.key}
            interactive
            padding="sm"
            className="section-tile"
            onClick={() => navigate(sectionHref(section))}
          >
            <span className="section-tile__icon" aria-hidden="true">{section.icon}</span>
            <span className="section-tile__label">{section.label}</span>
            <span className="section-tile__count">{counts[section.key]}</span>
          </Card>
        ))}
      </div>
    </div>
  );
}

// Location management: view existing locations, add new ones, rename,
// and delete — directly from the destination page, per item 2 ("do not
// make me manage locations through some hidden technical workflow").
// Also doubles as the location-context selector for section navigation
// above (selecting a chip scopes the section grid to that location;
// selecting "Whole destination" clears the scope).
function LocationsPanel({ destinationId, locations, activeLocationId, onSelect, managing, onToggleManaging, onChanged }) {
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  async function handleAdd(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setError('');
    try {
      await createLocation(destinationId, { name: newName.trim() });
      setNewName('');
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  function startRename(loc) {
    setRenamingId(loc.id);
    setRenameValue(loc.name);
  }

  async function confirmRename(id) {
    if (!renameValue.trim()) { setRenamingId(null); return; }
    await updateLocation(id, { name: renameValue.trim() });
    setRenamingId(null);
    onChanged();
  }

  async function handleDelete(loc) {
    if (!window.confirm(`Delete "${loc.name}"? Records already assigned to it will keep showing it as their location, but you won't be able to pick it for new records.`)) return;
    await deleteLocation(loc.id);
    if (activeLocationId === loc.id) onSelect('');
    onChanged();
  }

  return (
    <Card padding="sm" className="locations-panel">
      <div className="locations-panel__header">
        <span className="locations-panel__title">Locations</span>
        {locations.length > 0 && (
          <button type="button" className="locations-panel__manage-toggle" onClick={onToggleManaging}>
            {managing ? 'Done' : 'Manage'}
          </button>
        )}
      </div>

      <div className="locations-panel__chips">
        <button
          type="button"
          className={`locations-panel__chip ${!activeLocationId ? 'locations-panel__chip--active' : ''}`}
          onClick={() => onSelect('')}
        >
          Whole destination
        </button>
        {locations.map(loc => (
          <div key={loc.id} className="locations-panel__chip-wrap">
            {renamingId === loc.id ? (
              <span className="locations-panel__rename-row">
                <Input value={renameValue} onChange={e => setRenameValue(e.target.value)} autoFocus onKeyDown={e => e.key === 'Enter' && confirmRename(loc.id)} />
                <button type="button" onClick={() => confirmRename(loc.id)}>✓</button>
              </span>
            ) : (
              <button
                type="button"
                className={`locations-panel__chip ${activeLocationId === loc.id ? 'locations-panel__chip--active' : ''}`}
                onClick={() => onSelect(loc.id)}
              >
                {loc.name}
              </button>
            )}
            {managing && renamingId !== loc.id && (
              <span className="locations-panel__chip-actions">
                <button type="button" aria-label={`Rename ${loc.name}`} onClick={() => startRename(loc)}>✎</button>
                <button type="button" aria-label={`Delete ${loc.name}`} onClick={() => handleDelete(loc)}>🗑</button>
              </span>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={handleAdd} className="locations-panel__add-form">
        <Input placeholder="Add a city, town, island, or area…" value={newName} onChange={e => setNewName(e.target.value)} />
        <Button type="submit" size="sm" variant="secondary">+ Add</Button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Card>
  );
}
