import { useState } from 'react';
import { useProfile } from '../context/ProfileContext';
import { profileApi } from '../api/research';
import Card from '../components/Card';
import { Select } from '../components/Field';
import { LoadingState } from '../components/States';
import './MorePage.css';

const COMMON_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'LKR', 'THB', 'AED', 'SGD', 'JPY'];

export default function MorePage() {
  const { profile, loading, refresh } = useProfile();
  const [saving, setSaving] = useState(false);

  if (loading) return <LoadingState />;

  async function handleCurrencyChange(e) {
    setSaving(true);
    try {
      await profileApi.updateHomeCurrency(e.target.value);
      await refresh();
    } finally {
      setSaving(false);
    }
  }

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
        <h2>Home currency</h2>
        <p className="more-page__detail more-page__detail--muted">
          Used later for budgeting and showing an approximate conversion next to research prices. Original prices you've researched always keep their own currency — this never rewrites them.
        </p>
        <Select
          label="Home currency"
          value={profile?.home_currency || 'INR'}
          onChange={handleCurrencyChange}
          disabled={saving}
        >
          {COMMON_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
        </Select>
      </Card>

      <Card className="more-page__section">
        <h2>Coming in later phases</h2>
        <ul className="more-page__future-list">
          <li>Sync status &amp; offline cache management</li>
          <li>Family-weight presets</li>
          <li>Currency conversion display</li>
          <li>Export / Import your complete data</li>
        </ul>
      </Card>
    </div>
  );
}
