import { useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getDestination } from '../db/stores/destinations';
import { useCachedQuery } from '../hooks/useCachedQuery';
import { SECTIONS } from '../sectionRegistry';
import Card from '../components/Card';
import Button from '../components/Button';
import { LoadingState, ErrorState } from '../components/States';
import './DestinationDetail.css';

export default function DestinationDetail() {
  const { destinationId } = useParams();
  const navigate = useNavigate();

  const fetcher = useCallback(async () => {
    const destination = await getDestination(destinationId);
    if (!destination) throw new Error('Destination not found.');
    const counts = await Promise.all(SECTIONS.map(s => s.list(destinationId)));
    return { destination, counts: Object.fromEntries(SECTIONS.map((s, i) => [s.key, counts[i].length])) };
  }, [destinationId]);

  const { data, error, loading, refresh } = useCachedQuery(`destination:${destinationId}`, fetcher);

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading destination…" />;

  const { destination, counts } = data;

  return (
    <div className="dest-detail">
      <div className="dest-detail__breadcrumb">
        <Link to="/">Research</Link>
        <span aria-hidden="true">/</span>
        <span>{destination.name}</span>
      </div>

      <header className="dest-detail__header">
        <h1>{destination.name}</h1>
        {destination.overview && <p className="dest-detail__overview">{destination.overview}</p>}
      </header>

      <div className="dest-detail__actions">
        <Button variant="secondary" size="sm" onClick={() => navigate(`/destinations/${destinationId}/import`)}>+ Import from text</Button>
        <Button variant="ghost" size="sm" onClick={() => navigate(`/destinations/${destinationId}/currency`)}>Currency settings</Button>
      </div>

      <div className="dest-detail__section-grid">
        {SECTIONS.map(section => (
          <Card
            key={section.key}
            interactive
            padding="sm"
            className="section-tile"
            onClick={() => navigate(`/destinations/${destinationId}/${section.path}`)}
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
