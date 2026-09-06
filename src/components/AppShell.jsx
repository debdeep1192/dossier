import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import QuickAdd from './QuickAdd';
import './AppShell.css';

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: '🏠' },
];

// `children`, when provided, replaces the routed <Outlet /> content —
// used for progressive rendering (showing the real nav chrome
// immediately while initial data loads), same pattern proven in the
// previous Dossier.
export default function AppShell({ children }) {
  const navigate = useNavigate();
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  // After a Quick Add save, jump to the destination it was saved
  // under — the person immediately sees the record they just created,
  // in context, rather than wondering whether it saved. Cached data
  // for that destination/section was already invalidated by QuickAdd
  // itself before this fires, so the destination page fetches fresh.
  function handleQuickAddSaved(destinationId) {
    setQuickAddOpen(false);
    navigate(`/destinations/${destinationId}`);
  }

  return (
    <div className="app-shell">
      <aside className="app-shell__sidebar">
        <Link to="/" className="app-shell__brand">
          <span className="app-shell__brand-mark">D</span>
          <span className="app-shell__brand-name">Dossier</span>
        </Link>
        <button type="button" className="app-shell__quick-add" onClick={() => setQuickAddOpen(true)}>
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

      <button type="button" className="app-shell__fab" onClick={() => setQuickAddOpen(true)} aria-label="Add to Dossier">
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

      <QuickAdd open={quickAddOpen} onClose={() => setQuickAddOpen(false)} onSaved={handleQuickAddSaved} />
    </div>
  );
}
