import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AppShell from './components/AppShell';
import ResearchHome from './pages/ResearchHome';
import DestinationDetail from './pages/DestinationDetail';
import AttractionsPage from './pages/sections/AttractionsPage';
import RestaurantsPage from './pages/sections/RestaurantsPage';
import AccommodationsPage from './pages/sections/AccommodationsPage';
import TransportPage from './pages/sections/TransportPage';
import CostsPage from './pages/sections/CostsPage';
import PracticalInfoPage from './pages/sections/PracticalInfoPage';
import WeatherPage from './pages/sections/WeatherPage';
import PackingPage from './pages/sections/PackingPage';
import GeneralNotesPage from './pages/sections/GeneralNotesPage';
import ShoppingPage from './pages/ShoppingPage';
import SourcesPage from './pages/SourcesPage';
import CurrencySettingsPage from './pages/CurrencySettingsPage';
import ImportPage from './pages/ImportPage';
import ReviewPage from './pages/ReviewPage';

// No global loading gate: IndexedDB opens near-instantly (no engine to
// boot, unlike the old PGlite architecture), so there's no meaningful
// "app not ready yet" state worth blocking the whole shell for. Each
// route renders its own shell immediately and fills in data via
// useCachedQuery — see hooks/useCachedQuery.js.
export default function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<ResearchHome />} />
          <Route path="/destinations/:destinationId" element={<DestinationDetail />} />
          <Route path="/destinations/:destinationId/attractions" element={<AttractionsPage />} />
          <Route path="/destinations/:destinationId/restaurants" element={<RestaurantsPage />} />
          <Route path="/destinations/:destinationId/accommodations" element={<AccommodationsPage />} />
          <Route path="/destinations/:destinationId/transport" element={<TransportPage />} />
          <Route path="/destinations/:destinationId/costs" element={<CostsPage />} />
          <Route path="/destinations/:destinationId/practical-info" element={<PracticalInfoPage />} />
          <Route path="/destinations/:destinationId/weather" element={<WeatherPage />} />
          <Route path="/destinations/:destinationId/packing" element={<PackingPage />} />
          <Route path="/destinations/:destinationId/notes" element={<GeneralNotesPage />} />
          <Route path="/destinations/:destinationId/shopping" element={<ShoppingPage />} />
          <Route path="/destinations/:destinationId/sources" element={<SourcesPage />} />
          <Route path="/destinations/:destinationId/currency" element={<CurrencySettingsPage />} />
          <Route path="/destinations/:destinationId/import" element={<ImportPage />} />
          <Route path="/destinations/:destinationId/review/:intakeId" element={<ReviewPage />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
