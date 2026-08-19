import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { destinationsApi, sectionsApi, researchItemsApi } from '../api/research';
import Card from '../components/Card';
import Button from '../components/Button';
import Modal from '../components/Modal';
import { Input, TextArea, Select } from '../components/Field';
import { PriorityBadge, ItemKindBadge } from '../components/Badge';
import { LoadingState, ErrorState, EmptyState } from '../components/States';
import './DestinationDetail.css';

const ITEM_KIND_OPTIONS = [
  { value: 'attraction', label: 'Attraction' },
  { value: 'hotel', label: 'Hotel' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'transport_option', label: 'Transport Option' },
  { value: 'practical_info', label: 'Practical Info' },
  { value: 'note', label: 'Research Note (general)' },
];

const KIND_ACCENT = {
  attraction: 'var(--color-teal)',
  hotel: 'var(--color-saffron-dark)',
  restaurant: 'var(--color-coral)',
  transport_option: 'var(--color-neutral-500)',
  practical_info: 'var(--color-teal-dark)',
  note: 'var(--color-neutral-400)',
};

export default function DestinationDetail() {
  const { destinationId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filterQuery, setFilterQuery] = useState('');

  const [showAddSection, setShowAddSection] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [addItemSectionId, setAddItemSectionId] = useState(undefined); // undefined = destination-level

  const sectionRefs = useRef({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await destinationsApi.get(destinationId);
      setData(result);
    } catch (e) {
      setError(e.message);
    }
  }, [destinationId]);

  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState description={error} onRetry={load} />;
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
      </div>

      {sections.length === 0 && destinationLevelNotes.length === 0 && (
        <EmptyState
          icon="📖"
          title="This destination is empty"
          description="Add a section (like Attractions or Hotels) to start organizing your research, or add a general note first."
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
        onCreated={() => { setShowAddSection(false); load(); }}
      />
      <AddItemModal
        open={showAddItem}
        destinationId={destinationId}
        sections={sections}
        initialSectionId={addItemSectionId}
        onClose={() => setShowAddItem(false)}
        onCreated={(item) => { setShowAddItem(false); navigate(`/research/${destinationId}/items/${item.id}`); }}
      />
    </div>
  );
}

function ItemRow({ item, onClick }) {
  return (
    <Card interactive padding="sm" accentColor={KIND_ACCENT[item.item_kind]} onClick={onClick} className="item-row">
      <div className="item-row__main">
        <div className="item-row__title-line">
          <span className="item-row__title">{item.title}</span>
          <ItemKindBadge kind={item.item_kind} />
        </div>
        {item.content && <p className="item-row__snippet">{item.content}</p>}
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
          placeholder="e.g. Attractions, Hotels, Food to Try"
          hint="Sections are fully customisable — use whatever structure fits this destination."
          autoFocus
        />
        {error && <p className="dest-detail__form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Creating…' : 'Create Section'}</Button>
      </form>
    </Modal>
  );
}

function AddItemModal({ open, destinationId, sections, initialSectionId, onClose, onCreated }) {
  const [sectionId, setSectionId] = useState('');
  const [itemKind, setItemKind] = useState('note');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('');
  const [content, setContent] = useState('');
  const [entryFee, setEntryFee] = useState('');
  const [openingHours, setOpeningHours] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSectionId(initialSectionId === null ? '' : (initialSectionId || ''));
      setItemKind(initialSectionId === null ? 'note' : 'attraction');
      setTitle(''); setPriority(''); setContent(''); setEntryFee(''); setOpeningHours(''); setError('');
    }
  }, [open, initialSectionId]);

  const isTypedItem = itemKind !== 'note';

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
        entryFee: isTypedItem ? (entryFee || null) : null,
        openingHours: isTypedItem ? (openingHours || null) : null,
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
        {isTypedItem && (
          <>
            <Input label="Entry fee" value={entryFee} onChange={e => setEntryFee(e.target.value)} placeholder="e.g. LKR 1500" />
            <Input label="Opening hours" value={openingHours} onChange={e => setOpeningHours(e.target.value)} placeholder="e.g. 5:30 AM – 8:00 PM" />
          </>
        )}
        <TextArea label="Details" value={content} onChange={e => setContent(e.target.value)} placeholder="Description, notes, anything useful…" rows={5} />
        {error && <p className="dest-detail__form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Creating…' : 'Create'}</Button>
      </form>
    </Modal>
  );
}
