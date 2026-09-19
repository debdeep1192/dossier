import { useCallback, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { getDestination } from '../db/stores/destinations';
import { listLocations, createLocation, updateLocation, deleteLocation } from '../db/stores/locations';
import { useCachedQuery, invalidateCachedQuery } from '../hooks/useCachedQuery';
import { SECTIONS } from '../sectionRegistry';
import Card from '../components/Card';
import Button from '../components/Button';
import { Input } from '../components/Field';
import { LoadingState, ErrorState, EmptyState } from '../components/States';
import { useOpenAddEntry } from '../lib/addEntryContext.js';
import './DestinationDetail.css';

// The destination page has two primary tabs (Chunk 10):
//   CITIES    - the destination's locations, shown as large, tappable
//               cards — tapping one opens that city's research directly.
//   RESEARCH  - the same 11-section grid as before, with a compact
//               "All | city..." filter row that scopes it, reusing the
//               exact ?location= mechanism every section page already
//               understands (see sectionHref() below) — no new filtering
//               logic, no duplicated records, just a different way of
//               reaching the same existing data.
// The destination-level overview stays above both tabs, since it's
// destination-wide information, not tied to a particular tab.
const TABS = ['cities', 'research'];

export default function DestinationDetail() {
  const { destinationId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeLocationId = searchParams.get('location') || '';
  const activeTab = TABS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'cities';
  const [managingLocations, setManagingLocations] = useState(false);
  const openAddEntry = useOpenAddEntry();

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

  function setTab(tab) {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    if (tab === 'cities') next.delete('location'); // the research-tab city filter is meaningless outside Research
    setSearchParams(next);
  }

  // Selecting a location scopes the section grid below to that
  // location — the Quick Add button and each section's own "New X"
  // button carry that context forward (see item 3: context-aware
  // creation), so opening Attractions from inside "Phuket" doesn't ask
  // the person to pick Thailand or Phuket again.
  function selectResearchLocation(locationId) {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'research');
    if (locationId) next.set('location', locationId);
    else next.delete('location');
    setSearchParams(next);
  }

  // Tapping a city card jumps straight into that city's Research view
  // — this is the "tapping a city opens that city's existing
  // destination/city view" requirement, using the exact same Research
  // tab and filter mechanism rather than a separate city page.
  function openCityResearch(locationId) {
    selectResearchLocation(locationId);
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
        {activeTab === 'research' && activeLocation && (
          <>
            <span aria-hidden="true">/</span>
            <span>{activeLocation.name}</span>
          </>
        )}
      </div>

      <header className="dest-detail__header">
        <h1>{destination.name}</h1>
        {destination.overview && <p className="dest-detail__overview">{destination.overview}</p>}
      </header>

      <div className="dest-detail__actions">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/destinations/${destinationId}/currency`)}>Currency settings</Button>
      </div>

      <div className="dest-detail__tabs">
        <button type="button" className={`dest-detail__tab ${activeTab === 'cities' ? 'dest-detail__tab--active' : ''}`} onClick={() => setTab('cities')}>Cities</button>
        <button type="button" className={`dest-detail__tab ${activeTab === 'research' ? 'dest-detail__tab--active' : ''}`} onClick={() => setTab('research')}>Research</button>
      </div>

      {activeTab === 'cities' ? (
        <CitiesTab
          destinationId={destinationId}
          locations={locations}
          managing={managingLocations}
          onToggleManaging={() => setManagingLocations(m => !m)}
          onOpenCity={openCityResearch}
          onOpenDestinationWide={() => selectResearchLocation('')}
          onChanged={refreshAfterLocationChange}
        />
      ) : (
        <ResearchTab
          destinationId={destinationId}
          locations={locations}
          activeLocationId={activeLocationId}
          onSelectLocation={selectResearchLocation}
          counts={counts}
          sectionHref={sectionHref}
          navigate={navigate}
          onAdd={openAddEntry}
        />
      )}
    </div>
  );
}

// CITIES tab — large, tappable cards, one per existing location, per
// the "significantly larger/more obvious than the current city
// presentation" requirement. Still built entirely on the existing
// locations.js CRUD (create/rename/delete) — no parallel city model.
function CitiesTab({ destinationId, locations, managing, onToggleManaging, onOpenCity, onOpenDestinationWide, onChanged }) {
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
    onChanged();
  }

  return (
    <div className="cities-tab">
      {locations.length === 0 ? (
        <EmptyState icon="🏙️" title="No cities yet" description="Add the cities, towns, or areas you're researching within this destination." />
      ) : (
        <div className="cities-tab__grid">
          {locations.map(loc => (
            <Card key={loc.id} interactive padding="md" className="city-card" onClick={() => !managing && onOpenCity(loc.id)}>
              {renamingId === loc.id ? (
                <span className="city-card__rename-row" onClick={e => e.stopPropagation()}>
                  <Input value={renameValue} onChange={e => setRenameValue(e.target.value)} autoFocus onKeyDown={e => e.key === 'Enter' && confirmRename(loc.id)} />
                  <button type="button" onClick={() => confirmRename(loc.id)}>✓</button>
                </span>
              ) : (
                <span className="city-card__name">{loc.name}</span>
              )}
              {managing && renamingId !== loc.id && (
                <span className="city-card__actions" onClick={e => e.stopPropagation()}>
                  <button type="button" aria-label={`Rename ${loc.name}`} onClick={() => startRename(loc)}>✎ Rename</button>
                  <button type="button" aria-label={`Delete ${loc.name}`} onClick={() => handleDelete(loc)}>🗑 Delete</button>
                </span>
              )}
            </Card>
          ))}
        </div>
      )}

      <button type="button" className="cities-tab__destination-wide-link" onClick={onOpenDestinationWide}>
        View destination-wide research →
      </button>

      <Card padding="sm" className="cities-tab__manage">
        <div className="locations-panel__header">
          <span className="locations-panel__title">Manage cities</span>
          {locations.length > 0 && (
            <button type="button" className="locations-panel__manage-toggle" onClick={onToggleManaging}>
              {managing ? 'Done' : 'Edit'}
            </button>
          )}
        </div>
        <form onSubmit={handleAdd} className="locations-panel__add-form">
          <Input placeholder="Add a city, town, island, or area…" value={newName} onChange={e => setNewName(e.target.value)} />
          <Button type="submit" size="sm" variant="secondary">+ Add</Button>
        </form>
        {error && <p className="form-error" role="alert">{error}</p>}
      </Card>
    </div>
  );
}

// RESEARCH tab — the same 11-section grid as before, with a compact
// "All | city..." filter row above it. "All" (locationId = '') shows
// the section counts/links unfiltered — since every section page
// already treats an absent ?location= as "show everything", this is
// simply the existing default behaviour, not new filtering logic.
function ResearchTab({ destinationId, locations, activeLocationId, onSelectLocation, counts, sectionHref, navigate, onAdd }) {
  const activeLocation = locations.find(l => l.id === activeLocationId) || null;

  // "Food & Restaurants" groups the Restaurants and Dishes sections
  // (Phase 3 Chunk 11) into ONE tile in the grid — this is a display
  // grouping only. Both remain fully separate entries in
  // sectionRegistry.js (needed so PDF import/review can still assign a
  // candidate to Restaurants or Dishes specifically) and fully
  // separate stores; only the destination-page tile is combined, since
  // both sections already share one page (RestaurantsPage.jsx, with
  // Restaurants/Dishes as its own internal tabs).
  const foodSection = SECTIONS.find(s => s.key === 'restaurants');
  const dishSection = SECTIONS.find(s => s.key === 'dishes');
  // General Notes stays in sectionRegistry.js (PDF import/review still
  // needs it as a selectable target — see ReviewPage.jsx's
  // SECTION_OPTIONS and intake.js's CREATORS), but is deliberately left
  // out of the primary grid here (Phase 3 Chunk 13) and surfaced only
  // in the small "More" row below, alongside Import from Text — both
  // are still fully functional, just no longer presented as equally
  // prominent as the main research categories.
  const generalNotesSection = SECTIONS.find(s => s.key === 'generalNotes');
  const otherSections = SECTIONS.filter(s => !['restaurants', 'dishes', 'generalNotes'].includes(s.key));
  const foodCount = (counts[foodSection.key] || 0) + (counts[dishSection.key] || 0);

  return (
    <div className="research-tab">
      {locations.length > 0 && (
        <div className="research-tab__filter">
          <button type="button" className={`locations-panel__chip ${!activeLocationId ? 'locations-panel__chip--active' : ''}`} onClick={() => onSelectLocation('')}>
            All
          </button>
          {locations.map(loc => (
            <button key={loc.id} type="button" className={`locations-panel__chip ${activeLocationId === loc.id ? 'locations-panel__chip--active' : ''}`} onClick={() => onSelectLocation(loc.id)}>
              {loc.name}
            </button>
          ))}
        </div>
      )}

      {activeLocation && (
        <p className="research-tab__scope-hint">Showing research for {activeLocation.name}. Destination-wide research is included under "All".</p>
      )}

      <div className="dest-detail__actions">
        <Button onClick={onAdd}>+ Add</Button>
      </div>

      <div className="dest-detail__section-grid">
        <Card
          key="food-and-restaurants"
          interactive
          padding="sm"
          className="section-tile"
          onClick={() => navigate(sectionHref(foodSection))}
        >
          <span className="section-tile__icon" aria-hidden="true">🍽️</span>
          <span className="section-tile__label">Food & Restaurants</span>
          <span className="section-tile__count">{foodCount}</span>
        </Card>
        {otherSections.map(section => (
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

      <div className="research-tab__more">
        <button type="button" className="research-tab__more-link" onClick={() => navigate(sectionHref(generalNotesSection))}>
          📝 General Notes {counts[generalNotesSection.key] > 0 ? `(${counts[generalNotesSection.key]})` : ''}
        </button>
        <button type="button" className="research-tab__more-link" onClick={() => navigate(`/destinations/${destinationId}/import`)}>
          📄 Import from text
        </button>
      </div>
    </div>
  );
}
