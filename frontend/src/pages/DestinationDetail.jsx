import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { destinationsApi, sectionsApi, researchItemsApi, intakeApi } from '../api/research';
import { useCachedQuery, invalidateCachedQuery, invalidateCachedQueryPrefix } from '../hooks/useCachedQuery';
import Card from '../components/Card';
import Button from '../components/Button';
import Modal from '../components/Modal';
import { Input, TextArea, Select } from '../components/Field';
import { PriorityBadge, ItemKindBadge } from '../components/Badge';
import { PriceField, PriceDisplay } from '../components/Price';
import { LoadingState, ErrorState, EmptyState } from '../components/States';
import './DestinationDetail.css';

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

const KIND_ACCENT = {
  attraction: 'var(--color-teal)',
  activity: 'var(--color-teal-dark)',
  restaurant: 'var(--color-coral)',
  food: 'var(--color-saffron)',
  accommodation: 'var(--color-saffron-dark)',
  transport: 'var(--color-neutral-500)',
  practical_info: 'var(--color-teal-dark)',
  note: 'var(--color-neutral-400)',
};

export default function DestinationDetail() {
  const { destinationId } = useParams();
  const navigate = useNavigate();
  const [filterQuery, setFilterQuery] = useState('');

  const [showAddSection, setShowAddSection] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [addItemSectionId, setAddItemSectionId] = useState(undefined); // undefined = destination-level

  const sectionRefs = useRef({});

  const fetcher = useCallback(() => destinationsApi.get(destinationId), [destinationId]);
  const { data, error, refresh } = useCachedQuery(`destination:${destinationId}`, fetcher);

  function afterMutation() {
    invalidateCachedQuery(`destination:${destinationId}`);
    // The Research home list (destination cards, recently-updated list)
    // shows counts/timestamps that just changed — invalidate it too so
    // navigating back there doesn't show stale numbers from cache.
    invalidateCachedQueryPrefix('research-home');
    refresh();
  }

  // Loading state only when there is truly nothing to show yet (first
  // visit to this destination in this session) — a revisit shows the
  // cached content immediately while refresh() quietly re-runs, so
  // moving between destinations already seen this session has no
  // loading flash at all.
  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (!data) return <LoadingState label="Loading destination…" />;

  const { destination, sections, items } = data;

  const destinationLevelNotes = items.filter(i => i.section_id === null);
  const itemsBySection = {};
  for (const section of sections) {
    itemsBySection[section.id] = items.filter(i => i.section_id === section.id);
  }

  const q = filterQuery.trim().toLowerCase();
  const matchesFilter = (item) => !q || item.title.toLowerCase().includes(q) || (item.content || '').toLowerCase().includes(q);

  function scrollToSection(sectionId) {
    sectionRefs.current[sectionId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="dest-detail">
      <div className="dest-detail__breadcrumb">
        <Link to="/research">Research</Link>
        <span aria-hidden="true">/</span>
        <span>{destination.name}</span>
      </div>

      <header className="dest-detail__header">
        <h1>{destination.name}</h1>
        {destination.overview && <p className="dest-detail__overview">{destination.overview}</p>}
      </header>

      <div className="dest-detail__filter">
        <Input
          placeholder="Filter items in this destination…"
          value={filterQuery}
          onChange={e => setFilterQuery(e.target.value)}
          aria-label="Filter items in this destination"
        />
      </div>

      {/* Destination-level notes — the "book preface", shown above the TOC */}
      {destinationLevelNotes.filter(matchesFilter).length > 0 && (
        <section className="dest-detail__preface">
          <h2 className="dest-detail__preface-title">General Notes</h2>
          <p className="dest-detail__preface-hint">Knowledge that applies to the whole destination, not one section.</p>
          <div className="dest-detail__item-list">
            {destinationLevelNotes.filter(matchesFilter).map(item => (
              <ItemRow key={item.id} item={item} onClick={() => navigate(`/research/${destinationId}/items/${item.id}`)} />
            ))}
          </div>
        </section>
      )}

      {/* Table of Contents */}
      {sections.length > 0 && (
        <nav className="dest-detail__toc" aria-label="Table of contents">
          {sections.map(section => (
            <button key={section.id} className="dest-detail__toc-chip" onClick={() => scrollToSection(section.id)}>
              {section.name}
              <span className="dest-detail__toc-count">{itemsBySection[section.id]?.length || 0}</span>
            </button>
          ))}
        </nav>
      )}

      <div className="dest-detail__actions">
        <Button variant="secondary" size="sm" onClick={() => setShowAddSection(true)}>+ Section</Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => { setAddItemSectionId(null); setShowAddItem(true); }}
        >
          + General Note
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setShowImport(true)}>+ Import from text</Button>
      </div>

      {sections.length === 0 && destinationLevelNotes.length === 0 && (
        <EmptyState
          icon="📖"
          title="This destination is empty"
          description="Add a section (like Attractions or Food) to start organizing your research, or add a general note first."
          actionLabel="+ Add Section"
          onAction={() => setShowAddSection(true)}
        />
      )}

      {sections.map(section => {
        const sectionItems = (itemsBySection[section.id] || []).filter(matchesFilter);
        return (
          <section
            key={section.id}
            className="dest-detail__section"
            ref={el => { sectionRefs.current[section.id] = el; }}
          >
            <div className="dest-detail__section-header">
              <h2>{section.name}</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setAddItemSectionId(section.id); setShowAddItem(true); }}
              >
                + Add item
              </Button>
            </div>
            {sectionItems.length === 0 ? (
              <p className="dest-detail__section-empty">
                {q ? 'No items in this section match your filter.' : 'No items yet in this section.'}
              </p>
            ) : (
              <div className="dest-detail__item-list">
                {sectionItems.map(item => (
                  <ItemRow key={item.id} item={item} onClick={() => navigate(`/research/${destinationId}/items/${item.id}`)} />
                ))}
              </div>
            )}
          </section>
        );
      })}

      <AddSectionModal
        open={showAddSection}
        destinationId={destinationId}
        onClose={() => setShowAddSection(false)}
        onCreated={() => { setShowAddSection(false); afterMutation(); }}
      />
      <AddItemModal
        open={showAddItem}
        destinationId={destinationId}
        sections={sections}
        initialSectionId={addItemSectionId}
        onClose={() => setShowAddItem(false)}
        onCreated={(item) => { setShowAddItem(false); invalidateCachedQuery(`destination:${destinationId}`); navigate(`/research/${destinationId}/items/${item.id}`); }}
      />
      <ImportTextModal
        open={showImport}
        destinationId={destinationId}
        onClose={() => setShowImport(false)}
        onImported={(intake) => { setShowImport(false); navigate(`/research/${destinationId}/review/${intake.id}`); }}
      />
    </div>
  );
}

