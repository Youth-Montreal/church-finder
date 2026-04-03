import { STORAGE_KEY } from '../config.js';
import { defaultHosts } from '../data/defaultHosts.js';

export function loadHosts() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return defaultHosts;

  try {
    return JSON.parse(saved).map((host) => ({
      ...host,
      hostPasscode: host.hostPasscode || '',
      googleMapsUrl: host.googleMapsUrl || '',
      googlePlaceId: host.googlePlaceId || '',
      languages: host.languages || [],
      events: (host.events || []).map((event) => ({
        ...event,
        title: event.title || event.type || '',
        ageGroup: event.ageGroup || 'all',
        recurrence: event.recurrence || 'none',
        until: event.until || ''
      }))
    }));
  } catch {
    return defaultHosts;
  }
}

export function saveHosts(hosts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(hosts));
}
