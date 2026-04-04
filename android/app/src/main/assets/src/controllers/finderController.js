import { geocodeAddress, searchMontrealAddresses } from '../services/geocoding.js';
import { haversineKm } from '../utils/distance.js';
import { t } from '../i18n.js';

export function attachFinderController({ state, map, elements, renderMarkers, renderHostDetails }) {
  const addressList = document.querySelector('#montreal-addresses');

  const applyLocationFilter = async ({ shouldGeocode = true } = {}) => {
    const address = elements.finderForm.elements.address.value.trim();
    const radiusKm = Number(elements.finderForm.elements.radiusKm.value);

    if (!address) {
      state.filteredIds = null;
      elements.finderStatus.textContent = '';
      renderMarkers();
      return null;
    }

    let point = state.lastFinderPoint;
    if (shouldGeocode || !point || point.query !== address) {
      elements.finderStatus.textContent = t(state, 'searchLoading');
      const match = await geocodeAddress(address);
      if (!match) {
        state.filteredIds = null;
        state.lastFinderPoint = null;
        elements.finderStatus.textContent = t(state, 'searchNoResults');
        renderMarkers();
        return null;
      }
      point = { ...match, query: match.shortAddress || match.fullAddress };
      state.lastFinderPoint = point;
      elements.finderForm.elements.address.value = match.shortAddress || match.fullAddress;
    }

    const matches = state.hosts.filter((host) => haversineKm(point.lat, point.lng, Number(host.lat), Number(host.lng)) <= radiusKm);
    state.filteredIds = new Set(matches.map((host) => host.id));
    renderMarkers();

    if (!matches.length) {
      elements.finderStatus.textContent = t(state, 'searchNoResults');
      map.setView([point.lat, point.lng], 12);
      return [];
    }

    const visibleMatches = matches.filter((host) => !state.mapFilteredIds || state.mapFilteredIds.has(host.id));
    elements.finderStatus.textContent = `${visibleMatches.length} ${t(state, 'hostsFoundNearAddress')}`;
    const bounds = L.latLngBounds(matches.map((host) => [Number(host.lat), Number(host.lng)]));
    map.fitBounds(bounds.pad(0.25));

    const selected = visibleMatches[0] || matches[0];
    if (selected) {
      state.selectedHostId = selected.id;
      renderHostDetails(selected);
    }

    document.querySelector('#find-host')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return matches;
  };

  elements.finderForm.elements.address.addEventListener('input', async (event) => {
    state.lastFinderPoint = null;
    const matches = await searchMontrealAddresses(event.target.value, 6);
    if (!matches.length || !addressList) return;
    addressList.innerHTML = matches.map((item) => `<option value="${item.shortAddress || item.fullAddress}"></option>`).join('');
  });

  elements.finderForm.elements.address.addEventListener('change', () => applyLocationFilter({ shouldGeocode: true }));
  elements.finderForm.elements.radiusKm.addEventListener('change', () => applyLocationFilter({ shouldGeocode: false }));
  elements.finderForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await applyLocationFilter({ shouldGeocode: true });
  });

  return {
    applyLocationFilter,
    clearLocationFilter() {
      state.filteredIds = null;
      state.lastFinderPoint = null;
      elements.finderStatus.textContent = '';
      renderMarkers();
    }
  };
}
