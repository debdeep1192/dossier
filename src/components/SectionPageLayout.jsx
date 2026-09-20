import { Link } from 'react-router-dom';
import './SectionPageLayout.css';

// Pure layout chrome (breadcrumb, title, list container) shared
// across the section pages purely to avoid repeating markup — it
// renders whatever children/list items each section page passes it.
// It has no knowledge of any section's fields and holds no data
// itself.
//
// `locationLabel`, when provided (the section page is scoped to a
// specific location via ?location=), is shown in the breadcrumb so the
// current context is always visible, not just implied by the URL.
//
// There is intentionally NO "+ Add" button here anymore: the single
// bottom-right floating "+ Add" (AppShell.jsx) is the ONE Add
// affordance in every context, including inside a section page (where
// it opens this exact section's real form directly, via
// AppShell.jsx's openAdd() + currentSection detection) — a
// section-header button here would be a second, competing control.
export default function SectionPageLayout({ destination, destinationId, title, locationLabel, children }) {
  return (
    <div className="section-page">
      <div className="section-page__breadcrumb">
        <Link to="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/destinations/${destinationId}`}>{destination?.name || 'Destination'}</Link>
        {locationLabel && (
          <>
            <span aria-hidden="true">/</span>
            <span>{locationLabel}</span>
          </>
        )}
        <span aria-hidden="true">/</span>
        <span>{title}</span>
      </div>
      <header className="section-page__header">
        <h1>{title}</h1>
      </header>
      <div className="section-page__list">
        {children}
      </div>
    </div>
  );
}
