import { useParams, useSearchParams, Navigate } from 'react-router-dom';

// Dishes moved into the combined "Food & Restaurants" page (Phase 3
// Chunk 11) as a sub-tab, rather than its own top-level section — see
// RestaurantsPage.jsx. This route is kept, rather than removed, so any
// existing bookmark or deep link to /destinations/:id/dishes still
// works: it simply redirects into the same page with the Dishes tab
// pre-selected, preserving any ?location= context already in the URL.
// No data, store, or route removal — this is a redirect, not a deletion.
export default function DishesPage() {
  const { destinationId } = useParams();
  const [searchParams] = useSearchParams();
  const next = new URLSearchParams(searchParams);
  next.set('tab', 'dishes');
  return <Navigate to={`/destinations/${destinationId}/restaurants?${next.toString()}`} replace />;
}
