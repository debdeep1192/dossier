import { Link } from 'react-router-dom';
import Button from './Button';
import './SectionPageLayout.css';

// Pure layout chrome (breadcrumb, title, "+ Add" button, list
// container) shared across the section pages purely to avoid repeating
// markup — it renders whatever children/list items each section page
// passes it. It has no knowledge of any section's fields and holds no
// data itself.
//
// `locationLabel`, when provided (the section page is scoped to a
// specific location via ?location=), is shown in the breadcrumb so the
// current context is always visible, not just implied by the URL.
export default function SectionPageLayout({ destination, destinationId, title, locationLabel, onAdd, addLabel = '+ Add', children }) {
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
        {onAdd && <Button size="sm" onClick={onAdd}>{addLabel}</Button>}
      </header>
      <div className="section-page__list">
        {children}
      </div>
    </div>
  );
}
