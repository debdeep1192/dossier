import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { listPlannings, deletePlanning } from '../db/stores/plannings';
import { listDestinations } from '../db/stores/destinations';
import { useCachedQuery, invalidateCachedQuery } from '../hooks/useCachedQuery';
import Card from '../components/Card';
import Button from '../components/Button';
import { EmptyState, LoadingState, ErrorState } from '../components/States';
import '../components/SectionPageLayout.css';

// Top-level Plannings list, one level up from any single destination —
// a Planning always belongs to one destination, but a person may have
// Plannings across several destinations, so this mirrors ResearchHome's
// own top-level-list shape rather than living under a single
// destination's section grid. Tour Planning, Chunk 1: list + create +
// soft-delete only — no itinerary content yet (see PlanningDetailPage).
export default function PlanningsPage() {
  const navigate = useNavigate();

  // Plannings span every destination, so this reads across all of them
  // (there's no single destinationId to scope a listActive() index
  // query by) — small-scale personal data per the project's own
  // "not an enterprise product" principle, so an N+1-shaped fetch here
  // (one listPlannings call per destination) is an acceptable, simple
  // choice rather than adding a new cross-destination index.
  const fetcher = useCallback(async () => {
    const destinations = await listDestinations();
    const perDestination = await Promise.all(destinations.map(d => listPlannings(d.id)));
    const plannings = perDestination.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const destinationsById = Object.fromEntries(destinations.map(d => [d.id, d]));
    return { plannings, destinations, destinationsById };
  }, []);
  const { data, error, loading, refresh } = useCachedQuery('plannings', fetcher);

  function afterMutation() {
    invalidateCachedQuery('plannings');
    refresh();
  }

  async function handleDelete(planning) {
    if (!window.confirm(`Delete "${planning.name}"?`)) return;
    await deletePlanning(planning.id);
    afterMutation();
  }

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading plannings…" />;

  const { plannings, destinations, destinationsById } = data;
  const hasDestinations = destinations.length > 0;

  return (
    <div className="section-page">
      <header className="section-page__header">
        <div>
          <h1>Plannings</h1>
          <p className="section-page__subtitle">Build a trip from your Research.</p>
        </div>
        {hasDestinations && <Button onClick={() => navigate('/plannings/new')}>+ New Planning</Button>}
      </header>

      <div className="section-page__list">
        {!hasDestinations ? (
          <EmptyState icon="🗺️" title="No destinations yet" description="Add a Research destination first — a Planning is always built on top of one." />
        ) : plannings.length === 0 ? (
          <EmptyState icon="🗺️" title="No plannings yet" description="Create a Planning to start building a trip from your Research." actionLabel="+ New Planning" onAction={() => navigate('/plannings/new')} />
        ) : (
          plannings.map(planning => (
            <Card key={planning.id} interactive padding="sm" className="entry-card" onClick={() => navigate(`/plannings/${planning.id}`)}>
              <div className="entry-card__main">
                <span className="entry-card__title">{planning.name}</span>
                <p className="entry-card__meta">
                  {destinationsById[planning.destinationId]?.name || 'Unknown destination'} · {planning.startDate} – {planning.endDate}
                </p>
              </div>
              <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); handleDelete(planning); }}>Delete</button>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
