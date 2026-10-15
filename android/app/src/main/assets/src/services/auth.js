import {
  loginWithBackend,
  registerHostAccountWithBackend,
  verifyBackendSession,
  logoutBackendSession
} from './repository.js';

const SESSION_KEY = 'youth-montreal-auth-session';

function readSessionToken() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (typeof saved === 'string') return saved;
    return typeof saved?.token === 'string' ? saved.token : '';
  } catch {
    return '';
  }
}

function storeSessionToken(token) {
  if (token) localStorage.setItem(SESSION_KEY, JSON.stringify({ token }));
  else localStorage.removeItem(SESSION_KEY);
}

/**
 * The browser stores only a bearer token. Identity, role, status and membership
 * authority are reloaded from the backend and are never inferred from localStorage.
 */
export function getSession() {
  const token = readSessionToken();
  return token ? { token } : null;
}

export async function restoreSession() {
  const token = readSessionToken();
  if (!token) return null;
  const session = await verifyBackendSession(token);
  if (!session?.role || !session?.accountId) {
    storeSessionToken('');
    return null;
  }
  // Keep only the bearer token in persistent browser storage.
  storeSessionToken(session.token || token);
  return session;
}

export async function logout() {
  const token = readSessionToken();
  try {
    await logoutBackendSession(token);
  } finally {
    storeSessionToken('');
  }
}

export async function registerHostAccount(data, _hostRequests = []) {
  const response = await registerHostAccountWithBackend(data || {});
  if (response?.ok) return response;
  const error = response?.error || 'backend_unavailable';
  return { ok: false, error };
}

export async function login({ email, password, role }) {
  const response = await loginWithBackend({ email, password, role });
  if (!response?.ok || !response.session?.token) {
    return { ok: false, error: response?.error || 'backend_unavailable' };
  }

  storeSessionToken(response.session.token);
  return { ok: true, session: response.session };
}
