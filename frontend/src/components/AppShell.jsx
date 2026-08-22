import { NavLink, Outlet } from 'react-router-dom';
import './AppShell.css';

const NAV_ITEMS = [
  { to: '/research', label: 'Research', icon: '📖' },
  { to: '/trips', label: 'Trips', icon: '🧳' },
  { to: '/live', label: 'Live', icon: '📍' },
  { to: '/more', label: 'More', icon: '⋯' },
];

// `children`, when provided, replaces the routed <Outlet /> content —
// used by App.jsx's RootGate to show the real nav chrome immediately
// during initial profile/DB loading (progressive render), before any
// route has actually resolved.
export default function AppShell({ children }) {
  return (
    <div className="app-shell">
      <aside className="app-shell__sidebar">
        <div className="app-shell__brand">
          <span className="app-shell__brand-mark">D</span>
          <span className="app-shell__brand-name">Dossier</span>
        </div>
        <nav className="app-shell__sidebar-nav">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `app-shell__sidebar-link ${isActive ? 'app-shell__sidebar-link--active' : ''}`}
            >
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

      <nav className="app-shell__bottom-nav" aria-label="Primary">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `app-shell__bottom-link ${isActive ? 'app-shell__bottom-link--active' : ''}`}
          >
            <span className="app-shell__bottom-icon" aria-hidden="true">{item.icon}</span>
            <span className="app-shell__bottom-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
