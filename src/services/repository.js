import { SHEETS_WEB_APP_URL } from '../config.js';
import { loadHosts as loadLocalHosts, saveHosts as saveLocalHosts } from './storage.js';

const REPORTS_KEY = 'youth-montreal-reports';
const HOST_REQUESTS_KEY = 'youth-montreal-host-requests';
const HOST_MEMBERSHIPS_KEY = 'youth-montreal-host-memberships';
const LIVE_EVENTS_KEY = 'youth-montreal-live-events';
const LIVE_EVENT_PARTICIPANTS_KEY = 'youth-montreal-live-event-participants';
const AUDIT_LOG_KEY = 'youth-montreal-audit-log';
const PENDING_SYNC_KEY = 'youth-montreal-pending-sync';
const SYNC_URL_KEY = 'youth-montreal-sheets-url';
const LEGACY_LOCAL_KEYS = {
  [REPORTS_KEY]: ['youth-montreal-suggestions'],
  [HOST_REQUESTS_KEY]: ['youth-montreal-title-requests'],
  [HOST_MEMBERSHIPS_KEY]: ['youth-montreal-hostMemberships'],
  [LIVE_EVENTS_KEY]: ['youth-montreal-liveEvents'],
  [LIVE_EVENT_PARTICIPANTS_KEY]: ['youth-montreal-liveEventParticipants']
};
const syncListeners = new Set();
const REMOTE_TIMEOUT_MS = 8000;
const REMOTE_COOLDOWN_MS = 30000;
const remoteBlockedUntilByResource = new Map();

function getRemoteUrl() {
  if (SHEETS_WEB_APP_URL && SHEETS_WEB_APP_URL.trim()) return SHEETS_WEB_APP_URL.trim();
  if (typeof window !== 'undefined') {
    const runtimeUrl = window.__SHEETS_WEB_APP_URL__ || localStorage.getItem(SYNC_URL_KEY);
    if (runtimeUrl && runtimeUrl.trim()) return runtimeUrl.trim();
  }
  return '';
}

const hasRemote = () => Boolean(getRemoteUrl());

function canAttemptRemote(resource) {
  if (!hasRemote()) return false;
  const blockedUntil = remoteBlockedUntilByResource.get(resource) || 0;
  return Date.now() >= blockedUntil;
}

function clearRemoteCooldown(resource) {
  remoteBlockedUntilByResource.delete(resource);
}

function markRemoteCooldown(resource) {
  remoteBlockedUntilByResource.set(resource, Date.now() + REMOTE_COOLDOWN_MS);
}

export function getConfiguredSyncUrl() {
  return getRemoteUrl();
}

export function setConfiguredSyncUrl(url) {
  const value = String(url || '').trim();
  if (typeof window === 'undefined') return;
  if (!value) {
    localStorage.removeItem(SYNC_URL_KEY);
    emitSyncState();
    return;
  }
  localStorage.setItem(SYNC_URL_KEY, value);
  emitSyncState();
}

function readPendingSync() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_SYNC_KEY) || '{}');
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function writePendingSync(data) {
  localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(data));
}

function emitSyncState() {
  const state = getSyncState();
  syncListeners.forEach((listener) => listener(state));
}

function markPending(resource, payload, errorMessage = '') {
  const pending = readPendingSync();
  pending[resource] = {
    payload,
    failedAt: new Date().toISOString(),
    errorMessage
  };
  writePendingSync(pending);
  emitSyncState();
}

function clearPending(resource) {
  const pending = readPendingSync();
  if (!pending[resource]) return;
  delete pending[resource];
  writePendingSync(pending);
  emitSyncState();
}