function ItemRow({ item, onClick }) {
  const priceText = item.price ? <PriceDisplay price={item.price} /> : null;
  return (
    <Card interactive padding="sm" accentColor={KIND_ACCENT[item.item_kind]} onClick={onClick} className="item-row">
      <div className="item-row__main">
        <div className="item-row__title-line">
          <span className="item-row__title">{item.title}</span>
          <ItemKindBadge kind={item.item_kind} />
        </div>
        {item.content && <p className="item-row__snippet">{item.content}</p>}
        {priceText && <p className="item-row__price">{priceText}</p>}
      </div>
      <PriorityBadge priority={item.priority} />
    </Card>
  );
}

function AddSectionModal({ open, destinationId, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (open) { setName(''); setError(''); } }, [open]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await sectionsApi.create({ destinationId, name });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Section">
      <form onSubmit={handleSubmit}>
        <Input
          label="Section name"
          required
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Attractions, Food, Where to Stay"
          hint="Sections are fully customisable — use whatever structure fits this destination."
          autoFocus
        />
        {error && <p className="dest-detail__form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Creating…' : 'Create Section'}</Button>
      </form>
    </Modal>
  );
}

// Fields shown for each item_kind — the anti-generic-form contract.
// Every kind gets: title, priority, content (all always relevant).
// price is shown for the kinds where "how much does this cost" is a
// meaningful question; hours/duration/location only for physical
// places; practical_info and note get none of the type-specific extras,
// since they're deliberately unstructured general knowledge.
const KIND_FIELD_SETS = {
  attraction: { price: true, hours: true, duration: true, location: true },
  activity: { price: true, hours: true, duration: true, location: true },
  restaurant: { price: true, hours: true, duration: false, location: true },
  food: { price: true, hours: false, duration: false, location: false },
  accommodation: { price: true, hours: false, duration: false, location: true },
  transport: { price: true, hours: false, duration: true, location: false },
  practical_info: { price: false, hours: false, duration: false, location: false },
  note: { price: false, hours: false, duration: false, location: false },
};

