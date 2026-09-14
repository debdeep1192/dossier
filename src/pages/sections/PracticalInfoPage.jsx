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
import { PRACTICAL_INFO_TOPICS, PRACTICAL_INFO_TOPIC_ICONS } from '../../lib/practicalInfoOptions.js';
import Disclosure from '../../components/Disclosure';
import { hasAdvancedContent } from '../../lib/formHelpers.js';
import OtherSelect from '../../components/OtherSelect';
import './PracticalInfoPage.css';

// The label actually shown/used for a given entry — a custom topic
// (topic === 'Other') displays its own typed-in name (topicOther)
// rather than the literal word "Other", exactly as the entry cards
// already did before this chunk.
function effectiveTopicLabel(entry) {
  return entry.topic === 'Other' ? (entry.topicOther || 'Other') : entry.topic;
}

export default function PracticalInfoPage() {
  const { destinationId } = useParams();
  const [openTopic, setOpenTopic] = useState(null); // the topic name currently being viewed/added to, or null for the grid view
  const [editing, setEditing] = useState(null); // the entry being edited/created within openTopic, or undefined for none

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
    if (!window.confirm(`Delete "${effectiveTopicLabel(item)}${item.name ? ` — ${item.name}` : ''}"?`)) return;
    await deletePracticalInfoEntry(item.id);
    afterMutation();
  }

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading practical info…" />;

  const { destination, items } = data;

  // Group entries by their effective (displayed) topic label — this is
  // what makes custom "Other" topics appear naturally alongside the
  // predefined ones: a custom topic that already has entries becomes
  // its own tile in the grid, using whatever name the person gave it.
  const entriesByTopic = {};
  for (const item of items) {
    const label = effectiveTopicLabel(item);
    (entriesByTopic[label] = entriesByTopic[label] || []).push(item);
  }
  const customTopicLabels = Object.keys(entriesByTopic).filter(label => !PRACTICAL_INFO_TOPICS.includes(label) && label !== 'Other');
  // "Other" itself (the generic predefined tile, used to ADD a new
  // custom topic) plus every already-used custom topic name, each
  // shown as their own tile once they have at least one entry.
  const gridTopics = [...PRACTICAL_INFO_TOPICS.filter(t => t !== 'Other'), ...customTopicLabels.sort(), 'Other'];

  if (openTopic) {
    const topicEntries = entriesByTopic[openTopic] || [];
    const isCustomTopicName = !PRACTICAL_INFO_TOPICS.includes(openTopic);
    return (
      <SectionPageLayout destination={destination} destinationId={destinationId} title={`Practical Info — ${openTopic}`} onAdd={() => setEditing({})}>
        <Button variant="ghost" size="sm" onClick={() => setOpenTopic(null)} style={{ marginBottom: 'var(--space-3)' }}>← All topics</Button>
        {topicEntries.length === 0 ? (
          <EmptyState icon={PRACTICAL_INFO_TOPIC_ICONS[openTopic] || '🛂'} title={`No ${openTopic} info yet`} description="Add what's useful to remember." actionLabel="+ Add" onAction={() => setEditing({})} />
        ) : (
          topicEntries.map(item => (
            <Card key={item.id} interactive padding="sm" accentColor="var(--color-teal-dark)" className="entry-card" onClick={() => setEditing(item)}>
              <div className="entry-card__main">
                {item.name && <span className="entry-card__title">{item.name}</span>}
                {item.phone && <p className="entry-card__meta">📞 {item.phone}</p>}
                {item.location && <p className="entry-card__meta">{item.location}</p>}
                {item.details && <p className="entry-card__meta">{item.details}</p>}
              </div>
              <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); handleDelete(item); }}>Delete</button>
            </Card>
          ))
        )}

        {editing !== null && (
          <PracticalInfoForm
            destinationId={destinationId}
            record={editing.id ? editing : null}
            fixedTopic={isCustomTopicName ? 'Other' : openTopic}
            fixedTopicOther={isCustomTopicName ? openTopic : ''}
            onClose={() => setEditing(null)}
            onSaved={(savedTopicLabel) => { setEditing(null); afterMutation(); if (savedTopicLabel) setOpenTopic(savedTopicLabel); }}
          />
        )}
      </SectionPageLayout>
    );
  }

  return (
    <SectionPageLayout destination={destination} destinationId={destinationId} title="Practical Info">
      <div className="practical-info__grid">
        {gridTopics.map(topic => {
          const count = (entriesByTopic[topic] || []).length;
          const isAddCustom = topic === 'Other';
          return (
            <Card key={topic} interactive padding="sm" className="practical-info__tile" onClick={() => setOpenTopic(topic)}>
              <span className="practical-info__tile-icon" aria-hidden="true">{PRACTICAL_INFO_TOPIC_ICONS[topic] || '🛂'}</span>
              <span className="practical-info__tile-label">{isAddCustom ? 'Other topic' : topic}</span>
              {count > 0 && <span className="practical-info__tile-count">{count}</span>}
            </Card>
          );
        })}
      </div>
    </SectionPageLayout>
  );
}

function PracticalInfoForm({ destinationId, record, fixedTopic, fixedTopicOther, onClose, onSaved }) {
  const base = record || emptyPracticalInfoEntry();
  const [topic, setTopic] = useState(record ? base.topic : fixedTopic);
  const [customTopicName, setCustomTopicName] = useState(base.topic === 'Other' ? (base.topicOther || fixedTopicOther) : fixedTopicOther);
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

  const isCustomTopic = topic === 'Other';

  const advancedHasContent = hasAdvancedContent(base.name, base.phone, base.email, base.website, base.address, base.googleMapsUrl);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!topic) { setError('Choose a topic.'); return; }
    if (isCustomTopic && !customTopicName.trim()) { setError('Give this custom topic a name.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fields = { topic, topicOther: isCustomTopic ? customTopicName.trim() : '', name, location, address, phone, email, website, googleMapsUrl, details };
      if (record) await updatePracticalInfoEntry(record.id, fields);
      else await createPracticalInfoEntry(destinationId, fields);
      onSaved(isCustomTopic ? customTopicName.trim() : topic);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={record ? 'Edit Practical Info' : `New — ${isCustomTopic ? (customTopicName || 'Other topic') : topic}`}>
      <form onSubmit={handleSubmit}>
        {record ? (
          // Editing an existing entry: the topic was already chosen by
          // tapping into it from the grid, but the person can still
          // reassign it to a different topic here if they change their
          // mind — this is the one place OtherSelect's dropdown still
          // appears, since "which topic" is a genuine edit, not
          // something the grid tap already decided for a brand-new entry.
          <OtherSelect label="Topic" value={topic} otherValue={customTopicName} onChange={setTopic} onOtherChange={setCustomTopicName} options={PRACTICAL_INFO_TOPICS} />
        ) : (
          isCustomTopic && (
            <Input label="Topic name" required autoFocus={!customTopicName} value={customTopicName} onChange={e => setCustomTopicName(e.target.value)} placeholder="e.g. Local Festivals" />
          )
        )}

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