async function remoteGet(resource) {
  const url = `${getRemoteUrl()}?resource=${encodeURIComponent(resource)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!response.ok) throw new Error(`Remote GET failed: ${resource}`);
    const data = await response.json();
    if (data?.error) throw new Error(`Remote GET error: ${data.error}`);
    clearRemoteCooldown(resource);
    return data;
  } catch (error) {
    markRemoteCooldown(resource);
    throw error;
  }
}

function getClientSessionToken() {
  try {
    const saved = JSON.parse(localStorage.getItem('youth-montreal-auth-session') || 'null');
    if (typeof saved === 'string') return saved;
    return typeof saved?.token === 'string' ? saved.token : '';
  } catch {
    return '';
  }
}

async function remotePost(resource, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const token = getClientSessionToken();
    const response = await fetch(getRemoteUrl(), {
      method: 'POST',
      body: JSON.stringify({ resource, payload, token }),
      signal: controller.signal
    }).finally(() => clearTimeout(timer));
    if (!response.ok) throw new Error(`Remote POST failed: ${resource}`);
    const data = await response.json();
    if (data?.error || data?.ok === false) throw new Error(`Remote POST error: ${data?.error || data?.reason || 'request rejected'}`);
    clearRemoteCooldown(resource);
    return data;
  } catch (error) {
    markRemoteCooldown(resource);
    throw error;
  }
}



async function remotePostJson(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const response = await fetch(getRemoteUrl(), {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: controller.signal
    }).finally(() => clearTimeout(timer));
    if (!response.ok) throw new Error('Remote POST failed');
    const data = await response.json();
    if (data?.error) throw new Error(`Remote POST error: ${data.error}`);
    return data;
  } catch (error) {
    throw error;
  }
}

function readLocalList(key) {
  const saved = localStorage.getItem(key) || migrateLegacyLocalList(key);
  try {
    return JSON.parse(saved || '[]');
  } catch {
    return [];
  }
}

function writeLocalList(key, list) {
  localStorage.setItem(key, JSON.stringify(list));
}

function migrateLegacyLocalList(key) {
  const legacyKeys = LEGACY_LOCAL_KEYS[key] || [];
  for (const legacyKey of legacyKeys) {
    const saved = localStorage.getItem(legacyKey);
    if (!saved) continue;
    localStorage.setItem(key, saved);
    localStorage.removeItem(legacyKey);
    return saved;
  }
  return '';
}

function normalizeLiveEvent(entry = {}) {
  const now = new Date().toISOString();
  const titleBase = String(entry.titleBase || entry.title || '').trim();
  return {
    id: entry.id || crypto.randomUUID(),
    title: String(entry.title || titleBase).trim(),
    titleBase,
    description: String(entry.description || ''),
    status: entry.status || 'active',
    joinCode: String(entry.joinCode || '').trim(),
    createdByAccountId: String(entry.createdByAccountId || ''),
    createdByHostId: String(entry.createdByHostId || ''),
    startedAt: entry.startedAt || now,
    endedAt: entry.endedAt || '',
    filters: entry.filters && typeof entry.filters === 'object' ? entry.filters : {}
  };
}

function normalizeLiveEventParticipant(entry = {}) {
  return {
    liveEventId: String(entry.liveEventId || ''),
    hostId: String(entry.hostId || ''),
    accountId: String(entry.accountId || ''),
    isLead: Boolean(entry.isLead),
    joinedAt: entry.joinedAt || new Date().toISOString(),
    capturedAt: entry.capturedAt || entry.lastLocationAt || '',
    lastLocationAt: entry.lastLocationAt || entry.capturedAt || '',
    lat: Number.isFinite(Number(entry.lat ?? entry.latitude)) ? Number(entry.lat ?? entry.latitude) : null,
    lng: Number.isFinite(Number(entry.lng ?? entry.longitude)) ? Number(entry.lng ?? entry.longitude) : null,
    latitude: Number.isFinite(Number(entry.latitude ?? entry.lat)) ? Number(entry.latitude ?? entry.lat) : null,
    longitude: Number.isFinite(Number(entry.longitude ?? entry.lng)) ? Number(entry.longitude ?? entry.lng) : null,
    accuracyMeters: Number.isFinite(Number(entry.accuracyMeters)) ? Number(entry.accuracyMeters) : 0,
    speedKmh: Number.isFinite(Number(entry.speedKmh)) ? Number(entry.speedKmh) : 0,
    isSharingEnabled: entry.isSharingEnabled !== false
  };
}

function resolveUniqueLiveEventTitle(titleBase, liveEvents, currentId = '') {
  const normalizedBase = String(titleBase || '').trim() || 'Live Event';
  const activeTitles = new Set((liveEvents || [])
    .filter((event) => event.status === 'active' && event.id !== currentId)
    .map((event) => String(event.title || '').trim().toLowerCase())
    .filter(Boolean));
  let candidate = normalizedBase;
  let suffix = 2;
  while (activeTitles.has(candidate.toLowerCase())) {
    candidate = `${normalizedBase} (${suffix})`;
    suffix += 1;
  }
  return candidate;
}

function normalizeEntry(entry) {
  const canonicalEntry = {
    ...entry,
    hostName: entry?.hostName || entry?.churchName || '',
    type: entry?.type || (entry?.targetHostId ? 'join_existing_host' : 'new_host'),
    targetHostId: entry?.targetHostId || '',
    requesterAccountId: entry?.requesterAccountId || entry?.accountId || '',
    requesterEmail: entry?.requesterEmail || entry?.email || ''
  };
  return {
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...canonicalEntry
  };
}

const AUTHENTICATED_RESOURCES = new Set([
  'reports', 'hostRequests', 'hostMemberships', 'liveEvents', 'liveEventParticipants'
]);

async function loadList(resource, localKey) {
  if (AUTHENTICATED_RESOURCES.has(resource)) {
    const token = getClientSessionToken();
    if (!token || !canAttemptRemote('session')) return [];
    try {
      const data = await remotePostJson({ action: 'readResource', resource, token });
      if (!data?.ok) return [];
      const list = Array.isArray(data?.[resource]) ? data[resource].map(normalizeEntry) : [];
      writeLocalList(localKey, list);
      return list;
    } catch {
      // Never turn a stale local cache into authorization when remote verification fails.
      return [];
    }
  }

  if (canAttemptRemote(resource)) {
    try {
      const data = await remoteGet(resource);
      const list = Array.isArray(data?.[resource]) ? data[resource].map(normalizeEntry) : [];
      writeLocalList(localKey, list);
      return list;
    } catch {
      // Public data may use the documented local/offline fallback.
    }
  }
  return readLocalList(localKey).map(normalizeEntry);
}

async function saveList(resource, localKey, list) {
  if (['accounts', 'reports', 'hostRequests', 'hostMemberships', 'liveEventParticipants'].indexOf(resource) >= 0) {
    throw new Error(`Direct writes to ${resource} are disabled; use a backend action.`);
  }

  writeLocalList(localKey, list);
  if (canAttemptRemote(resource)) {
    try {
      await remotePost(resource, list);
      clearPending(resource);
    } catch (error) {
      markPending(resource, list, error instanceof Error ? error.message : String(error));
    }
  }
}

export async function loadHosts() {
  if (canAttemptRemote('hosts')) {
    try {
      const data = await remoteGet('hosts');
      if (Array.isArray(data?.hosts)) {
        saveLocalHosts(data.hosts);
        return data.hosts;
      }
    } catch {
      // fallback to local cache
    }
  }
  return loadLocalHosts();
}

export async function saveHosts(hosts) {
  saveLocalHosts(hosts);
  if (canAttemptRemote('hosts')) {
    try {
      await remotePost('hosts', hosts);
      clearPending('hosts');
    } catch (error) {
      markPending('hosts', hosts, error instanceof Error ? error.message : String(error));
    }
  }
}

export async function retryPendingSync() {
  remoteBlockedUntilByResource.clear();
  if (!hasRemote()) return getSyncState();
  const pending = readPendingSync();
  const entries = Object.entries(pending);
  for (const [resource, item] of entries) {
    try {
      await remotePost(resource, item?.payload ?? []);
      clearPending(resource);
    } catch {
      // Keep pending for future retries
    }
  }
  emitSyncState();
  return getSyncState();
}

export function getSyncState() {
  const pending = readPendingSync();
  const pendingResources = Object.keys(pending);
  return {
    hasRemote: hasRemote(),
    pendingResources,
    pendingCount: pendingResources.length,
    pending
  };
}

export function subscribeSyncState(listener) {
  if (typeof listener !== 'function') return () => {};
  syncListeners.add(listener);
  listener(getSyncState());
  return () => syncListeners.delete(listener);
}

export async function loginWithBackend({ email, password, role }) {
  if (!hasRemote() || !canAttemptRemote('session')) return { ok: false, error: 'backend_unavailable' };
  return remotePostJson({ action: 'login', email, password, role });
}

export async function registerHostAccountWithBackend(data) {
  if (!hasRemote() || !canAttemptRemote('session')) return { ok: false, error: 'backend_unavailable' };
  return remotePostJson({ action: 'registerHostAccount', ...data });
}

export async function verifyBackendSession(token) {
  if (!token || !hasRemote() || !canAttemptRemote('session')) return { valid: false };
  try {
    const data = await remotePostJson({ action: 'verifySession', token });
    return data?.valid ? data.session || { valid: true } : { valid: false };
  } catch {
    return { valid: false };
  }
}

export async function logoutBackendSession(token) {
  if (!token || !hasRemote()) return { ok: true };
  try {
    return await remotePostJson({ action: 'logout', token });
  } catch {
    return { ok: false };
  }
}

export async function moderateHostRequest(id, status, patch = {}) {
  if (!hasRemote()) throw new Error('A configured backend is required for moderation.');
  const token = getClientSessionToken();
  if (!token) throw new Error('An authenticated session is required.');
  const result = await remotePostJson({ action: 'moderateHostRequest', id, status, patch, token });
  if (!result?.ok) throw new Error(result?.reason || 'Host request moderation was rejected.');

  if (Array.isArray(result.hosts)) {
    await saveLocalHosts(result.hosts);
  }
  if (Array.isArray(result.hostMemberships)) writeLocalList(HOST_MEMBERSHIPS_KEY, result.hostMemberships);
  if (Array.isArray(result.hostRequests)) writeLocalList(HOST_REQUESTS_KEY, result.hostRequests);
  return result;
}

export async function loadReports() {
  return loadList('reports', REPORTS_KEY);
}

export async function loadHostRequests() {
  return loadList('hostRequests', HOST_REQUESTS_KEY);
}

export async function loadHostMemberships() {
  return loadList('hostMemberships', HOST_MEMBERSHIPS_KEY);
}

export async function saveHostMemberships(hostMemberships) {
  await saveList('hostMemberships', HOST_MEMBERSHIPS_KEY, hostMemberships);
}

export async function submitReport(report) {
  if (hasRemote()) {
    const result = await remotePostJson({ action: 'submitReport', report });
    if (!result?.ok) throw new Error('Report submission failed.');
    return result.report;
  }
  const list = readLocalList(REPORTS_KEY);
  const next = [...list, normalizeEntry(report)];
  writeLocalList(REPORTS_KEY, next);
  return report;
}

export async function submitHostRequest(hostRequest) {
  const list = await loadHostRequests();
  list.push(normalizeEntry(hostRequest));
  await saveList('hostRequests', HOST_REQUESTS_KEY, list);
}

export async function updateReportStatus(id, status) {
  if (hasRemote()) {
    const token = getClientSessionToken();
    const result = await remotePostJson({ action: 'updateReportStatus', id, status, token });
    if (!result?.ok) throw new Error(result?.reason || 'Report update was rejected.');
    writeLocalList(REPORTS_KEY, result.reports || []);
    return result.reports || [];
  }
  const list = readLocalList(REPORTS_KEY);
  const next = list.map((item) => (item.id === id ? { ...item, status, reviewedAt: new Date().toISOString() } : item));
  writeLocalList(REPORTS_KEY, next);
  return next;
}

export async function updateHostRequestStatus(id, status, patch = {}) {
  const result = await moderateHostRequest(id, status, patch);
  return result.hostRequests || [];
}

export async function loadAuditLog() {
  return readLocalList(AUDIT_LOG_KEY);
}

export async function appendAuditLog(entry) {
  const list = await loadAuditLog();
  const next = [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...entry }, ...list].slice(0, 100);
  writeLocalList(AUDIT_LOG_KEY, next);
  return next;
}


export async function verifySessionToken({ role, token = '', accessCode = '' }) {
  if (!canAttemptRemote('session')) return { valid: false };
  try {
    const result = await remotePostJson({ action: 'verifySession', role, token, accessCode });
    return { valid: Boolean(result?.valid), accountId: result?.accountId || null, isAdm: Boolean(result?.isAdm), hostMembership: result?.hostMembership || null };
  } catch {
    return { valid: false };
  }
}

export async function exchangeHostAccessCode(accessCode) {
  if (!canAttemptRemote('session')) return null;
  try {
    const result = await remotePostJson({ action: 'exchangeHostAccessCode', accessCode });
    if (!result?.token) return null;
    return { token: result.token, accountId: result.accountId || null, hostMembership: result.hostMembership || null };
  } catch {
    return null;
  }
}


export async function loadLiveEvents() {
  return loadList('liveEvents', LIVE_EVENTS_KEY).then((list) => list.map(normalizeLiveEvent));
}

export async function saveLiveEvents(liveEvents) {
  await saveList('liveEvents', LIVE_EVENTS_KEY, (liveEvents || []).map(normalizeLiveEvent));
}

export async function loadLiveEventParticipants() {
  return loadList('liveEventParticipants', LIVE_EVENT_PARTICIPANTS_KEY).then((list) => list.map(normalizeLiveEventParticipant));
}

export async function saveLiveEventParticipants(participants) {
  await saveList('liveEventParticipants', LIVE_EVENT_PARTICIPANTS_KEY, (participants || []).map(normalizeLiveEventParticipant));
}

export async function createLiveEvent(liveEvent) {
  if (canAttemptRemote('liveEvents')) {
    try {
      const result = await remotePostJson({ action: 'createLiveEvent', liveEvent });
      if (result?.liveEvent) return normalizeLiveEvent(result.liveEvent);
    } catch (error) {
      markPending('liveEvents', await loadLiveEvents(), error instanceof Error ? error.message : String(error));
    }
  }
  const liveEvents = await loadLiveEvents();
  const nextLiveEvent = normalizeLiveEvent(liveEvent);
  nextLiveEvent.titleBase = nextLiveEvent.titleBase || nextLiveEvent.title;
  nextLiveEvent.title = resolveUniqueLiveEventTitle(nextLiveEvent.titleBase, liveEvents, nextLiveEvent.id);
  liveEvents.push(nextLiveEvent);
  await saveLiveEvents(liveEvents);
  return nextLiveEvent;
}

export async function joinLiveEvent({ liveEventId = '', joinCode = '', hostId = '', isLead = false }) {
  const token = getClientSessionToken();
  if (!hasRemote() || !token) throw new Error('An authenticated backend session is required to join a live event.');
  const result = await remotePostJson({ action: 'joinLiveEvent', liveEventId, joinCode, hostId, isLead, token });
  if (result?.participant) return normalizeLiveEventParticipant(result.participant);
  throw new Error(result?.error || 'Unable to join live event');
}

export async function publishLiveEventParticipantLocation({ liveEventId = '', hostId = '', capturedAt = new Date().toISOString(), lat, lng, latitude = lat, longitude = lng, speedKmh = 0, accuracyMeters = 0, isSharingEnabled = true }) {
  const token = getClientSessionToken();
  if (!hasRemote() || !token) throw new Error('An authenticated backend session is required to publish live locations.');
  const result = await remotePostJson({
    action: 'publishLiveEventParticipantLocation',
    liveEventId, hostId, capturedAt, lat: latitude, lng: longitude, latitude, longitude, speedKmh, accuracyMeters, isSharingEnabled, token
  });
  if (result?.participant) return normalizeLiveEventParticipant(result.participant);
  throw new Error(result?.error || 'Unable to publish live event location');
}
