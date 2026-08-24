// Builds a Google Maps URL: prefers a stored real share link (pasted by
// the person), otherwise falls back to a plain search URL using the
// approved format — no API key, no embedded map.
export function buildGoogleMapsUrl(place, destinationName) {
  if (!place) return null;
  if (place.googleMapsUrl && place.googleMapsUrl.trim()) return place.googleMapsUrl.trim();
  if (!place.name) return null;
  const locality = place.locality || place.city || destinationName || '';
  const query = [place.name, locality].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
