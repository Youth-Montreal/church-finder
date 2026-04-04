export function googlePlaceLink(host) {
  const placeId = host.googlePlaceId?.trim();
  const mapsUrl = host.googleMapsUrl?.trim();

  if (placeId) {
    return `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}`;
  }

  if (mapsUrl) return mapsUrl;

  if (host.lat && host.lng) {
    return `https://www.google.com/maps/search/?api=1&query=${host.lat},${host.lng}`;
  }

  return 'https://www.google.com/maps';
}
