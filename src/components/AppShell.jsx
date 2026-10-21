import { useState } from 'react';
import { Link, NavLink, Outlet, useMatch, useLocation, useSearchParams, useNavigate } from 'react-router-dom';
import AddEntry from './AddEntry';
import BrandMark from './BrandMark';
import { HomeIcon, PlanningIcon, TravellersIcon, PlusIcon } from './NavIcons';
import { SECTIONS } from '../sectionRegistry.js';
import { matchCurrentSection, buildAddDestinationPath, isPlanningPath } from '../lib/addEntryRouting.js';
import { AddEntryProvider } from '../lib/addEntryContext.js';
import { PRODUCT_NAME } from '../lib/brand.js';
import './AppShell.css';

// Same three destinations, same order, same routes as before — only the
// icons changed (emoji -> a consistent inline SVG set, see NavIcons.jsx).
const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: <HomeIcon /> },
  // Tour Planning, Chunk 1 — top-level nav entries alongside Home,
  // since People and Plannings aren't scoped to a single destination.
  { to: '/plannings', label: 'Plannings', icon: <PlanningIcon /> },
  { to: '/people', label: 'Travellers', icon: <TravellersIcon /> },
];


// `children`, when provided, replaces the routed <Outlet /> content —
// used for progressive rendering (showing the real nav chrome
// immediately while initial data loads), same pattern proven in the
// previous Dossier.
export default function AppShell({ children }) {
  const [addOpen, setAddOpen] = useState(false);
  const navigate = useNavigate();

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
  // Tour Planning: the global "+ Add to Dossier" affordance must not be
  // reachable from inside Planning — Planning's own content additions
  // (Research references via ResearchPicker, custom timeline items,
  // itinerary Options, item alternatives) all go through Planning's
  // own controls on PlanningDetailPage, never through this global
  // Research/Dossier flow, which would otherwise let someone
  // accidentally create/mutate a global Research record while working
  // inside a Planning. isPlanningPath is the pure, testable decision
  // (see lib/addEntryRouting.js); useLocation() just supplies the
  // live pathname it needs, the same way destinationMatch above
  // supplies context for matchCurrentSection. This is the one, single
  // point that flow is triggered from (see the FAB below), so hiding
  // it here is sufficient — nothing else in the app opens this modal.
  const location = useLocation();
  const onPlanningPath = isPlanningPath(location.pathname);
  const [searchParams] = useSearchParams();
  const currentDestinationId = destinationMatch?.params?.destinationId;
  const currentLocationId = searchParams.get('location') || null;
  // Case A detection: are we already ON a specific section's own page
  // (e.g. /destinations/abc/attractions)? If so, the single Add entry
  // point should skip straight to that section's real form — see
  // matchCurrentSection() in lib/addEntryRouting.js.
  const currentSection = matchCurrentSection(destinationMatch?.pathname, currentDestinationId, SECTIONS);

  // Deciding and acting on Case A HERE, synchronously, in the same
  // render/click that has currentDestinationId/currentLocationId
  // freshly computed — not via a useEffect inside AddEntry reacting to
  // props after the fact — removes any possibility of navigating with
  // a stale/closed-over destination or location id. This is also now
  // the ONLY Add trigger in the whole app (see the single FAB button
  // below and the removed section-header/EmptyState Add controls in
  // SectionPageLayout.jsx and each section page), so it must handle
  // every context correctly on its own: outside any destination and
  // inside a destination/city (open the type-picker modal, see
  // AddEntry.jsx), and inside a section page (skip straight to that
  // section's real form via currentSection below).
  function openAdd() {
    if (onPlanningPath) return; // never reachable from inside Planning — see isPlanningPath above
    if (currentSection) {
      navigate(buildAddDestinationPath(currentSection, currentDestinationId, currentLocationId));
      return;
    }
    setAddOpen(true);
  }

  return (
    <AddEntryProvider value={openAdd}>
      <div className="app-shell">
        <aside className="app-shell__sidebar">
          <Link to="/" className="app-shell__brand">
            <BrandMark className="app-shell__brand-mark" size={38} />
            <span className="app-shell__brand-text">
              <span className="app-shell__brand-name">{PRODUCT_NAME}</span>
              <span className="app-shell__brand-tagline">Research · Plan · Go</span>
            </span>
          </Link>
          <nav className="app-shell__sidebar-nav">
            {NAV_ITEMS.map(item => (
              <NavLink key={item.to} to={item.to} end className={({ isActive }) => `app-shell__sidebar-link ${isActive ? 'app-shell__sidebar-link--active' : ''}`}>
                <span className="app-shell__sidebar-icon" aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="app-shell__main">
          {/* Mobile masthead — the sidebar (and so the brand) is hidden
              below 900px; this keeps the product identity on screen. */}
          <header className="app-shell__masthead">
            <Link to="/" className="app-shell__masthead-brand">
              <BrandMark size={28} />
              <span className="app-shell__masthead-name">{PRODUCT_NAME}</span>
            </Link>
          </header>
          <main className="app-shell__content">
            {children ?? <Outlet />}
          </main>
        </div>

        {/* The ONE Add affordance, in every context EXCEPT Planning
            (see onPlanningPath above and openAdd()'s guard) — mobile
            and desktop alike. Section pages' own former header/
            EmptyState "+ Add" controls are intentionally removed (see
            SectionPageLayout.jsx and each section page) so this is
            never one of two competing buttons on the same screen. */}
        {!onPlanningPath && (
          <button type="button" className="app-shell__fab" onClick={openAdd} aria-label={`Add to ${PRODUCT_NAME}`}>
            <PlusIcon />
          </button>
        )}

        <nav className="app-shell__bottom-nav">
          {NAV_ITEMS.map(item => (
            <NavLink key={item.to} to={item.to} end className={({ isActive }) => `app-shell__bottom-link ${isActive ? 'app-shell__bottom-link--active' : ''}`}>
              <span className="app-shell__bottom-icon" aria-hidden="true">{item.icon}</span>
              <span className="app-shell__bottom-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {!onPlanningPath && (
          <AddEntry
            open={addOpen}
            onClose={() => setAddOpen(false)}
            initialDestinationId={currentDestinationId}
            initialLocationId={currentLocationId}
          />
        )}
      </div>
    </AddEntryProvider>
  );
}
