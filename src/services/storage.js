import { STORAGE_KEY } from '../config.js';
import { defaultHosts } from '../data/defaultHosts.js';

const LEGACY_HOST_STORAGE_KEYS = ['youth-montreal-churches'];

function readLegacyHosts() {
  for (const key of LEGACY_HOST_STORAGE_KEYS) {
    const saved = localStorage.getItem(key);
    if (!saved) continue;
    localStorage.setItem(STORAGE_KEY, saved);
    localStorage.removeItem(key);
    return saved;
  }
  return '';
}

export function loadHosts() {
  const saved = localStorage.getItem(STORAGE_KEY) || readLegacyHosts();
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
  LEGACY_HOST_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(hosts));
}
