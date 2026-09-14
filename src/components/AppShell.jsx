import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import AddEntry from './AddEntry';
import './AppShell.css';

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: '🏠' },
];

// `children`, when provided, replaces the routed <Outlet /> content —
// used for progressive rendering (showing the real nav chrome
// immediately while initial data loads), same pattern proven in the
// previous Dossier.
export default function AppShell({ children }) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="app-shell">
      <aside className="app-shell__sidebar">
        <Link to="/" className="app-shell__brand">
          <span className="app-shell__brand-mark">D</span>
          <span className="app-shell__brand-name">Dossier</span>
        </Link>
        <button type="button" className="app-shell__quick-add" onClick={() => setAddOpen(true)}>
          + Add to Dossier
        </button>
        <nav className="app-shell__sidebar-nav">
          {NAV_ITEMS.map(item => (
            <NavLink key={item.to} to={item.to} end className={({ isActive }) => `app-shell__sidebar-link ${isActive ? 'app-shell__sidebar-link--active' : ''}`}>
              <span aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="app-shell__main">
        <main className="app-shell__content">
          {children ?? <Outlet />}
        </main>
      </div>

      <button type="button" className="app-shell__fab" onClick={() => setAddOpen(true)} aria-label="Add to Dossier">
        +
      </button>

      <nav className="app-shell__bottom-nav">
        {NAV_ITEMS.map(item => (
          <NavLink key={item.to} to={item.to} end className={({ isActive }) => `app-shell__bottom-link ${isActive ? 'app-shell__bottom-link--active' : ''}`}>
            <span className="app-shell__bottom-icon" aria-hidden="true">{item.icon}</span>
            <span className="app-shell__bottom-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <AddEntry open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
