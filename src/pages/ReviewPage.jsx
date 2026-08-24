import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getIntake, updateCandidate, acceptCandidate, rejectCandidate, resetCandidateToPending } from '../db/stores/intake';
import { getDestination } from '../db/stores/destinations';
import { invalidateCachedQueryPrefix } from '../hooks/useCachedQuery';
import { SECTIONS } from '../sectionRegistry';
import Card from '../components/Card';
import Button from '../components/Button';
import { Input, TextArea, Select } from '../components/Field';
import { MoneyField } from '../components/Money';
import { LoadingState, ErrorState } from '../components/States';
import '../components/SectionPageLayout.css';
import './ReviewPage.css';

// Only the 9 real content sections are valid targets for a candidate —
// Sources isn't extractable content in this sense.
const SECTION_OPTIONS = SECTIONS.filter(s => s.key !== 'sources');

export default function ReviewPage() {
  const { destinationId, intakeId } = useParams();
  const navigate = useNavigate();
  const [intake, setIntake] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [destination, setDestination] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [intakeData, dest] = await Promise.all([getIntake(intakeId), getDestination(destinationId)]);
      if (!intakeData) throw new Error('Import not found.');
      setIntake(intakeData.intake);
      setCandidates(intakeData.candidates);
      setDestination(dest);
    } catch (e) {
      setError(e.message);
    }
  }, [intakeId, destinationId]);

  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!intake) return <LoadingState label="Loading candidates…" />;

  const pending = candidates.filter(c => c.status === 'pending_review');
  const decided = candidates.filter(c => c.status !== 'pending_review');

  function patchLocal(id, patchFn) {
    setCandidates(prev => prev.map(c => (c.id === id ? patchFn(c) : c)));
  }

  async function handleAccept(candidate, section, sectionFields) {
    await updateCandidate(candidate.id, { proposedSection: section, proposedFields: sectionFields });
    const record = await acceptCandidate(candidate.id, { section, sectionFields });
    invalidateCachedQueryPrefix(`${section}:${destinationId}`);
    invalidateCachedQueryPrefix(`destination:${destinationId}`);
    patchLocal(candidate.id, c => ({ ...c, status: 'accepted', resultingStore: section, resultingRecordId: record.id }));
  }

  async function handleReject(candidate) {
    await rejectCandidate(candidate.id);
    patchLocal(candidate.id, c => ({ ...c, status: 'rejected' }));
  }

  async function handleUndo(candidate) {
    await resetCandidateToPending(candidate.id);
    patchLocal(candidate.id, c => ({ ...c, status: 'pending_review' }));
  }

  // Group pending candidates by their currently-proposed section, in
  // registry order, matching the "grouped by proposed section" example.
  const grouped = SECTION_OPTIONS.map(s => ({
    section: s,
    items: pending.filter(c => c.proposedSection === s.key),
  })).filter(g => g.items.length > 0);
  const unclassified = pending.filter(c => !c.proposedSection);

  return (
    <div className="review-page">
      <div className="section-page__breadcrumb">
        <Link to="/">Research</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/destinations/${destinationId}`}>{destination?.name}</Link>
        <span aria-hidden="true">/</span>
        <span>Review import</span>
      </div>

      <header className="review-page__header">
        <h1>Review imported text</h1>
        {intake.sourceLabel && <p className="review-page__source">Source: {intake.sourceLabel}</p>}
        <p className="review-page__hint">Nothing here has been added to your research yet. Review each candidate, then accept, edit, or reject it.</p>
      </header>

      <details className="review-page__raw">
        <summary>View original pasted text</summary>
        <pre className="review-page__raw-text">{intake.rawText}</pre>
      </details>

      {pending.length === 0 && decided.length === 0 && <p>No candidates were produced from this text.</p>}

      {grouped.map(({ section, items }) => (
        <section key={section.key} className="review-page__group">
          <h2>{section.icon} {section.label} <span className="review-page__group-count">({items.length})</span></h2>
          {items.map(candidate => (
            <CandidateCard key={candidate.id} candidate={candidate} defaultSection={section.key} onAccept={handleAccept} onReject={handleReject} />
          ))}
        </section>
      ))}

      {unclassified.length > 0 && (
        <section className="review-page__group">
          <h2>Unclassified <span className="review-page__group-count">({unclassified.length})</span></h2>
          {unclassified.map(candidate => (
            <CandidateCard key={candidate.id} candidate={candidate} defaultSection="" onAccept={handleAccept} onReject={handleReject} />
          ))}
        </section>
      )}

      {decided.length > 0 && (
        <section className="review-page__group">
          <h2>Already reviewed ({decided.length})</h2>
          {decided.map(c => (
            <Card key={c.id} padding="sm" className="review-page__decided-row">
              <span className={`review-page__status review-page__status--${c.status}`}>{c.status === 'accepted' ? 'Accepted' : 'Rejected'}</span>
              <span className="review-page__decided-excerpt">{c.sourceExcerpt}</span>
              {c.status === 'accepted' && c.resultingRecordId && (
                <Link to={`/destinations/${destinationId}/${SECTIONS.find(s => s.key === c.resultingStore)?.path}`} className="review-page__decided-link">View section</Link>
              )}
              {c.status === 'rejected' && <Button variant="ghost" size="sm" onClick={() => handleUndo(c)}>Undo</Button>}
            </Card>
          ))}
        </section>
      )}

      {pending.length === 0 && candidates.length > 0 && (
        <Button onClick={() => navigate(`/destinations/${destinationId}`)}>Done — back to destination</Button>
      )}
    </div>
  );
}

function CandidateCard({ candidate, defaultSection, onAccept, onReject }) {
  const [section, setSection] = useState(candidate.proposedSection || defaultSection || '');
  const [fields, setFields] = useState(() => normalizeFields(section, candidate.proposedFields));
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  function handleSectionChange(newSection) {
    setSection(newSection);
    setFields(normalizeFields(newSection, candidate.proposedFields));
  }

  async function handleAcceptClick() {
    setLocalError('');
    if (!section) { setLocalError('Choose a section before accepting.'); return; }
    const missing = validateRequired(section, fields);
    if (missing) { setLocalError(missing); return; }
    setBusy(true);
    try {
      const payload = buildCreatePayload(section, fields);
      await onAccept(candidate, section, payload);
    } catch (e) {
      setLocalError(e.message);
      setBusy(false);
    }
  }

  async function handleRejectClick() {
    setBusy(true);
    try {
      await onReject(candidate);
    } catch (e) {
      setLocalError(e.message);
      setBusy(false);
    }
  }

  return (
    <Card className="candidate-card">
      <p className="candidate-card__excerpt">"{candidate.sourceExcerpt}"</p>
      {candidate.uncertaintyNote && <p className="candidate-card__uncertainty">{candidate.uncertaintyNote}</p>}

      <Select label="Section" value={section} onChange={e => handleSectionChange(e.target.value)}>
        <option value="">Choose a section…</option>
        {SECTION_OPTIONS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
      </Select>

      {section && <CandidateFields section={section} fields={fields} onChange={setFields} />}

      {localError && <p className="form-error" role="alert">{localError}</p>}

      <div className="candidate-card__actions">
        <Button variant="primary" size="sm" onClick={handleAcceptClick} disabled={busy}>Accept</Button>
        <Button variant="ghost" size="sm" onClick={handleRejectClick} disabled={busy}>Reject</Button>
      </div>
    </Card>
  );
}

// Converts the extraction adapter's rough proposedFields (which uses
// `placeName` as a hint) into the exact field shape each section's
// create function expects. This is the one place that translation
// happens — the section stores themselves never see the candidate shape.
function normalizeFields(section, proposed) {
  const p = proposed || {};
  switch (section) {
    case 'attractions':
      return { place: { name: p.placeName || '', locality: '', city: '', country: '', googleMapsUrl: '' }, category: '', description: p.description || '', price: p.price || null, openingHours: '', typicalDurationMinutes: '', bestTimeOfDay: '' };
    case 'restaurants':
      return { hasPlace: Boolean(p.placeName), place: { name: p.placeName || '', locality: '', city: '', country: '', googleMapsUrl: '' }, dishName: p.placeName || '', cuisine: '', price: p.price || null, dietaryNotes: p.dietaryNotes || '' };
    case 'accommodations':
      return { place: { name: p.placeName || '', locality: '', city: '', country: '', googleMapsUrl: '' }, accommodationType: '', price: p.price || null, roomType: '', amenityNotes: p.amenityNotes || '' };
    case 'transport':
      return { fromLabel: '', toLabel: '', mode: '', price: p.price || null, duration: '', bookingNotes: p.bookingNotes || '' };
    case 'costs':
      return { item: p.item || '', price: p.price || null, context: p.context || '' };
    case 'practicalInfo':
      return { topic: p.topic || '', details: p.details || '' };
    case 'weatherNotes':
      return { period: p.period || '', description: p.description || '', recommendation: '' };
    case 'packingNotes':
      return { item: p.item || '', notes: p.notes || '', essential: false };
    case 'generalNotes':
      return { title: p.title || candidate_title_fallback(p), content: p.content || '' };
    default:
      return {};
  }
}
function candidate_title_fallback(p) { return p.title || ''; }

// Converts the review UI's working field state (which uses UI-only
// helpers like `hasPlace`, `fromLabel`/`toLabel`) into the exact shape
// each section's real create function expects — the same shape manual
// entry produces. This is the only place that translation happens.
function buildCreatePayload(section, fields) {
  switch (section) {
    case 'attractions':
    case 'accommodations':
      return { ...fields };
    case 'restaurants': {
      const { hasPlace, place, dishName, ...rest } = fields;
      return { ...rest, place: hasPlace ? place : null, dishName: hasPlace ? '' : dishName };
    }
    case 'transport': {
      const { fromLabel, toLabel, ...rest } = fields;
      return { ...rest, from: { label: fromLabel, place: null }, to: { label: toLabel, place: null } };
    }
    default:
      return { ...fields };
  }
}

function validateRequired(section, fields) {
  switch (section) {
    case 'attractions':
    case 'accommodations':
      return fields.place?.name ? null : 'A place name is required.';
    case 'restaurants':
      if (fields.hasPlace) return fields.place?.name ? null : 'A place name is required.';
      return fields.dishName?.trim() ? null : 'Give this a name.';
    case 'transport':
      return fields.fromLabel?.trim() && fields.toLabel?.trim() ? null : 'Both "From" and "To" are required.';
    case 'costs':
      return fields.item?.trim() ? null : 'Give this a name.';
    case 'practicalInfo':
      return fields.topic?.trim() ? null : 'Give this a topic.';
    case 'weatherNotes':
      return fields.period?.trim() ? null : 'Give this a period.';
    case 'packingNotes':
      return fields.item?.trim() ? null : 'Give this an item name.';
    case 'generalNotes':
      return fields.title?.trim() ? null : 'Give this a title.';
    default:
      return null;
  }
}

function CandidateFields({ section, fields, onChange }) {
  function set(patch) { onChange({ ...fields, ...patch }); }

  switch (section) {
    case 'attractions':
      return (
        <>
          <Input label="Place name" required value={fields.place?.name || ''} onChange={e => set({ place: { ...fields.place, name: e.target.value } })} />
          <Input label="Category" value={fields.category || ''} onChange={e => set({ category: e.target.value })} />
          <TextArea label="Description" value={fields.description || ''} onChange={e => set({ description: e.target.value })} rows={2} />
          <MoneyField label="Entry fee" value={fields.price} onChange={price => set({ price })} />
        </>
      );
    case 'restaurants':
      return (
        <>
          <label className="candidate-card__toggle">
            <input type="checkbox" checked={Boolean(fields.hasPlace)} onChange={e => set({ hasPlace: e.target.checked })} />
            <span>This is a specific restaurant (has a place)</span>
          </label>
          {fields.hasPlace ? (
            <Input label="Place name" required value={fields.place?.name || ''} onChange={e => set({ place: { ...fields.place, name: e.target.value } })} />
          ) : (
            <Input label="Dish / food note name" required value={fields.dishName || ''} onChange={e => set({ dishName: e.target.value })} />
          )}
          <Input label="Cuisine" value={fields.cuisine || ''} onChange={e => set({ cuisine: e.target.value })} />
          <MoneyField value={fields.price} onChange={price => set({ price })} />
        </>
      );
    case 'accommodations':
      return (
        <>
          <Input label="Place name" required value={fields.place?.name || ''} onChange={e => set({ place: { ...fields.place, name: e.target.value } })} />
          <Input label="Type" value={fields.accommodationType || ''} onChange={e => set({ accommodationType: e.target.value })} />
          <MoneyField label="Price per night" value={fields.price} onChange={price => set({ price })} />
        </>
      );
    case 'transport':
      return (
        <>
          <Input label="From" required value={fields.fromLabel || ''} onChange={e => set({ fromLabel: e.target.value })} />
          <Input label="To" required value={fields.toLabel || ''} onChange={e => set({ toLabel: e.target.value })} />
          <Input label="Mode" value={fields.mode || ''} onChange={e => set({ mode: e.target.value })} />
          <MoneyField value={fields.price} onChange={price => set({ price })} />
        </>
      );
    case 'costs':
      return (
        <>
          <Input label="Item" required value={fields.item || ''} onChange={e => set({ item: e.target.value })} />
          <MoneyField value={fields.price} onChange={price => set({ price })} />
          <TextArea label="Context" value={fields.context || ''} onChange={e => set({ context: e.target.value })} rows={2} />
        </>
      );
    case 'practicalInfo':
      return (
        <>
          <Input label="Topic" required value={fields.topic || ''} onChange={e => set({ topic: e.target.value })} />
          <TextArea label="Details" value={fields.details || ''} onChange={e => set({ details: e.target.value })} rows={3} />
        </>
      );
    case 'weatherNotes':
      return (
        <>
          <Input label="Period" required value={fields.period || ''} onChange={e => set({ period: e.target.value })} />
          <TextArea label="Description" value={fields.description || ''} onChange={e => set({ description: e.target.value })} rows={2} />
        </>
      );
    case 'packingNotes':
      return <Input label="Item" required value={fields.item || ''} onChange={e => set({ item: e.target.value })} />;
    case 'generalNotes':
      return (
        <>
          <Input label="Title" required value={fields.title || ''} onChange={e => set({ title: e.target.value })} />
          <TextArea label="Content" value={fields.content || ''} onChange={e => set({ content: e.target.value })} rows={3} />
        </>
      );
    default:
      return null;
  }
}