function AddItemModal({ open, destinationId, sections, initialSectionId, onClose, onCreated }) {
  const [sectionId, setSectionId] = useState('');
  const [itemKind, setItemKind] = useState('note');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('');
  const [content, setContent] = useState('');
  const [price, setPrice] = useState(null);
  const [openingHours, setOpeningHours] = useState('');
  const [visitDuration, setVisitDuration] = useState('');
  const [areaLocation, setAreaLocation] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSectionId(initialSectionId === null ? '' : (initialSectionId || ''));
      setItemKind(initialSectionId === null ? 'note' : 'attraction');
      setTitle(''); setPriority(''); setContent(''); setPrice(null);
      setOpeningHours(''); setVisitDuration(''); setAreaLocation(''); setError('');
    }
  }, [open, initialSectionId]);

  const fields = KIND_FIELD_SETS[itemKind] || KIND_FIELD_SETS.note;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const data = await researchItemsApi.create({
        destinationId,
        sectionId: sectionId || null,
        itemKind,
        title,
        priority: priority || null,
        content: content || null,
        price: fields.price ? price : null,
        openingHours: fields.hours ? (openingHours || null) : null,
        visitDurationMinutes: fields.duration && visitDuration ? parseInt(visitDuration) : null,
        areaLocation: fields.location ? (areaLocation || null) : null,
      });
      onCreated(data.item);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={initialSectionId === null ? 'New General Note' : 'New Research Item'}>
      <form onSubmit={handleSubmit}>
        <Select label="Section" value={sectionId} onChange={e => setSectionId(e.target.value)}
          hint="Leave as 'General (whole destination)' for knowledge that isn't specific to one section.">
          <option value="">General (whole destination)</option>
          {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Select label="Type" value={itemKind} onChange={e => setItemKind(e.target.value)}>
          {ITEM_KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Input label="Title" required value={title} onChange={e => setTitle(e.target.value)} autoFocus />
        <Select label="Priority" value={priority} onChange={e => setPriority(e.target.value)}>
          <option value="">No priority set</option>
          <option value="must_know">Must Know</option>
          <option value="useful">Useful</option>
          <option value="optional">Optional</option>
          <option value="reference">Reference</option>
        </Select>
        {fields.price && <PriceField value={price} onChange={setPrice} />}
        {fields.hours && (
          <Input label="Opening hours" value={openingHours} onChange={e => setOpeningHours(e.target.value)} placeholder="e.g. 5:30 AM – 8:00 PM" />
        )}
        {fields.duration && (
          <Input label="Typical duration (minutes)" type="number" min="0" value={visitDuration} onChange={e => setVisitDuration(e.target.value)} />
        )}
        {fields.location && (
          <Input label="Area / location" value={areaLocation} onChange={e => setAreaLocation(e.target.value)} />
        )}
        <TextArea label="Details" value={content} onChange={e => setContent(e.target.value)} placeholder="Description, notes, anything useful…" rows={5} />
        {error && <p className="dest-detail__form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Creating…' : 'Create'}</Button>
      </form>
    </Modal>
  );
}

// Document/paste intake: pastes text, splits it into reviewable
// candidates (see db/extraction/index.js), and hands off to the review
// screen. Never writes a research_items row itself — see ItemReview.jsx.
function ImportTextModal({ open, destinationId, onClose, onImported }) {
  const [rawText, setRawText] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (open) { setRawText(''); setSourceLabel(''); setError(''); } }, [open]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await intakeApi.create({ destinationId, rawText, sourceLabel: sourceLabel || null });
      onImported(result.intake);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Import from pasted text">
      <form onSubmit={handleSubmit}>
        <Input
          label="Source (optional)"
          value={sourceLabel}
          onChange={e => setSourceLabel(e.target.value)}
          placeholder="e.g. Lonely Planet article, a friend's notes"
        />
        <TextArea
          label="Pasted text"
          required
          rows={10}
          value={rawText}
          onChange={e => setRawText(e.target.value)}
          placeholder="Paste travel notes, an article, or anything else describing this destination…"
          hint="This will be split into paragraphs for you to review and classify one by one — nothing is added to your research automatically."
          autoFocus
        />
        {error && <p className="dest-detail__form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Processing…' : 'Split into candidates'}</Button>
      </form>
    </Modal>
  );
}
