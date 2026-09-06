import { Input } from './Field';
import { buildGoogleMapsUrl } from '../lib/googleMaps';
import PlaceLookup from './PlaceLookup';
import './Place.css';

export { buildGoogleMapsUrl };

export function PlaceMapsLink({ place, destinationName }) {
  const url = buildGoogleMapsUrl(place, destinationName);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="place-maps-link" onClick={e => e.stopPropagation()}>
      📍 Open in Google Maps
    </a>
  );
}

export function PlaceSummary({ place, destinationName }) {
  if (!place || !place.name) return null;
  return (
    <div className="place-summary">
      <span className="place-summary__name">{place.name}</span>
      {(place.locality || place.city) && (
        <span className="place-summary__locality">{[place.locality, place.city].filter(Boolean).join(', ')}</span>
      )}
      <PlaceMapsLink place={place} destinationName={destinationName} />
    </div>
  );
}

// `locationName`/`destinationName`/`expectedCategory` are optional —
// when provided, they feed the "Find Place" lookup's contextual query
// and ranking (see lib/placeLookup.js). A caller with no location
// context yet can still use PlaceField normally; Find Place just
// searches with less context (name + destination only, or name alone).
export function PlaceField({ value, onChange, label = 'Place', locationName, destinationName, expectedCategory }) {
  const place = value || {};
  function update(patch) {
    onChange({ ...place, ...patch });
  }
  return (
    <div className="place-field">
      <span className="place-field__label">{label}</span>
      <Input placeholder="Name" aria-label={`${label} name`} value={place.name || ''} onChange={e => update({ name: e.target.value })} />
      <div className="place-field__row">
        <Input placeholder="Area / locality" aria-label={`${label} locality`} value={place.locality || ''} onChange={e => update({ locality: e.target.value })} />
        <Input placeholder="City" aria-label={`${label} city`} value={place.city || ''} onChange={e => update({ city: e.target.value })} />
      </div>
      <PlaceLookup
        name={place.name}
        locationName={locationName}
        destinationName={destinationName}
        expectedCategory={expectedCategory}
        onConfirm={(found) => update({
          name: found.name || place.name,
          locality: found.locality || place.locality,
          city: found.city || place.city,
          lat: found.lat ?? place.lat,
          lng: found.lng ?? place.lng,
        })}
      />
      <Input
        placeholder="Google Maps link (optional — paste a share link if you have one)"
        aria-label={`${label} Google Maps URL`}
        value={place.googleMapsUrl || ''}
        onChange={e => update({ googleMapsUrl: e.target.value })}
      />
    </div>
  );
}
