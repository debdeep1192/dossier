import './Badge.css';

const PRIORITY_LABELS = {
  must_know: 'Must Know',
  useful: 'Useful',
  optional: 'Optional',
  reference: 'Reference',
};

const ITEM_KIND_LABELS = {
  attraction: 'Attraction',
  activity: 'Activity',
  restaurant: 'Restaurant',
  food: 'Food',
  accommodation: 'Accommodation',
  transport: 'Transport',
  practical_info: 'Practical Info',
  note: 'Note',
};

export function PriorityBadge({ priority }) {
  if (!priority) return null;
  return (
    <span className={`badge badge--priority-${priority}`}>
      {PRIORITY_LABELS[priority] || priority}
    </span>
  );
}

export function ItemKindBadge({ kind }) {
  if (!kind) return null;
  return (
    <span className="badge badge--kind">
      {ITEM_KIND_LABELS[kind] || kind}
    </span>
  );
}

export function Tag({ label, onRemove }) {
  return (
    <span className="badge badge--tag">
      {label}
      {onRemove && (
        <button type="button" className="badge__remove" onClick={onRemove} aria-label={`Remove tag ${label}`}>
          ×
        </button>
      )}
    </span>
  );
}

export { PRIORITY_LABELS, ITEM_KIND_LABELS };
