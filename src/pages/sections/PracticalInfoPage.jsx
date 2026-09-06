import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getDestination } from '../../db/stores/destinations';
import { listPracticalInfoEntries, createPracticalInfoEntry, updatePracticalInfoEntry, deletePracticalInfoEntry, emptyPracticalInfoEntry } from '../../db/stores/practicalInfo';
import { useCachedQuery, invalidateCachedQuery, invalidateCachedQueryPrefix } from '../../hooks/useCachedQuery';
import SectionPageLayout from '../../components/SectionPageLayout';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { Input, TextArea } from '../../components/Field';
import { EmptyState, LoadingState, ErrorState } from '../../components/States';
import { PRACTICAL_INFO_TOPICS } from '../../lib/practicalInfoOptions.js';
import Disclosure from '../../components/Disclosure';
import { hasAdvancedContent } from '../../lib/formHelpers.js';
import OtherSelect from '../../components/OtherSelect';

export default function PracticalInfoPage() {
  const { destinationId } = useParams();
  const [editing, setEditing] = useState(null);

  const fetcher = useCallback(async () => {
    const [destination, items] = await Promise.all([getDestination(destinationId), listPracticalInfoEntries(destinationId)]);
    return { destination, items };
  }, [destinationId]);
  const { data, error, loading, refresh } = useCachedQuery(`practicalInfo:${destinationId}`, fetcher);

  function afterMutation() {
    invalidateCachedQuery(`practicalInfo:${destinationId}`);
    invalidateCachedQueryPrefix(`destination:${destinationId}`);
    refresh();
  }

  async function handleDelete(item) {
    if (!window.confirm(`Delete "${item.topic}${item.name ? ` — ${item.name}` : ''}"?`)) return;
    await deletePracticalInfoEntry(item.id);
    afterMutation();
  }

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading practical info…" />;

  const { destination, items } = data;

  return (
    <SectionPageLayout destination={destination} destinationId={destinationId} title="Practical Info" onAdd={() => setEditing({})}>
      {items.length === 0 ? (
        <EmptyState icon="🛂" title="No practical info yet" description="Visas, connectivity, safety, local customs — anything practical." actionLabel="+ Add" onAction={() => setEditing({})} />
      ) : (
        items.map(item => (
          <Card key={item.id} interactive padding="sm" accentColor="var(--color-teal-dark)" className="entry-card" onClick={() => setEditing(item)}>
            <div className="entry-card__main">
              <span className="entry-card__title">{item.topic === 'Other' ? (item.topicOther || 'Other') : item.topic}{item.name ? ` — ${item.name}` : ''}</span>
              {item.phone && <p className="entry-card__meta">📞 {item.phone}</p>}
              {item.location && <p className="entry-card__meta">{item.location}</p>}
              {item.details && <p className="entry-card__meta">{item.details}</p>}
            </div>
            <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); handleDelete(item); }}>Delete</button>
          </Card>
        ))
      )}

      {editing !== null && (
        <PracticalInfoForm destinationId={destinationId} record={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); afterMutation(); }} />
      )}
    </SectionPageLayout>
  );
}

function PracticalInfoForm({ destinationId, record, onClose, onSaved }) {
  const base = record || emptyPracticalInfoEntry();
  const [topic, setTopic] = useState(base.topic || '');
  const [topicOther, setTopicOther] = useState(base.topicOther || '');
  const [name, setName] = useState(base.name || '');
  const [location, setLocation] = useState(base.location || '');
  const [address, setAddress] = useState(base.address || '');
  const [phone, setPhone] = useState(base.phone || '');
  const [email, setEmail] = useState(base.email || '');
  const [website, setWebsite] = useState(base.website || '');
  const [googleMapsUrl, setGoogleMapsUrl] = useState(base.googleMapsUrl || '');
  const [details, setDetails] = useState(base.details || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const advancedHasContent = hasAdvancedContent(base.name, base.phone, base.email, base.website, base.address, base.googleMapsUrl);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!topic) { setError('Choose a topic.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fields = { topic, topicOther: topic === 'Other' ? topicOther : '', name, location, address, phone, email, website, googleMapsUrl, details };
      if (record) await updatePracticalInfoEntry(record.id, fields);
      else await createPracticalInfoEntry(destinationId, fields);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={record ? 'Edit Practical Info' : 'New Practical Info'}>
      <form onSubmit={handleSubmit}>
        <OtherSelect label="Topic" value={topic} otherValue={topicOther} onChange={setTopic} onOtherChange={setTopicOther} options={PRACTICAL_INFO_TOPICS} />

        <TextArea label="Details / Notes" value={details} onChange={e => setDetails(e.target.value)} rows={4} placeholder="e.g. Airtel works reasonably well in central Darjeeling…" />

        <Disclosure label="Add a specific contact (name, phone, address…)" defaultOpen={advancedHasContent}>
          <Input label="Name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Darjeeling Police" />
          <Input label="Location" value={location} onChange={e => setLocation(e.target.value)} />
          <Input label="Address" value={address} onChange={e => setAddress(e.target.value)} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
            <Input label="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
            <Input label="Email" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <Input label="Website" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://…" />
          <Input label="Google Maps link" value={googleMapsUrl} onChange={e => setGoogleMapsUrl(e.target.value)} placeholder="https://…" />
        </Disclosure>

        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}
