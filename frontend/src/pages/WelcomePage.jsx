import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProfile } from '../context/ProfileContext';
import Button from '../components/Button';
import { Input } from '../components/Field';
import './WelcomePage.css';

export default function WelcomePage() {
  const { completeWelcome } = useProfile();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleContinue(e) {
    e?.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await completeWelcome(displayName.trim() || null);
      navigate('/research');
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="welcome-page">
      <div className="welcome-page__card">
        <div className="welcome-page__brand">
          <span className="welcome-page__brand-mark">D</span>
        </div>
        <h1 className="welcome-page__title">Welcome to Dossier</h1>
        <p className="welcome-page__subtitle">
          Your personal travel research and trip companion. Everything you add
          stays on this device — there's no account, no server, and no sign-in.
        </p>

        <form onSubmit={handleContinue}>
          <Input
            label="What should we call your dossier?"
            name="displayName"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="e.g. Debdeep"
            hint="Optional — just used to personalize the app. You can change it anytime."
            autoFocus
          />
          {error && <p className="welcome-page__error" role="alert">{error}</p>}
          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? 'Setting up…' : 'Get started'}
          </Button>
        </form>

        <p className="welcome-page__note">
          Already have a Dossier backup from another device? You can import it
          from the More tab once you're in.
        </p>
      </div>
    </div>
  );
}
