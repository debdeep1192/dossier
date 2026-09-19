import { useState } from 'react';
import { Link, NavLink, Outlet, useMatch, useSearchParams } from 'react-router-dom';
import AddEntry from './AddEntry';
import { SECTIONS } from '../sectionRegistry.js';
import { matchCurrentSection } from '../lib/addEntryRouting.js';
import { AddEntryProvider } from '../lib/addEntryContext.js';
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

  // AppShell wraps <Routes> in App.jsx rather than being rendered inside
  // a <Route> via <Outlet>, so it can't use useParams() to pick up
  // :destinationId — that only resolves within the matched route's own
  // subtree. useMatch() against the shared /destinations/:destinationId/*
  // path (every section route follows this shape) works from anywhere
  // inside the Router, which is what we need here. This mirrors the
  // context DestinationDetail.jsx already derives for its own "+ Add"
  // trigger (which now opens THIS same shared modal — see
  // lib/addEntryContext.js — rather than mounting a second instance).
  const destinationMatch = useMatch('/destinations/:destinationId/*');
  const [searchParams] = useSearchParams();
  const currentDestinationId = destinationMatch?.params?.destinationId;
  const currentLocationId = searchParams.get('location') || null;
  // Case A detection: are we already ON a specific section's own page
  // (e.g. /destinations/abc/attractions)? If so, the single Add entry
  // point should skip straight to that section's real form — see
  // matchCurrentSection() in lib/addEntryRouting.js and AddEntry.jsx's
  // initialSection handling.
  const currentSection = matchCurrentSection(destinationMatch?.pathname, currentDestinationId, SECTIONS);

  return (
    <AddEntryProvider value={() => setAddOpen(true)}>
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

        <AddEntry
          open={addOpen}
          onClose={() => setAddOpen(false)}
          initialDestinationId={currentDestinationId}
          initialLocationId={currentLocationId}
          initialSection={currentSection}
        />
      </div>
    </AddEntryProvider>
  );
}
