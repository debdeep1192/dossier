import { useProfile } from '../context/ProfileContext';
import Card from '../components/Card';
import { LoadingState } from '../components/States';
import './MorePage.css';

export default function MorePage() {
  const { profile, loading } = useProfile();

  if (loading) return <LoadingState />;

  return (
    <div className="more-page">
      <h1>More</h1>

      <Card className="more-page__section">
        <h2>Profile</h2>
        <p className="more-page__detail"><strong>Name:</strong> {profile?.display_name || '—'}</p>
        <p className="more-page__detail more-page__detail--muted">
          Dossier is local-first — everything stays on this device. There's no account and no sign-in.
        </p>
      </Card>

      <Card className="more-page__section">
        <h2>Coming in later phases</h2>
        <ul className="more-page__future-list">
          <li>Sync status &amp; offline cache management</li>
          <li>Family-weight presets</li>
          <li>Currency defaults</li>
          <li>Export / Import your complete data</li>
        </ul>
      </Card>
    </div>
  );
}
