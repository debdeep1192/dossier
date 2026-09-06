import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { listDestinations, createDestination, deleteDestination } from '../db/stores/destinations';
import { useCachedQuery, invalidateCachedQuery } from '../hooks/useCachedQuery';
import Card from '../components/Card';
import Button from '../components/Button';
import Modal from '../components/Modal';
import { Input, TextArea, Select } from '../components/Field';
import { EmptyState, LoadingState, ErrorState } from '../components/States';
import './ResearchHome.css';

export default function ResearchHome() {
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetcher = useCallback(() => listDestinations(), []);
  const { data: destinations, error, loading, refresh } = useCachedQuery('destinations', fetcher);

  async function handleDelete(destination) {
    if (!window.confirm(`Delete "${destination.name}"? This is a first pass — deletion is permanent in this build.`)) return;
    await deleteDestination(destination.id);
    invalidateCachedQuery('destinations');
    refresh();
  }

  if (error && !destinations) return <ErrorState description={error} onRetry={refresh} />;
  // Only the very first load in this session (nothing cached yet) shows
  // a loading state — the shell above (header, button) is already on
  // screen from the moment the route renders.
  if (loading && !destinations) {
    return (
      <div className="research-home">
        <Header onNew={() => setShowCreateModal(true)} />
        <LoadingState label="Loading your destinations…" />
      </div>
    );
  }

  return (
    <div className="research-home">
      <Header onNew={() => setShowCreateModal(true)} />

      {destinations.length === 0 ? (
        <EmptyState
          icon="📖"
          title="No destinations yet"
          description="Add your first destination to start building your travel research."
          actionLabel="+ New Destination"
          onAction={() => setShowCreateModal(true)}
        />
      ) : (
        <div className="research-home__grid">
          {destinations.map(dest => (
            <Card key={dest.id} interactive onClick={() => navigate(`/destinations/${dest.id}`)} className="destination-card">
              <h3 className="destination-card__title">{dest.name}</h3>
              {dest.overview && <p className="destination-card__overview">{dest.overview}</p>}
              <button
                type="button"
                className="destination-card__delete"
                onClick={(e) => { e.stopPropagation(); handleDelete(dest); }}
                aria-label={`Delete ${dest.name}`}
              >
                Delete
              </button>
            </Card>
          ))}
        </div>
      )}

      <CreateDestinationModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={(dest) => { setShowCreateModal(false); invalidateCachedQuery('destinations'); navigate(`/destinations/${dest.id}`); }}
      />
    </div>
  );
}

function Header({ onNew }) {
  return (
    <header className="research-home__header">
      <div>
        <h1>Research</h1>
        <p className="research-home__subtitle">Your personal travel knowledge library.</p>
      </div>
      <Button onClick={onNew}>+ New Destination</Button>
    </header>
  );
}

function CreateDestinationModal({ open, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [overview, setOverview] = useState('');
  const [defaultCurrency, setDefaultCurrency] = useState('INR');
  const [customCurrency, setCustomCurrency] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isCustom = defaultCurrency === '__OTHER__';

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const resolvedCurrency = isCustom ? customCurrency.trim().toUpperCase() : defaultCurrency;
    if (isCustom && !resolvedCurrency) { setError('Enter a currency code, e.g. KGS.'); return; }
    setSubmitting(true);
    try {
      const dest = await createDestination({ name, overview, defaultCurrency: resolvedCurrency });
      setName(''); setOverview(''); setDefaultCurrency('INR'); setCustomCurrency('');
      onCreated(dest);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Destination">
      <form onSubmit={handleSubmit}>
        <Input label="Name" required autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sri Lanka" />
        <TextArea label="Overview" value={overview} onChange={e => setOverview(e.target.value)} placeholder="A short overview (optional)" rows={3} />
        <Select label="Default currency" hint="INR and USD are always available regardless of what you pick here. You can change this or add more currencies later from Currency settings." value={defaultCurrency} onChange={e => setDefaultCurrency(e.target.value)}>
          <option value="INR">INR</option>
          <option value="USD">USD</option>
          <option value="__OTHER__">Other…</option>
        </Select>
        {isCustom && <Input label="Currency code" placeholder="e.g. KGS" value={customCurrency} onChange={e => setCustomCurrency(e.target.value)} />}
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Creating…' : 'Create Destination'}</Button>
      </form>
    </Modal>
  );
}
