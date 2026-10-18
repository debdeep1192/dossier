import { createContext, useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import Modal from './Modal';
import Button from './Button';
import { VisitPriorityBadge, PriceTierBadge, SectionBadge } from './Badge';
import { buildResearchSummary } from '../lib/researchSummary';
import { buildResearchEntryPath } from '../lib/researchNavigation';
import './Place.css';
import './ResearchSummary.css';

// Research ↔ Planning integration (Tour Planning, Phase 3, Feature A).
//
// A compact, read-only popup of the essentials of ONE Research record,
// opened from a Planning item without leaving the Planning page — the
// Planning item stays exactly as it was (nothing here edits or copies
// the record). It is a view over the live record the Planning page
// has already loaded (researchByTypeAndId), so it adds no database
// reads. The full record is one tap away via "Open full Research
// entry"; this popup deliberately never shows every field.

// Which destination the Planning belongs to — supplied once by the
// Planning page so the many places that can show a Research item
// (timeline rows, the item form, alternatives) don't each need the
// destination id/name threaded through their props.
const ResearchContext = createContext({ destinationId: null, destinationName: '' });
export const ResearchContextProvider = ResearchContext.Provider;

const stopBubbling = (e) => e.stopPropagation();

export function ResearchSummaryModal({ open, onClose, researchRefType, researchRefId, record, destinationId, destinationName }) {
  if (!open) return null;
  const summary = buildResearchSummary(researchRefType, record, { destinationName });
  const entryPath = record ? buildResearchEntryPath(destinationId, researchRefType, researchRefId) : null;

  // Rendered in a portal so it is never nested inside a clickable
  // timeline row; React events still bubble through portals, so the
  // wrapper stops them from reaching the row's own click handler
  // (which opens the item editor).
  return createPortal(
    <div onClick={stopBubbling}>
      <Modal open onClose={onClose} title={summary ? summary.name : 'Research item unavailable'}>
        {summary ? (
          <div className="research-summary">
            <div className="research-summary__badges">
              <SectionBadge label={summary.typeLabel} />
              {summary.badges.map(b => (
                b.kind === 'visitPriority'
                  ? <VisitPriorityBadge key={b.kind} visitPriority={b.value} />
                  : <PriceTierBadge key={b.kind} priceTier={b.value} />
              ))}
            </div>
            {summary.subtitle && <p className="research-summary__subtitle">{summary.subtitle}</p>}
            {summary.location && <p className="research-summary__location">{summary.location}</p>}
            {summary.facts.length > 0 && (
              <dl className="research-summary__facts">
                {summary.facts.map(f => (
                  <div key={f.label} className="research-summary__fact">
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="research-summary__actions">
              {entryPath && <Link to={entryPath} className="research-summary__open">Open full Research entry →</Link>}
              {summary.mapLinks.map(link => (
                <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="place-maps-link">{link.label}</a>
              ))}
            </div>
          </div>
        ) : (
          <div className="research-summary">
            <p className="research-summary__unavailable">
              This Research entry is no longer available — it may have been deleted. The Planning item itself is unchanged.
            </p>
          </div>
        )}
        <Button type="button" variant="secondary" fullWidth onClick={onClose}>Close</Button>
      </Modal>
    </div>,
    document.body,
  );
}

// A small "ⓘ Research" button that owns its popup's open state. Works
// anywhere a Research-linked Planning item is shown. Clicking it never
// triggers the surrounding row's own click (edit) behaviour.
export function ResearchInfoButton({ researchRefType, researchRefId, record, className = 'research-info-button' }) {
  const { destinationId, destinationName } = useContext(ResearchContext);
  const [open, setOpen] = useState(false);
  if (!researchRefType || !researchRefId) return null;
  return (
    <>
      <button
        type="button"
        className={className}
        aria-label="View Research details"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        ⓘ Research
      </button>
      <ResearchSummaryModal
        open={open}
        onClose={() => setOpen(false)}
        researchRefType={researchRefType}
        researchRefId={researchRefId}
        record={record}
        destinationId={destinationId}
        destinationName={destinationName}
      />
    </>
  );
}

// Shown on a section page when `?open=<id>` named a Research entry
// that no longer exists (soft-deleted or unknown) — the page does NOT
// open some other record in its place.
export function ResearchUnavailableNotice({ onDismiss }) {
  return (
    <div className="research-unavailable-notice" role="status">
      <span>That Research entry is no longer available — it may have been deleted.</span>
      <button type="button" className="research-unavailable-notice__dismiss" onClick={onDismiss} aria-label="Dismiss">×</button>
    </div>
  );
}
