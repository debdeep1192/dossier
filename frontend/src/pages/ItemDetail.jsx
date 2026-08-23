import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { researchItemsApi } from '../api/research';
import { useCachedQuery, invalidateCachedQuery, invalidateCachedQueryPrefix } from '../hooks/useCachedQuery';
import Card from '../components/Card';
import Button from '../components/Button';
import { Input, TextArea, Select } from '../components/Field';
import { PriorityBadge, ItemKindBadge } from '../components/Badge';
import { PriceField, PriceDisplay } from '../components/Price';
import { LoadingState, ErrorState } from '../components/States';
import './ItemDetail.css';

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

// Same anti-generic-form field set used in DestinationDetail's Add Item
// modal — kept as one shared source of truth would be ideal, but since
// this determines both create AND edit-time field visibility and the
// two screens have slightly different form flows, duplicating this
// small lookup table is a smaller and safer footprint than
// cross-importing UI internals between the two page files.
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

export default function ItemDetail() {
  const { destinationId, itemId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [editing, setEditing] = useState(() => Boolean(location.state?.openEditing));

  const fetcher = useCallback(() => researchItemsApi.get(itemId), [itemId]);
  const { data, error, refresh } = useCachedQuery(`item:${itemId}`, fetcher);

  // Reset edit-mode intent when navigating to a genuinely different item
  // (e.g. via a related-item link), so a stale "openEditing" from a
  // previous navigation doesn't leak into an unrelated item.
  useEffect(() => { setEditing(Boolean(location.state?.openEditing)); }, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  function afterMutation() {
    invalidateCachedQuery(`item:${itemId}`);
    invalidateCachedQuery(`destination:${destinationId}`);
    invalidateCachedQueryPrefix('research-home');
    refresh();
  }

  async function handleDelete() {
    if (!window.confirm('Remove this item from your research? It will be moved to trash rather than permanently deleted.')) return;
    await researchItemsApi.remove(itemId);
    invalidateCachedQuery(`destination:${destinationId}`);
    invalidateCachedQueryPrefix('research-home');
    navigate(`/research/${destinationId}`);
  }

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (!data) return <LoadingState label="Loading item…" />;

  const item = data;

  return (
    <div className="item-detail">
      <div className="item-detail__breadcrumb">
        <Link to="/research">Research</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/research/${destinationId}`}>Destination</Link>
        <span aria-hidden="true">/</span>
        <span>{item.title}</span>
      </div>

      {editing ? (
        <EditForm item={item} onSaved={() => { afterMutation(); setEditing(false); }} onCancel={() => setEditing(false)} />
      ) : (
        <ViewMode item={item} onEdit={() => setEditing(true)} onDelete={handleDelete} />
      )}
    </div>
  );
}

function ViewMode({ item, onEdit, onDelete }) {
  const fields = KIND_FIELD_SETS[item.item_kind] || KIND_FIELD_SETS.note;
  return (
    <>
      <header className="item-detail__header">
        <div className="item-detail__title-line">
          <h1>{item.title}</h1>
          <ItemKindBadge kind={item.item_kind} />
        </div>
        <div className="item-detail__meta-line">
          {item.priority && <PriorityBadge priority={item.priority} />}
        </div>
      </header>

      <div className="item-detail__actions">
        <Button variant="secondary" size="sm" onClick={onEdit}>Edit</Button>
        <Button variant="ghost" size="sm" onClick={onDelete}>Delete</Button>
      </div>

      <Card className="item-detail__facts">
        {fields.price && item.price && <Fact label="Price"><PriceDisplay price={item.price} /></Fact>}
        {fields.hours && item.opening_hours && <Fact label="Opening hours" value={item.opening_hours} />}
        {fields.duration && item.visit_duration_minutes && <Fact label="Typical duration" value={`${item.visit_duration_minutes} min`} />}
        {fields.location && item.area_location && <Fact label="Area / location" value={item.area_location} />}
        {item.maps_url && (
          <Fact label="Maps">
            <a href={item.maps_url} target="_blank" rel="noreferrer">Open in Maps</a>
          </Fact>
        )}
      </Card>

      {item.content && (
        <Card className="item-detail__content">
          <p>{item.content}</p>
        </Card>
      )}

      {item.sources && item.sources.length > 0 && (
        <section className="item-detail__sources">
          <h2>Sources</h2>
          {item.sources.map(s => (
            <div key={s.id} className="item-detail__source-row">
              <a href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a>
              {s.source_type && <span className="item-detail__source-type">{s.source_type}</span>}
            </div>
          ))}
        </section>
      )}

      {item.relatedItems && item.relatedItems.length > 0 && (
        <section className="item-detail__related">
          <h2>Related</h2>
          {item.relatedItems.map(r => (
            <Link key={r.id} to={`/research/${r.destination_id}/items/${r.id}`} className="item-detail__related-link">
              {r.title}
            </Link>
          ))}
        </section>
      )}
    </>
  );
}

function Fact({ label, value, children }) {
  return (
    <div className="item-detail__fact">
      <span className="item-detail__fact-label">{label}</span>
      <span className="item-detail__fact-value">{children ?? value}</span>
    </div>
  );
}

function EditForm({ item, onSaved, onCancel }) {
  const [itemKind, setItemKind] = useState(item.item_kind);
  const [title, setTitle] = useState(item.title);
  const [priority, setPriority] = useState(item.priority || '');
  const [content, setContent] = useState(item.content || '');
  const [price, setPrice] = useState(item.price || null);
  const [openingHours, setOpeningHours] = useState(item.opening_hours || '');
  const [visitDuration, setVisitDuration] = useState(item.visit_duration_minutes || '');
  const [areaLocation, setAreaLocation] = useState(item.area_location || '');
  const [mapsUrl, setMapsUrl] = useState(item.maps_url || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fields = KIND_FIELD_SETS[itemKind] || KIND_FIELD_SETS.note;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await researchItemsApi.update(item.id, {
        itemKind,
        title,
        priority: priority || null,
        content: content || null,
        price: fields.price ? price : null,
        openingHours: fields.hours ? (openingHours || null) : null,
        visitDurationMinutes: fields.duration && visitDuration ? parseInt(visitDuration) : null,
        areaLocation: fields.location ? (areaLocation || null) : null,
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
      <Input label="Google Maps URL" value={mapsUrl} onChange={e => setMapsUrl(e.target.value)} placeholder="https://maps.google.com/…" />
      <TextArea label="Details" value={content} onChange={e => setContent(e.target.value)} rows={6} />
      {error && <p className="item-detail__form-error" role="alert">{error}</p>}
      <div className="item-detail__form-actions">
        <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save changes'}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
