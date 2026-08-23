import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProfileProvider, useProfile } from './context/ProfileContext';
import AppShell from './components/AppShell';
import WelcomePage from './pages/WelcomePage';
import ResearchHome from './pages/ResearchHome';
import DestinationDetail from './pages/DestinationDetail';
import ItemDetail from './pages/ItemDetail';
import ItemReview from './pages/ItemReview';
import MorePage from './pages/MorePage';
import PlaceholderPage from './pages/PlaceholderPage';
import { LoadingState } from './components/States';

// First-run gate: no local profile yet -> WelcomePage. Profile exists ->
// the normal app shell. This replaces the old server-auth RequireAuth/
// AuthGate pair — "authenticated" becomes "hasProfile", "/auth" becomes
// WelcomePage rendered in place.
//
// Progressive render: AppShell's nav chrome needs no profile or DB data
// to render, so it's shown immediately rather than replacing the whole
// screen with a spinner while getDb()/getProfile() resolve underneath —
// the app appears instantly instead of a blank loading screen. Only the
// content area shows a loading state while that resolves.
function RootGate() {
  const { loading, hasProfile } = useProfile();
  if (loading) {
    return (
      <AppShell>
        <LoadingState label="Loading Dossier…" />
      </AppShell>
    );
  }
  if (!hasProfile) return <WelcomePage />;
  return <AppShell />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ProfileProvider>
        <Routes>
          <Route path="/" element={<RootGate />}>
            <Route index element={<Navigate to="/research" replace />} />
            <Route path="research" element={<ResearchHome />} />
            <Route path="research/:destinationId" element={<DestinationDetail />} />
            <Route path="research/:destinationId/items/:itemId" element={<ItemDetail />} />
            <Route path="research/:destinationId/review/:intakeId" element={<ItemReview />} />
            <Route
              path="trips"
              element={
                <PlaceholderPage
                  icon="🧳"
                  title="Trips"
                  description="Trip creation, itinerary building, group & logistics, money, and bookings arrive in Phase 2 and beyond, once Master Research (Phase 1) is approved."
                />
              }
            />
            <Route
              path="live"
              element={
                <PlaceholderPage
                  icon="📍"
                  title="Live"
                  description="Live Trip Mode — the minimal on-the-ground companion view — arrives once Trips and Offline sync are built (Phase 8)."
                />
              }
            />
            <Route path="more" element={<MorePage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ProfileProvider>
    </BrowserRouter>
  );
}
