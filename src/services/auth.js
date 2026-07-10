const AUTH_KEY = 'youth-montreal-auth-users';
const SESSION_KEY = 'youth-montreal-auth-session';

const ADM_EMAILS = new Set([
  'dmarkprogrammer@gmail.com',
  'davincicarnevale@gmail.com',
  'jato30.jato30@gmail.com',
  'danielm.b.barbosa@hotmail.com',
  'youthmontrealmvnmt@gmail.com'
]);

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function readUsers() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || '[]'); } catch { return []; }
}
function writeUsers(users) { localStorage.setItem(AUTH_KEY, JSON.stringify(users)); }

function hash(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return (h >>> 0).toString(16);
}

export function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}

export function logout() { localStorage.removeItem(SESSION_KEY); }

export function registerHostAccount({ email, password, fullName, hostName, type = 'new_host', targetHostId = '' }, hostRequests) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) return { ok: false, error: 'missing' };
  const users = readUsers();
  const existingIndex = users.findIndex((item) => item.email === normalizedEmail && item.role === 'host');
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const targetKey = type === 'join_existing_host' ? String(targetHostId || '').trim() : 'new_host';
  const requestTargetKey = (request) => (request.type === 'join_existing_host' ? String(request.targetHostId || request.hostId || '').trim() : 'new_host');
  const blocked = (hostRequests || []).some((request) => normalizeEmail(request.email || request.requesterEmail) === normalizedEmail
    && requestTargetKey(request) === targetKey
    && request.status === 'denied' && new Date(request.reviewedAt || request.updatedAt || request.createdAt || 0).getTime() >= thirtyDaysAgo);
  const pending = (hostRequests || []).some((request) => normalizeEmail(request.email || request.requesterEmail) === normalizedEmail && requestTargetKey(request) === targetKey && request.status === 'pending');
  if (blocked) return { ok: false, error: 'blocked' };
  if (pending) return { ok: false, error: 'pending' };

  if (existingIndex >= 0) {
    users[existingIndex] = {
      ...users[existingIndex],
      fullName: fullName || users[existingIndex].fullName || '',
      hostName: hostName || users[existingIndex].hostName || '',
      status: users[existingIndex].status === 'denied' ? 'pending' : users[existingIndex].status,
      passwordHash: hash(`${normalizedEmail}:${password}`),
      updatedAt: new Date().toISOString()
    };
    writeUsers(users);
    return { ok: true, accountId: users[existingIndex].id };
  }

  users.push({
    id: crypto.randomUUID(),
    email: normalizedEmail,
    fullName: fullName || '',
    hostName: hostName || '',
    role: 'host',
    status: 'pending',
    passwordHash: hash(`${normalizedEmail}:${password}`),
    createdAt: new Date().toISOString()
  });
  writeUsers(users);
  return { ok: true, accountId: users[users.length - 1].id };
}

export function login({ email, password, role }) {
  const normalizedEmail = normalizeEmail(email);
  const users = readUsers();
  const passwordHash = hash(`${normalizedEmail}:${password}`);

  let user = users.find((item) => item.email === normalizedEmail && item.passwordHash === passwordHash);
  if (!user && role === 'admin' && ADM_EMAILS.has(normalizedEmail)) {
    user = {
      id: crypto.randomUUID(),
      email: normalizedEmail,
      fullName: normalizedEmail,
      role: 'admin',
      status: 'active',
      passwordHash,
      createdAt: new Date().toISOString()
    };
    users.push(user);
    writeUsers(users);
  }

  if (!user) return { ok: false, error: 'invalid' };
  if (role === 'admin' && user.role !== 'admin') return { ok: false, error: 'invalid' };
  if (role === 'host' && user.role !== 'host') return { ok: false, error: 'invalid' };
  if (user.status !== 'active') return { ok: false, error: user.status === 'pending' ? 'pending' : 'denied' };

  const session = { userId: user.id, role: user.role, email: user.email, createdAt: new Date().toISOString() };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return { ok: true, session };
}

export function getHostAccountByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  return readUsers().find((item) => item.email === normalizedEmail && item.role === 'host') || null;
}

export function activateHostByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const users = readUsers();
  const idx = users.findIndex((item) => item.email === normalizedEmail && item.role === 'host');
  if (idx < 0) return;
  users[idx] = { ...users[idx], status: 'active', reviewedAt: new Date().toISOString() };
  writeUsers(users);
}

export function setHostReviewStatusByEmail(email, status) {
  const normalizedEmail = normalizeEmail(email);
  const users = readUsers();
  const idx = users.findIndex((item) => item.email === normalizedEmail && item.role === 'host');
  if (idx < 0) return;
  users[idx] = { ...users[idx], status, reviewedAt: new Date().toISOString() };
  writeUsers(users);
}
