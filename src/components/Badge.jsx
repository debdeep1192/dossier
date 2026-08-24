import './Badge.css';

const PRIORITY_LABELS = {
  must_know: 'Must Know',
  useful: 'Useful',
  optional: 'Optional',
  reference: 'Reference',
};

export function PriorityBadge({ priority }) {
  if (!priority) return null;
  return (
    <span className={`badge badge--priority-${priority}`}>
      {PRIORITY_LABELS[priority] || priority}
    </span>
  );
}

export function SectionBadge({ label }) {
  if (!label) return null;
  return <span className="badge badge--section">{label}</span>;
}

export function ProvenanceBadge({ provenance }) {
  if (provenance !== 'imported') return null;
  return <span className="badge badge--imported">Imported</span>;
}

export { PRIORITY_LABELS };
