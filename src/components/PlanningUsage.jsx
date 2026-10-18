import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadPlanningReferenceData, deriveResearchReferences, REFERENCE_REASON_LABELS } from '../lib/researchReferences';
import './ResearchSummary.css';

// Research ↔ Planning integration (Tour Planning, Phase 3, Feature C).
// A compact "Used in Plannings" panel for one Research entry, shown
// inside that entry's edit modal on its section page. Derived live
// from the existing Planning stores (see lib/researchReferences.js) —
// nothing is stored for it, and it is deliberately NOT cached across
// opens, so it can never show a Planning that has since dropped the
// item (or miss one that just added it).
//
// "In itinerary" = part of that Planning's current itinerary.
// "Referenced only" = the Planning points at this entry but not in its
// current itinerary (inside an unselected Option, or as a non-selected
// alternative) — the two are never conflated.
export default function PlanningUsage({ destinationId, researchRefType, researchRefId }) {
  // The loaded data is stored together with the destination it was
  // loaded for, so "still loading" is simply "nothing loaded for the
  // current destination yet" — derived during render, with no state
  // reset needed when the destination changes.
  const [loaded, setLoaded] = useState({ destinationId: null, planningData: null, failed: false });

  useEffect(() => {
    let cancelled = false;
    loadPlanningReferenceData(destinationId)
      .then(planningData => { if (!cancelled) setLoaded({ destinationId, planningData, failed: false }); })
      .catch(() => { if (!cancelled) setLoaded({ destinationId, planningData: null, failed: true }); });
    return () => { cancelled = true; };
  }, [destinationId]);

  const isCurrent = loaded.destinationId === destinationId;
  const planningData = isCurrent ? loaded.planningData : null;
  const failed = isCurrent && loaded.failed;

  const references = useMemo(
    () => (planningData ? deriveResearchReferences({ researchRefType, researchRefId, planningData }) : []),
    [planningData, researchRefType, researchRefId],
  );

  let body;
  if (failed) body = <p className="planning-usage__empty">Couldn't check Planning usage right now.</p>;
  else if (!planningData) body = <p className="planning-usage__empty">Checking Plannings…</p>;
  else if (references.length === 0) body = <p className="planning-usage__empty">Not used in any Planning yet.</p>;
  else {
    body = (
      <ul className="planning-usage__list">
        {references.map(({ planning, status, reasons }) => (
          <li key={planning.id} className="planning-usage__row">
            <div className="planning-usage__line">
              <Link to={`/plannings/${planning.id}`} className="planning-usage__link">{planning.name}</Link>
              <span className={`planning-usage__status planning-usage__status--${status}`}>
                {status === 'included' ? 'In itinerary' : 'Referenced only'}
              </span>
            </div>
            {status === 'referenced' && reasons.length > 0 && (
              <span className="planning-usage__detail">
                Not in the current itinerary — {reasons.map(r => REFERENCE_REASON_LABELS[r]).join('; ')}
              </span>
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="planning-usage" aria-label="Used in Plannings">
      <h3 className="planning-usage__title">
        Used in Plannings{planningData && references.length > 0 ? ` (${references.length})` : ''}
      </h3>
      {body}
    </section>
  );
}
