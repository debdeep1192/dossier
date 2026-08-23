import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { destinationsApi, researchItemsApi } from '../api/research';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useCachedQuery, invalidateCachedQuery } from '../hooks/useCachedQuery';
import SearchBar from '../components/SearchBar';
import Card from '../components/Card';
import Button from '../components/Button';
import Modal from '../components/Modal';
import { Input, TextArea } from '../components/Field';
import { PriorityBadge, ItemKindBadge } from '../components/Badge';
import { EmptyState, LoadingState, ErrorState } from '../components/States';
import './ResearchHome.css';

export default function ResearchHome() {
  const navigate = useNavigate();
  const [deleteError, setDeleteError] = useState('');

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetcher = useCallback(async () => {
    const [destData, recentData] = await Promise.all([
      destinationsApi.list(),
      destinationsApi.recentlyUpdated(6),
    ]);
    return { destinations: destData.destinations, recentItems: recentData.items };
  }, []);
  // Single cache key for the whole home screen — it's one screen's worth
  // of data fetched together, so one key is simpler than two and avoids
  // any risk of the two lists getting out of sync in the cache.
  const { data, error, refresh } = useCachedQuery('research-home', fetcher);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    destinationsApi.search(debouncedQuery)
      .then(data => setSearchResults(data.results))
      .catch(() => setSearchResults([]))
      .finally(() => setSearching(false));
  }, [debouncedQuery]);

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (!data) return <LoadingState label="Loading your research library…" />;

  const { destinations, recentItems } = data;
  const isSearchMode = query.trim().length > 0;

  async function handleDeleteItem(item) {
    if (!window.confirm(`Remove "${item.title}" from your research? It will be moved to trash rather than permanently deleted.`)) return;
    await researchItemsApi.remove(item.id);
    setSearchResults(prev => prev ? prev.filter(i => i.id !== item.id) : prev);
    invalidateCachedQuery('research-home');
    refresh();
  }

  async function handleDeleteDestination(destination) {
    if (!window.confirm(`Delete "${destination.name}" and everything in it? This includes ${destination.item_count} research item${destination.item_count === '1' ? '' : 's'}. It will be moved to trash rather than permanently deleted.`)) return;
    setDeleteError('');
    try {
      await destinationsApi.remove(destination.id);
      invalidateCachedQuery('research-home');
      refresh();
    } catch (e) {
      setDeleteError(e.message);
    }
  }

  return (
    <div className="research-home">
      <header className="research-home__header">
        <div>
          <h1>Research</h1>
          <p className="research-home__subtitle">Your personal travel knowledge library.</p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>+ New Destination</Button>
      </header>

      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder="Search destinations, attractions, notes, tags…"
      />

      {isSearchMode ? (
        <section className="research-home__section">
          <h2>Search results</h2>
          {searching && <LoadingState label="Searching…" />}
          {!searching && searchResults && searchResults.length === 0 && (
            <EmptyState icon="⌕" title="No matches" description={`Nothing found for "${query}".`} />
          )}
          {!searching && searchResults && searchResults.length > 0 && (
            <div className="research-home__result-list">
              {searchResults.map(item => (
                <SearchResultRow key={item.id} item={item} navigate={navigate} onDelete={handleDeleteItem} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          {recentItems && recentItems.length > 0 && (
            <section className="research-home__section">
              <h2>Recently updated</h2>
              <div className="research-home__result-list">
                {recentItems.map(item => (
                  <SearchResultRow key={item.id} item={item} navigate={navigate} onDelete={handleDeleteItem} />
                ))}
              </div>
            </section>
          )}

          <section className="research-home__section">
            <h2>Destinations</h2>
            {deleteError && <p className="research-home__form-error" role="alert">{deleteError}</p>}
            {destinations.length === 0 ? (
              <EmptyState
                icon="📖"
                title="No destinations yet"
                description="Start building your travel research library by adding your first destination."
                actionLabel="+ New Destination"
                onAction={() => setShowCreateModal(true)}
              />
            ) : (
              <div className="research-home__destination-grid">
                {destinations.map(dest => (
                  <DestinationCard
                    key={dest.id}
                    destination={dest}
                    onClick={() => navigate(`/research/${dest.id}`)}
                    onDelete={() => handleDeleteDestination(dest)}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <CreateDestinationModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={(dest) => { setShowCreateModal(false); invalidateCachedQuery('research-home'); navigate(`/research/${dest.id}`); }}
      />
    </div>
  );
}

function DestinationCard({ destination, onClick, onDelete }) {
  return (
    <Card interactive onClick={onClick} className="destination-card">
      <h3 className="destination-card__title">{destination.name}</h3>
      {destination.overview && <p className="destination-card__overview">{destination.overview}</p>}
      <div className="destination-card__stats">
        <span>{destination.section_count} section{destination.section_count === '1' ? '' : 's'}</span>
        <span aria-hidden="true">·</span>
        <span>{destination.item_count} item{destination.item_count === '1' ? '' : 's'}</span>
      </div>
      <div className="destination-card__actions">
        <button
          type="button"
          className="destination-card__delete"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          aria-label={`Delete ${destination.name}`}
        >
          Delete
        </button>
      </div>
    </Card>
  );
}

function SearchResultRow({ item, navigate, onDelete }) {
  return (
    <Card
      interactive
      padding="sm"
      className="result-row"
      onClick={() => navigate(`/research/${item.destination_id}/items/${item.id}`)}
    >
      <div className="result-row__main">
        <div className="result-row__title-line">
          <span className="result-row__title">{item.title}</span>
          <ItemKindBadge kind={item.item_kind} />
        </div>
        <div className="result-row__meta">
          {item.destination_name}
          {item.section_name ? ` · ${item.section_name}` : ' · Destination overview'}
        </div>
      </div>
      <button
        type="button"
        className="result-row__delete"
        onClick={(e) => { e.stopPropagation(); onDelete(item); }}
        aria-label={`Delete ${item.title}`}
      >
        Delete
      </button>
      <PriorityBadge priority={item.priority} />
    </Card>
  );
}

function CreateDestinationModal({ open, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [overview, setOverview] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) { setName(''); setOverview(''); setError(''); }
  }, [open]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const data = await destinationsApi.create({ name, overview });
      onCreated(data.destination);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Destination">
      <form onSubmit={handleSubmit}>
        <Input
          label="Destination name"
          required
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Sri Lanka"
          autoFocus
        />
        <TextArea
          label="Overview"
          value={overview}
          onChange={e => setOverview(e.target.value)}
          placeholder="A short summary of this destination…"
          hint="Optional. You can add or edit this anytime."
        />
        {error && <p className="research-home__form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>
          {submitting ? 'Creating…' : 'Create Destination'}
        </Button>
      </form>
    </Modal>
  );
}
