import { Link } from 'react-router-dom';
import Button from './Button';
import './SectionPageLayout.css';

// Pure layout chrome (breadcrumb, title, "+ Add" button, list
// container) shared across the 9 section pages purely to avoid
// repeating markup — it renders whatever children/list items each
// section page passes it. It has no knowledge of any section's fields
// and holds no data itself.
export default function SectionPageLayout({ destination, destinationId, title, onAdd, addLabel = '+ Add', children }) {
  return (
    <div className="section-page">
      <div className="section-page__breadcrumb">
        <Link to="/">Research</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/destinations/${destinationId}`}>{destination?.name || 'Destination'}</Link>
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
