import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { researchItemsApi, destinationsApi } from '../api/research';
import Card from '../components/Card';
import Button from '../components/Button';
import Modal from '../components/Modal';
import { Input, TextArea, Select } from '../components/Field';
import { PriorityBadge, ItemKindBadge } from '../components/Badge';
import TagInput from '../components/TagInput';
import { LoadingState, ErrorState } from '../components/States';
import './ItemDetail.css';

const ITEM_KIND_OPTIONS = [
  { value: 'attraction', label: 'Attraction' },
  { value: 'hotel', label: 'Hotel' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'transport_option', label: 'Transport Option' },
  { value: 'practical_info', label: 'Practical Info' },
  { value: 'note', label: 'Research Note (general)' },
];

const TYPED_FIELDS = ['attraction', 'hotel', 'restaurant', 'transport_option', 'practical_info'];

export default function ItemDetail() {
  const { destinationId, itemId } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState(null);
  const [destination, setDestination] = useState(null);
  const [sections, setSections] = useState([]);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [showSourceModal, setShowSourceModal] = useState(false);
  const [showRelateModal, setShowRelateModal] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [itemData, destData] = await Promise.all([
        researchItemsApi.get(itemId),
        destinationsApi.get(destinationId),
      ]);
      setItem(itemData.item);
      setDestination(destData.destination);
      setSections(destData.sections);
    } catch (e) {
      setError(e.message);
    }
  }, [itemId, destinationId]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete() {
    if (!window.confirm('Remove this item from your research? It will be moved to trash rather than permanently deleted, and any trips that reference it will keep their own copy of the information.')) return;
    await researchItemsApi.remove(itemId);
    navigate(`/research/${destinationId}`);
  }

  async function handleAddTag(label) {
    await researchItemsApi.addTag(itemId, label);
    load();
  }

  async function handleRemoveTag(tagId) {
    await researchItemsApi.removeTag(itemId, tagId);
    load();
  }

  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!item || !destination) return <LoadingState label="Loading item…" />;

  const currentSection = sections.find(s => s.id === item.section_id);
  const isTyped = TYPED_FIELDS.includes(item.item_kind);

  return (
    <div className="item-detail">
      <div className="item-detail__breadcrumb">
        <Link to="/research">Research</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/research/${destinationId}`}>{destination.name}</Link>
        <span aria-hidden="true">/</span>
        <span>{currentSection ? currentSection.name : 'General'}</span>
      </div>

      {!editing ? (
        <ViewMode
          item={item}
          isTyped={isTyped}
          onEdit={() => setEditing(true)}
          onDelete={handleDelete}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onAddSource={() => setShowSourceModal(true)}
          onRelate={() => setShowRelateModal(true)}
          destinationId={destinationId}
        />
      ) : (
        <EditMode
          item={item}
          sections={sections}
          onCancel={() => setEditing(false)}
          onSaved={() => { setEditing(false); load(); }}
        />
      )}

      <AddSourceModal
        open={showSourceModal}
        itemId={itemId}
        onClose={() => setShowSourceModal(false)}
        onAdded={() => { setShowSourceModal(false); load(); }}
      />
      <RelateItemModal
        open={showRelateModal}
        itemId={itemId}
        destinationId={destinationId}
        currentRelatedIds={item.relatedItems.map(r => r.id)}
        onClose={() => setShowRelateModal(false)}
        onRelated={() => { setShowRelateModal(false); load(); }}
      />
    </div>
  );
}

function ViewMode({ item, isTyped, onEdit, onDelete, onAddTag, onRemoveTag, onAddSource, onRelate, destinationId }) {
  return (
    <>
      <header className="item-detail__header">
        <div className="item-detail__title-row">
          <ItemKindBadge kind={item.item_kind} />
          <PriorityBadge priority={item.priority} />
        </div>
        <h1>{item.title}</h1>
        <div className="item-detail__header-actions">
          <Button variant="secondary" size="sm" onClick={onEdit}>Edit</Button>
          <Button variant="danger" size="sm" onClick={onDelete}>Remove</Button>
        </div>
      </header>

      {isTyped && (item.entry_fee || item.opening_hours || item.visit_duration_minutes || item.price_range || item.area_location) && (
        <Card className="item-detail__facts" padding="md">
          <div className="item-detail__facts-grid">
            {item.entry_fee && <Fact label="Entry fee" value={item.entry_fee} />}
            {item.opening_hours && <Fact label="Opening hours" value={item.opening_hours} />}
            {item.visit_duration_minutes && <Fact label="Visit duration" value={`${item.visit_duration_minutes} min`} />}
            {item.price_range && <Fact label="Price range" value={item.price_range} />}
            {item.area_location && <Fact label="Area / location" value={item.area_location} />}
          </div>
          {item.last_verified_at && (
            <p className="item-detail__verified">Last verified {new Date(item.last_verified_at).toLocaleDateString()}</p>
          )}
        </Card>
      )}

      {item.maps_url && (
        <a href={item.maps_url} target="_blank" rel="noopener noreferrer" className="item-detail__maps-link">
          Open in Google Maps ↗
        </a>
      )}

      {item.content && (
        <section className="item-detail__section">
          <h2>Details</h2>
          <p className="item-detail__content">{item.content}</p>
        </section>
      )}

      <section className="item-detail__section">
        <h2>Tags</h2>
        <TagInput tags={item.tags} onAdd={onAddTag} onRemove={onRemoveTag} />
      </section>

      <section className="item-detail__section">
        <div className="item-detail__section-header">
          <h2>Sources</h2>
          <Button variant="ghost" size="sm" onClick={onAddSource}>+ Add source</Button>
        </div>
        {item.sources.length === 0 ? (
          <p className="item-detail__empty-hint">No sources recorded yet.</p>
        ) : (
          <div className="item-detail__source-list">
            {item.sources.map(source => (
              <div key={source.id} className="source-row">
                <div className="source-row__main">
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="source-row__title">
                    {source.title || source.url}
                  </a>
                  <div className="source-row__meta">
                    {source.source_type && <span className="source-row__type">{source.source_type}</span>}
                    {source.supports_note && <span> · supports: {source.supports_note}</span>}
                    {source.accessed_at && <span> · verified {new Date(source.accessed_at).toLocaleDateString()}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="item-detail__section">
        <div className="item-detail__section-header">
          <h2>Related items</h2>
          <Button variant="ghost" size="sm" onClick={onRelate}>+ Relate item</Button>
        </div>
        {item.relatedItems.length === 0 ? (
          <p className="item-detail__empty-hint">No related items yet.</p>
        ) : (
          <div className="item-detail__related-list">
            {item.relatedItems.map(related => (
              <Link key={related.id} to={`/research/${destinationId}/items/${related.id}`} className="related-chip">
                {related.title}
                <ItemKindBadge kind={related.item_kind} />
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Fact({ label, value }) {
  return (
    <div className="item-detail__fact">
      <span className="item-detail__fact-label">{label}</span>
      <span className="item-detail__fact-value">{value}</span>
    </div>
  );
}

function EditMode({ item, sections, onCancel, onSaved }) {
  const [sectionId, setSectionId] = useState(item.section_id || '');
  const [itemKind, setItemKind] = useState(item.item_kind);
  const [title, setTitle] = useState(item.title);
  const [priority, setPriority] = useState(item.priority || '');
  const [content, setContent] = useState(item.content || '');
  const [entryFee, setEntryFee] = useState(item.entry_fee || '');
  const [openingHours, setOpeningHours] = useState(item.opening_hours || '');
  const [visitDuration, setVisitDuration] = useState(item.visit_duration_minutes || '');
  const [priceRange, setPriceRange] = useState(item.price_range || '');
  const [areaLocation, setAreaLocation] = useState(item.area_location || '');
  const [mapsUrl, setMapsUrl] = useState(item.maps_url || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isTyped = TYPED_FIELDS.includes(itemKind);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await researchItemsApi.update(item.id, {
        sectionId: sectionId || null,
        itemKind,
        title,
        priority: priority || null,
        content: content || null,
        entryFee: isTyped ? (entryFee || null) : null,
        openingHours: isTyped ? (openingHours || null) : null,
        visitDurationMinutes: isTyped && visitDuration ? parseInt(visitDuration) : null,
        priceRange: isTyped ? (priceRange || null) : null,
        areaLocation: isTyped ? (areaLocation || null) : null,
        mapsUrl: mapsUrl || null,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="item-detail__edit-form">
      <h1>Edit item</h1>
      <Select label="Section" value={sectionId} onChange={e => setSectionId(e.target.value)}
        hint="Choose 'General' to make this a destination-level note.">
        <option value="">General (whole destination)</option>
        {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
      <Select label="Type" value={itemKind} onChange={e => setItemKind(e.target.value)}>
        {ITEM_KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
      <Input label="Title" required value={title} onChange={e => setTitle(e.target.value)} />
      <Select label="Priority" value={priority} onChange={e => setPriority(e.target.value)}>
        <option value="">No priority set</option>
        <option value="must_know">Must Know</option>
        <option value="useful">Useful</option>
        <option value="optional">Optional</option>
        <option value="reference">Reference</option>
      </Select>
      {isTyped && (
        <>
          <Input label="Entry fee" value={entryFee} onChange={e => setEntryFee(e.target.value)} />
          <Input label="Opening hours" value={openingHours} onChange={e => setOpeningHours(e.target.value)} />
          <Input label="Visit duration (minutes)" type="number" min="0" value={visitDuration} onChange={e => setVisitDuration(e.target.value)} />
          <Input label="Price range" value={priceRange} onChange={e => setPriceRange(e.target.value)} />
          <Input label="Area / location" value={areaLocation} onChange={e => setAreaLocation(e.target.value)} />
        </>
      )}
      <Input label="Google Maps URL" value={mapsUrl} onChange={e => setMapsUrl(e.target.value)} placeholder="https://maps.google.com/…" />
      <TextArea label="Details" value={content} onChange={e => setContent(e.target.value)} rows={6} />
      {error && <p className="item-detail__form-error" role="alert">{error}</p>}
      <div className="item-detail__edit-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save changes'}</Button>
      </div>
    </form>
  );
}

function AddSourceModal({ open, itemId, onClose, onAdded }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [sourceType, setSourceType] = useState('website');
  const [supportsNote, setSupportsNote] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) { setUrl(''); setTitle(''); setSourceType('website'); setSupportsNote(''); setError(''); }
  }, [open]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await researchItemsApi.addSource(itemId, {
        url, title: title || null, sourceType, supportsNote: supportsNote || null,
        accessedAt: new Date().toISOString(),
      });
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Source">
      <form onSubmit={handleSubmit}>
        <Input label="URL" required type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" autoFocus />
        <Input label="Title" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Lonely Planet guide" />
        <Select label="Source type" value={sourceType} onChange={e => setSourceType(e.target.value)}>
          <option value="website">Website</option>
          <option value="youtube">YouTube</option>
          <option value="other">Other</option>
        </Select>
        <Input label="What this supports" value={supportsNote} onChange={e => setSupportsNote(e.target.value)} placeholder="e.g. Entry fee and opening hours" />
        {error && <p className="item-detail__form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Adding…' : 'Add Source'}</Button>
      </form>
    </Modal>
  );
}

function RelateItemModal({ open, itemId, destinationId, currentRelatedIds, onClose, onRelated }) {
  const [candidates, setCandidates] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    destinationsApi.get(destinationId).then(data => {
      setCandidates(data.items.filter(i => i.id !== itemId && !currentRelatedIds.includes(i.id)));
    });
  }, [open, destinationId, itemId, currentRelatedIds]);

  async function handleRelate(relatedItemId) {
    setError('');
    try {
      await researchItemsApi.addRelation(itemId, relatedItemId);
      onRelated();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Relate Item">
      {error && <p className="item-detail__form-error" role="alert">{error}</p>}
      {candidates.length === 0 ? (
        <p className="item-detail__empty-hint">No other items available to relate.</p>
      ) : (
        <div className="item-detail__candidate-list">
          {candidates.map(c => (
            <button key={c.id} type="button" className="item-detail__candidate" onClick={() => handleRelate(c.id)}>
              <span>{c.title}</span>
              <ItemKindBadge kind={c.item_kind} />
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
