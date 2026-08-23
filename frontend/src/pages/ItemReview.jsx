import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { intakeApi, candidatesApi, destinationsApi } from '../api/research';
import { invalidateCachedQuery, invalidateCachedQueryPrefix } from '../hooks/useCachedQuery';
import Card from '../components/Card';
import Button from '../components/Button';
import { Input, TextArea, Select } from '../components/Field';
import { LoadingState, ErrorState } from '../components/States';
import { PriceField } from '../components/Price';
import './ItemReview.css';

const ITEM_KIND_OPTIONS = [
  { value: 'attraction', label: 'Attraction' },
  { value: 'activity', label: 'Activity' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'food', label: 'Food / Dish' },
  { value: 'accommodation', label: 'Accommodation' },
  { value: 'transport', label: 'Transport' },
  { value: 'practical_info', label: 'Practical Info' },
  { value: 'note', label: 'Research Note (general)' },
];

// The review screen for candidates produced by document/text intake.
// This is the load-bearing UI for "the parser is never allowed to
// silently become the source of truth" — every candidate sits here
// until the person explicitly accepts (creating a real research item,
// via the same path manual entry uses), edits, or rejects it. Nothing
// on this screen writes to research_items except an explicit Accept.
export default function ItemReview() {
  const { destinationId, intakeId } = useParams();
  const navigate = useNavigate();
  const [intake, setIntake] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [sections, setSections] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [intakeData, destData] = await Promise.all([
        intakeApi.get(intakeId),
        destinationsApi.get(destinationId),
      ]);
      setIntake(intakeData.intake);
      setCandidates(intakeData.candidates);
      setSections(destData.sections);
    } catch (e) {
      setError(e.message);
    }
  }, [intakeId, destinationId]);

  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!intake) return <LoadingState label="Loading candidates…" />;

  const pending = candidates.filter(c => c.status === 'pending_review');
  const decided = candidates.filter(c => c.status !== 'pending_review');

  async function refreshOne(id, patchFn) {
    setCandidates(prev => prev.map(c => (c.id === id ? patchFn(c) : c)));
  }

  async function handleAccept(candidate, { sectionId }) {
    const result = await candidatesApi.accept(candidate.id, { destinationId, sectionId: sectionId || null });
    invalidateCachedQuery(`destination:${destinationId}`);
    invalidateCachedQueryPrefix('research-home');
    refreshOne(candidate.id, c => ({ ...c, status: 'accepted', resulting_item_id: result.item.id }));
  }

  async function handleReject(candidate) {
    await candidatesApi.reject(candidate.id);
    refreshOne(candidate.id, c => ({ ...c, status: 'rejected' }));
  }

  async function handleReset(candidate) {
    await candidatesApi.resetToPending(candidate.id);
    refreshOne(candidate.id, c => ({ ...c, status: 'pending_review' }));
  }

  async function handleFieldSave(candidate, patch) {
    const updated = await candidatesApi.update(candidate.id, patch);
    refreshOne(candidate.id, () => updated.candidate);
  }

  return (
    <div className="item-review">
      <div className="item-review__breadcrumb">
        <Link to="/research">Research</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/research/${destinationId}`}>Destination</Link>
        <span aria-hidden="true">/</span>
        <span>Review import</span>
      </div>

      <header className="item-review__header">
        <h1>Review imported text</h1>
        {intake.source_label && <p className="item-review__source">Source: {intake.source_label}</p>}
        <p className="item-review__hint">
          Nothing here has been added to your research yet. Review each candidate below, then accept, edit, or reject it.
        </p>
      </header>

      <details className="item-review__raw">
        <summary>View original pasted text</summary>
        <pre className="item-review__raw-text">{intake.raw_text}</pre>
      </details>

      {pending.length === 0 && decided.length === 0 && (
        <p className="item-review__empty">No candidates were produced from this text.</p>
      )}

      {pending.length > 0 && (
        <section className="item-review__section">
          <h2>To review ({pending.length})</h2>
          {pending.map(candidate => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              sections={sections}
              onAccept={(opts) => handleAccept(candidate, opts)}
              onReject={() => handleReject(candidate)}
              onSave={(patch) => handleFieldSave(candidate, patch)}
            />
          ))}
        </section>
      )}

      {decided.length > 0 && (
        <section className="item-review__section">
          <h2>Already reviewed ({decided.length})</h2>
          {decided.map(candidate => (
            <DecidedCandidateRow
              key={candidate.id}
              candidate={candidate}
              destinationId={destinationId}
              onReset={() => handleReset(candidate)}
            />
          ))}
        </section>
      )}

      {pending.length === 0 && candidates.length > 0 && (
        <Button variant="primary" onClick={() => navigate(`/research/${destinationId}`)}>Done — back to destination</Button>
      )}
    </div>
  );
}

function CandidateCard({ candidate, sections, onAccept, onReject, onSave }) {
  const [itemKind, setItemKind] = useState(candidate.proposed_item_kind || '');
  const [title, setTitle] = useState(candidate.proposed_title || '');
  const [content, setContent] = useState(candidate.proposed_content || '');
  const [price, setPrice] = useState(candidate.proposed_price || null);
  const [sectionId, setSectionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  async function handleAcceptClick() {
    setLocalError('');
    setBusy(true);
    try {
      // Persist any in-progress edits before accepting, so Accept always
      // reflects exactly what's on screen.
      await onSave({ proposedItemKind: itemKind || null, proposedTitle: title || null, proposedContent: content, proposedPrice: price });
      await onAccept({ sectionId });
    } catch (e) {
      setLocalError(e.message);
      setBusy(false);
    }
  }

  async function handleRejectClick() {
    setBusy(true);
    try {
      await onReject();
    } catch (e) {
      setLocalError(e.message);
      setBusy(false);
    }
  }

  return (
    <Card className="candidate-card">
      <p className="candidate-card__excerpt">“{candidate.source_excerpt}”</p>
      {candidate.uncertainty_note && <p className="candidate-card__uncertainty">{candidate.uncertainty_note}</p>}

      <Select label="Type" value={itemKind} onChange={e => setItemKind(e.target.value)}>
        <option value="">Choose a type…</option>
        {ITEM_KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
      <Input label="Title" value={title} onChange={e => setTitle(e.target.value)} placeholder="What is this?" />
      <Select label="Section" value={sectionId} onChange={e => setSectionId(e.target.value)}>
        <option value="">General (whole destination)</option>
        {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
      <TextArea label="Details" value={content} onChange={e => setContent(e.target.value)} rows={3} />
      <PriceField value={price} onChange={setPrice} />

      {localError && <p className="candidate-card__error" role="alert">{localError}</p>}

      <div className="candidate-card__actions">
        <Button variant="primary" size="sm" onClick={handleAcceptClick} disabled={busy}>Accept</Button>
        <Button variant="ghost" size="sm" onClick={handleRejectClick} disabled={busy}>Reject</Button>
      </div>
    </Card>
  );
}

function DecidedCandidateRow({ candidate, destinationId, onReset }) {
  return (
    <Card padding="sm" className="candidate-row">
      <span className={`candidate-row__status candidate-row__status--${candidate.status}`}>
        {candidate.status === 'accepted' ? 'Accepted' : 'Rejected'}
      </span>
      <span className="candidate-row__excerpt">{candidate.source_excerpt}</span>
      {candidate.status === 'accepted' && candidate.resulting_item_id && (
        <Link to={`/research/${destinationId}/items/${candidate.resulting_item_id}`} className="candidate-row__link">View item</Link>
      )}
      {candidate.status === 'rejected' && (
        <Button variant="ghost" size="sm" onClick={onReset}>Undo</Button>
      )}
    </Card>
  );
}
