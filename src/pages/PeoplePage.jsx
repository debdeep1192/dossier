import { useState, useCallback } from 'react';
import { listPeople, createPerson, updatePerson, deletePerson, emptyPerson } from '../db/stores/people';
import { useCachedQuery, invalidateCachedQuery } from '../hooks/useCachedQuery';
import Card from '../components/Card';
import Button from '../components/Button';
import Modal from '../components/Modal';
import { Input } from '../components/Field';
import { EmptyState, LoadingState, ErrorState } from '../components/States';
import '../components/SectionPageLayout.css';

// Traveller directory — Tour Planning, Chunk 1. Deliberately minimal
// (name + DOB only, per the approved design's "do not build a large
// people-management system" instruction), modeled directly on
// GeneralNotesPage.jsx's list/modal-form pattern since People has the
// same shape of need (a flat list of small records) — no new UI
// pattern invented. Reuses the existing .entry-card / .section-page__*
// classes (SectionPageLayout.css) rather than adding new CSS, since
// this page is a top-level list like ResearchHome, not destination-
// scoped, so SectionPageLayout itself (which assumes a destination
// breadcrumb) isn't a fit — only its list/card styling is reused.
export default function PeoplePage() {
  const [editing, setEditing] = useState(null);

  const fetcher = useCallback(() => listPeople(), []);
  const { data: people, error, loading, refresh } = useCachedQuery('people', fetcher);

  function afterMutation() {
    invalidateCachedQuery('people');
    refresh();
  }

  async function handleDelete(person) {
    if (!window.confirm(`Remove "${person.name}" from your travellers?`)) return;
    await deletePerson(person.id);
    afterMutation();
  }

  if (error && !people) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !people) return <LoadingState label="Loading travellers…" />;

  return (
    <div className="section-page">
      <header className="section-page__header">
        <div>
          <h1>Travellers</h1>
          <p className="section-page__subtitle">People who can be added to a Planning.</p>
        </div>
        <Button onClick={() => setEditing({})}>+ New Person</Button>
      </header>

      <div className="section-page__list">
        {people.length === 0 ? (
          <EmptyState icon="🧑" title="No travellers yet" description="Add the people who'll be joining your trips." actionLabel="+ New Person" onAction={() => setEditing({})} />
        ) : (
          people.map(person => (
            <Card key={person.id} interactive padding="sm" className="entry-card" onClick={() => setEditing(person)}>
              <div className="entry-card__main">
                <span className="entry-card__title">{person.name}</span>
                <p className="entry-card__meta">Born {person.dob}</p>
              </div>
              <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); handleDelete(person); }}>Delete</button>
            </Card>
          ))
        )}
      </div>

      {editing !== null && (
        <PersonForm record={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); afterMutation(); }} />
      )}
    </div>
  );
}

function PersonForm({ record, onClose, onSaved }) {
  const base = record || emptyPerson();
  const [name, setName] = useState(base.name || '');
  const [dob, setDob] = useState(base.dob || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required.'); return; }
    if (!dob) { setError('Date of birth is required.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fields = { name: name.trim(), dob };
      if (record) await updatePerson(record.id, fields);
      else await createPerson(fields);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={record ? 'Edit Person' : 'New Person'}>
      <form onSubmit={handleSubmit}>
        <Input label="Name" required autoFocus value={name} onChange={e => setName(e.target.value)} />
        <Input label="Date of birth" type="date" required value={dob} onChange={e => setDob(e.target.value)} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}
