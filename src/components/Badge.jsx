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

const VISIT_PRIORITY_LABELS = {
  must_see: 'Must see',
  maybe: 'Maybe',
  skippable: 'Skippable',
};

export function VisitPriorityBadge({ visitPriority }) {
  if (!visitPriority) return null;
  return (
    <span className={`badge badge--visit-priority-${visitPriority}`}>
      {VISIT_PRIORITY_LABELS[visitPriority] || visitPriority}
    </span>
  );
}

const PRICE_TIER_LABELS = {
  budget: 'Budget-friendly',
  regular: 'Regular',
  fine_dining: 'Fine dining',
};

export function PriceTierBadge({ priceTier }) {
  if (!priceTier) return null;
  return (
    <span className={`badge badge--price-tier-${priceTier}`}>
      {PRICE_TIER_LABELS[priceTier] || priceTier}
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

export { PRIORITY_LABELS, VISIT_PRIORITY_LABELS, PRICE_TIER_LABELS };
