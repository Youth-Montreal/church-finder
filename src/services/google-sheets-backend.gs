/**
 * Youth Montreal Host Finder - Backend Workspace
 * Canonical resources: account, host, hostMembership, hostRequest, liveEvent, liveEventParticipant, report
 */

const RESOURCE_CONFIG = {
  accounts: {
    sheetName: 'accounts',
    resourceAliases: ['account'],
    sheetAliases: ['account']
  },
  hosts: {
    sheetName: 'hosts',
    resourceAliases: ['host', 'church', 'churches'],
    sheetAliases: ['churches']
  },
  reports: {
    sheetName: 'reports',
    resourceAliases: ['report', 'suggestion', 'suggestions'],
    sheetAliases: ['suggestions']
  },
  hostMemberships: {
    sheetName: 'hostMemberships',
    resourceAliases: ['hostmembership', 'hostmemberships', 'host membership', 'host memberships'],
    sheetAliases: ['hostmembership', 'hostmemberships', 'host membership', 'host memberships']
  },
  hostRequests: {
    sheetName: 'hostRequests',
    resourceAliases: ['hostrequest', 'hostrequests', 'title request', 'title requests', 'titlerequest', 'titlerequests'],
    sheetAliases: ['hostrequest', 'hostrequests', 'title request', 'title requests', 'titlerequest', 'titlerequests']
  },
  liveEvents: {
    sheetName: 'liveEvents',
    resourceAliases: ['liveevent', 'liveevents', 'live event', 'live events'],
    sheetAliases: ['liveevent', 'liveevents', 'live event', 'live events']
  },
  liveEventParticipants: {
    sheetName: 'liveEventParticipants',
    resourceAliases: ['liveeventparticipant', 'liveeventparticipants', 'live event participant', 'live event participants'],
    sheetAliases: ['liveeventparticipant', 'liveeventparticipants', 'live event participant', 'live event participants']
  }
};

function canonicalizeResource(resource) {
  const resourceName = String(resource || '').trim().toLowerCase();
  if (!resourceName) return '';
  const directMatch = Object.keys(RESOURCE_CONFIG).find((key) => key.toLowerCase() === resourceName);
  if (directMatch) return directMatch;
  const match = Object.keys(RESOURCE_CONFIG).find((key) =>
    RESOURCE_CONFIG[key].resourceAliases.some((alias) => alias.toLowerCase() === resourceName)
  );
  return match || '';
}

function parseSheetPayload(sheet) {
  const raw = String(sheet.getRange(2, 1).getValue() || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function ensureJsonSheet(sheet) {
  if (!sheet) return;
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['data_json']);
    return;
  }
  const header = String(sheet.getRange(1, 1).getValue() || '').trim();
  if (!header) sheet.getRange(1, 1).setValue('data_json');
}

function resolveSheet(resource, spreadsheet) {
  const canonicalResource = canonicalizeResource(resource);
  if (!canonicalResource) return null;

  const config = RESOURCE_CONFIG[canonicalResource];
  const preferredSheet = spreadsheet.getSheetByName(config.sheetName);
  let sheet = preferredSheet;

  if (!sheet) {
    sheet = [config.sheetName, ...config.sheetAliases]
      .flatMap((name) => [name, name.toLowerCase(), name.toUpperCase(), toCamelCase(name)])
      .map((name) => spreadsheet.getSheetByName(name))
      .find(Boolean) || null;
  }

  if (!sheet) {
    sheet = spreadsheet.insertSheet(config.sheetName);
  } else if (sheet.getName() !== config.sheetName && !preferredSheet) {
    sheet.setName(config.sheetName);
  }

  ensureJsonSheet(sheet);
  return { resource: canonicalResource, sheet };
}

/**
 * Run this once in Apps Script editor to initialize sheets.
 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(RESOURCE_CONFIG).forEach((resource) => {
    const resolved = resolveSheet(resource, ss);
    if (resolved) ensureJsonSheet(resolved.sheet);
  });
}

function doGet(e) {
  const requestedResource = canonicalizeResource(e && e.parameter && e.parameter.resource);
  if (!requestedResource) return createResponse({ error: 'Resource not found' });

  // Private records are only available through authenticated POST actions.
  if (['accounts', 'reports', 'hostMemberships', 'hostRequests', 'liveEvents', 'liveEventParticipants'].indexOf(requestedResource) >= 0) {
    return createResponse({ error: 'Authenticated read required' });
  }

  let data = readResourceList(requestedResource);
  if (requestedResource === 'hosts') {
    data = data.map(function(host) {
      const publicHost = Object.assign({}, host);
      // Legacy access codes are no longer credentials and must never be public.
      delete publicHost.hostPasscode;
      delete publicHost.hostAccessCode;
      return publicHost;
    });
  }
  const result = {};
  result[requestedResource] = data;
  return createResponse(result);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    switch (body.action) {
      case 'login': return createResponse(handleLogin(body));
      case 'registerHostAccount': return createResponse(handleRegisterHostAccount(body));
      case 'verifySession': return createResponse(handleVerifySession(body));
      case 'logout': return createResponse(handleLogout(body));
      case 'readResource': return createResponse(handleReadResource(body));
      case 'moderateHostRequest': return createResponse(handleModerateHostRequest(body));
      case 'submitReport': return createResponse(handleSubmitReport(body));
      case 'updateReportStatus': return createResponse(handleUpdateReportStatus(body));
      case 'createLiveEvent': return createResponse(handleCreateLiveEvent(body));
      case 'joinLiveEvent': return createResponse(handleJoinLiveEvent(body));
      case 'publishLiveEventParticipantLocation': return createResponse(handlePublishLiveEventParticipantLocation(body));
      default: return createResponse(handleResourceWrite(body));
    }
  } catch (err) {
    return createResponse({ error: String(err && err.message ? err.message : err) });
  }
}

function initializeAuthPepper() {
  const properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty('AUTH_PEPPER')) {
    properties.setProperty('AUTH_PEPPER', Utilities.getUuid() + Utilities.getUuid());
  }
  return 'Auth pepper is initialized.';
}

/**
 * Provision one allowlisted ADM using the one-time ADM_BOOTSTRAP_CREDENTIALS
 * Script Property. The property must be JSON: {"email":"...","password":"...","fullName":"..."}.
 * After successful provisioning, the bootstrap property is deleted.
 */
function provisionAdmFromScriptProperties() {
  return withScriptLock(function() {
    const properties = PropertiesService.getScriptProperties();
    const raw = properties.getProperty('ADM_BOOTSTRAP_CREDENTIALS');
    if (!raw) throw new Error('Set ADM_BOOTSTRAP_CREDENTIALS in Script Properties first.');
    if (!properties.getProperty('AUTH_PEPPER')) throw new Error('Run initializeAuthPepper first.');

    const input = JSON.parse(raw);
    const email = normalizeAuthEmail(input.email);
    const password = String(input.password || '');
    if (ADM_ALLOWLIST.indexOf(email) < 0) throw new Error('Email is not in the server-side ADM allowlist.');
    if (password.length < 8) throw new Error('ADM password must be at least 8 characters.');

    const accounts = readResourceList('accounts');
    const index = accounts.findIndex(function(item) { return normalizeAuthEmail(item.email) === email; });
    const now = new Date().toISOString();
    const previous = index >= 0 ? accounts[index] : {};
    const salt = Utilities.getUuid() + Utilities.getUuid();
    const account = Object.assign({}, previous, {
      id: previous.id || Utilities.getUuid(),
      email: email,
      fullName: String(input.fullName || email),
      role: 'adm',
      status: 'active',
      passwordSalt: salt,
      passwordHash: hashPassword(password, salt),
      sessions: [],
      createdAt: previous.createdAt || now,
      updatedAt: now
    });
    if (index >= 0) accounts[index] = account; else accounts.push(account);
    writeResourceList('accounts', accounts);
    properties.deleteProperty('ADM_BOOTSTRAP_CREDENTIALS');
    return 'Provisioned ADM account: ' + email;
  });
}

function normalizeAuthEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getAuthPepper() {
  const pepper = PropertiesService.getScriptProperties().getProperty('AUTH_PEPPER');
  if (!pepper) throw new Error('AUTH_PEPPER_NOT_CONFIGURED; run initializeAuthPepper in Apps Script first.');
  return pepper;
}

function bytesToHex(bytes) {
  return bytes.map(function(value) {
    const part = (value & 255).toString(16);
    return part.length === 1 ? '0' + part : part;
  }).join('');
}

function hashPassword(password, salt) {
  return bytesToHex(Utilities.computeHmacSha256Signature(String(password) + ':' + String(salt), getAuthPepper()));
}

function hashSessionToken(token) {
  return bytesToHex(Utilities.computeHmacSha256Signature(String(token || ''), getAuthPepper()));
}

function withScriptLock(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function isAllowlistedAdmEmail(email) {
  return ADM_ALLOWLIST.indexOf(normalizeAuthEmail(email)) >= 0;
}

function activeMembershipsForAccount(accountId) {
  return readResourceList('hostMemberships').filter(function(item) {
    return item.accountId === accountId && item.status === 'active';
  });
}

function findSessionActor(token) {
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const accounts = readResourceList('accounts');
  const now = Date.now();
  for (let i = 0; i < accounts.length; i += 1) {
    const account = accounts[i];
    const sessions = Array.isArray(account.sessions) ? account.sessions : [];
    const session = sessions.find(function(item) {
      return item.tokenHash === tokenHash && new Date(item.expiresAt || 0).getTime() > now;
    });
    if (!session || account.status !== 'active') continue;

    if (account.role === 'adm') {
      if (!isAllowlistedAdmEmail(account.email)) return null;
      return { account: account, session: session, memberships: readResourceList('hostMemberships').filter(function(item) { return item.status === 'active'; }) };
    }
    if (account.role === 'host') {
      const memberships = activeMembershipsForAccount(account.id);
      if (!memberships.length) return null;
      return { account: account, session: session, memberships: memberships };
    }
  }
  return null;
}

function sessionSnapshot(actor, token) {
  return {
    token: token || '',
    accountId: actor.account.id,
    email: actor.account.email,
    fullName: actor.account.fullName || '',
    role: actor.account.role,
    expiresAt: actor.session.expiresAt,
    hostMemberships: actor.memberships.map(function(item) {
      return {
        id: item.id,
        accountId: item.accountId,
        hostId: item.hostId,
        role: item.role || 'manager',
        status: item.status
      };
    })
  };
}

function loginRateLimitKey(email) {
  return 'AUTH_LOGIN_FAILURES_' + hashSessionToken(normalizeAuthEmail(email));
}

function isLoginRateLimited(email) {
  const properties = PropertiesService.getScriptProperties();
  const key = loginRateLimitKey(email);
  const raw = properties.getProperty(key);
  if (!raw) return false;
  let record;
  try {
    record = JSON.parse(raw);
  } catch (error) {
    properties.deleteProperty(key);
    return false;
  }
  const now = Date.now();
  if (record.lockedUntil && Number(record.lockedUntil) > now) return true;
  if (!record.windowStartedAt || now - Number(record.windowStartedAt) > 15 * 60 * 1000) {
    properties.deleteProperty(key);
    return false;
  }
  return Number(record.attempts) >= 8;
}

function recordLoginFailure(email) {
  const properties = PropertiesService.getScriptProperties();
  const key = loginRateLimitKey(email);
  const now = Date.now();
  let record;
  try {
    record = JSON.parse(properties.getProperty(key) || 'null');
  } catch (error) {
    record = null;
  }
  if (!record || !record.windowStartedAt || now - Number(record.windowStartedAt) > 15 * 60 * 1000) {
    record = { windowStartedAt: now, attempts: 0, lockedUntil: 0 };
  }
  record.attempts = Number(record.attempts || 0) + 1;
  if (record.attempts >= 8) record.lockedUntil = now + 15 * 60 * 1000;
  properties.setProperty(key, JSON.stringify(record));
}

function clearLoginFailures(email) {
  PropertiesService.getScriptProperties().deleteProperty(loginRateLimitKey(email));
}

function handleLogin(body) {
  return withScriptLock(function() {
    const email = normalizeAuthEmail(body.email);
    const password = String(body.password || '');
    const requestedRole = body.role === 'admin' || body.role === 'adm' ? 'adm' : body.role;
    if (!email || !password || (requestedRole !== 'adm' && requestedRole !== 'host')) {
      return { ok: false, error: 'invalid' };
    }
    if (isLoginRateLimited(email)) return { ok: false, error: 'invalid' };

    const accounts = readResourceList('accounts');
    const index = accounts.findIndex(function(item) { return normalizeAuthEmail(item.email) === email; });
    if (index < 0) { recordLoginFailure(email); return { ok: false, error: 'invalid' }; }
    const account = accounts[index];
    if (account.role !== requestedRole) { recordLoginFailure(email); return { ok: false, error: 'invalid' }; }
    if (requestedRole === 'adm' && !isAllowlistedAdmEmail(email)) { recordLoginFailure(email); return { ok: false, error: 'invalid' }; }
    if (String(account.passwordHash || '') !== hashPassword(password, account.passwordSalt || '')) { recordLoginFailure(email); return { ok: false, error: 'invalid' }; }
    if (account.status !== 'active') {
      return { ok: false, error: account.status === 'pending' ? 'pending' : 'denied' };
    }

    clearLoginFailures(email);
    const memberships = requestedRole === 'host' ? activeMembershipsForAccount(account.id) : [];
    if (requestedRole === 'host' && !memberships.length) return { ok: false, error: 'pending' };

    const token = Utilities.getUuid() + Utilities.getUuid();
    const now = Date.now();
    const issuedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString();
    const sessions = (Array.isArray(account.sessions) ? account.sessions : []).filter(function(item) {
      return new Date(item.expiresAt || 0).getTime() > now;
    });
    sessions.push({ tokenHash: hashSessionToken(token), issuedAt: issuedAt, expiresAt: expiresAt });
    account.sessions = sessions;
    account.updatedAt = issuedAt;
    accounts[index] = account;
    writeResourceList('accounts', accounts);

    const actor = {
      account: account,
      session: sessions[sessions.length - 1],
      memberships: requestedRole === 'adm' ? readResourceList('hostMemberships').filter(function(item) { return item.status === 'active'; }) : memberships
    };
    return { ok: true, session: sessionSnapshot(actor, token) };
  });
}

function handleVerifySession(body) {
  const actor = findSessionActor(body.token);
  if (!actor) return { valid: false };
  return { valid: true, session: sessionSnapshot(actor, body.token) };
}

function handleLogout(body) {
  if (!body.token) return { ok: true };
  return withScriptLock(function() {
    const tokenHash = hashSessionToken(body.token);
    const accounts = readResourceList('accounts');
    let changed = false;
    accounts.forEach(function(account) {
      const previous = Array.isArray(account.sessions) ? account.sessions : [];
      const next = previous.filter(function(item) { return item.tokenHash !== tokenHash; });
      if (next.length !== previous.length) {
        account.sessions = next;
        changed = true;
      }
    });
    if (changed) writeResourceList('accounts', accounts);
    return { ok: true };
  });
}

function handleReadResource(body) {
  const actor = findSessionActor(body.token);
  if (!actor) return { ok: false, reason: 'unauthorized' };
  const resource = canonicalizeResource(body.resource);
  if (!resource || resource === 'accounts') return { ok: false, reason: 'forbidden' };

  let list = readResourceList(resource);
  const isAdm = actor.account.role === 'adm' && isAllowlistedAdmEmail(actor.account.email);
  const hostIds = actor.memberships.map(function(item) { return item.hostId; });

  if (resource === 'hostRequests' && !isAdm) return { ok: false, reason: 'forbidden' };
  if (resource === 'reports' && !isAdm) {
    list = list.filter(function(item) { return item.hostId && hostIds.indexOf(item.hostId) >= 0; });
  } else if (resource === 'hostMemberships' && !isAdm) {
    list = list.filter(function(item) { return item.accountId === actor.account.id; });
  } else if (resource === 'liveEventParticipants' && !isAdm) {
    list = list.filter(function(item) { return hostIds.indexOf(item.hostId) >= 0; });
  } else if (resource === 'liveEvents') {
    list = list.filter(function(item) {
      return item.status === 'active' && (isAdm || hostIds.indexOf(item.createdByHostId) >= 0);
    });
  }

  const result = { ok: true };
  result[resource] = list;
  return result;
}

function handleResourceWrite(body) {
  const resource = canonicalizeResource(body.resource);
  if (!resource) return { ok: false, reason: 'resource_not_found' };
  if (resource === 'hosts') return handleWriteHosts(body);
  if (resource === 'liveEvents') {
    const actor = findSessionActor(body.token);
    if (!actor || actor.account.role !== 'adm' || !isAllowlistedAdmEmail(actor.account.email)) {
      return { ok: false, reason: 'forbidden' };
    }
    if (!Array.isArray(body.payload)) return { ok: false, reason: 'invalid_payload' };
    writeResourceList('liveEvents', body.payload);
    return { ok: true, resource: resource };
  }
  // Accounts, memberships, requests, reports and participants are action-only.
  return { ok: false, reason: 'action_required' };
}

function handleWriteHosts(body) {
  return withScriptLock(function() {
    const actor = findSessionActor(body.token);
    if (!actor) return { ok: false, reason: 'unauthorized' };
    if (!Array.isArray(body.payload)) return { ok: false, reason: 'invalid_payload' };

    if (actor.account.role === 'adm' && isAllowlistedAdmEmail(actor.account.email)) {
      writeResourceList('hosts', body.payload);
      return { ok: true, resource: 'hosts' };
    }

    const allowedHostIds = actor.memberships.map(function(item) { return item.hostId; });
    const current = readResourceList('hosts');
    const existingIds = current.map(function(item) { return item.id; });
    if (body.payload.some(function(item) { return !item.id || existingIds.indexOf(item.id) < 0; })) {
      return { ok: false, reason: 'host_creation_requires_adm' };
    }

    const incomingById = {};
    body.payload.forEach(function(item) { incomingById[item.id] = item; });
    const next = current.map(function(host) {
      if (allowedHostIds.indexOf(host.id) >= 0 && incomingById[host.id]) return incomingById[host.id];
      return host;
    });
    writeResourceList('hosts', next);
    return { ok: true, resource: 'hosts' };
  });
}

function handleRegisterHostAccount(body) {
  return withScriptLock(function() {
    const email = normalizeAuthEmail(body.email);
    const password = String(body.password || '');
    const type = body.type === 'join_existing_host' ? 'join_existing_host' : 'new_host';
    const targetHostId = type === 'join_existing_host' ? String(body.targetHostId || '').trim() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) return { ok: false, error: 'invalid' };
    getAuthPepper();

    if (type === 'join_existing_host' && !readResourceList('hosts').some(function(host) { return host.id === targetHostId; })) {
      return { ok: false, error: 'target_host_not_found' };
    }

    const accounts = readResourceList('accounts');
    const requests = readResourceList('hostRequests');
    let accountIndex = accounts.findIndex(function(item) { return normalizeAuthEmail(item.email) === email; });
    let account = accountIndex >= 0 ? accounts[accountIndex] : null;
    if (account && account.role !== 'host') return { ok: false, error: 'invalid' };
    if (account && String(account.passwordHash || '') !== hashPassword(password, account.passwordSalt || '')) return { ok: false, error: 'invalid' };

    const now = Date.now();
    const targetKey = type === 'join_existing_host' ? targetHostId : 'new_host';
    const requestTargetKey = function(request) {
      return request.type === 'join_existing_host' ? String(request.targetHostId || request.hostId || '').trim() : 'new_host';
    };
    const deniedRecently = requests.some(function(request) {
      const reviewedAt = new Date(request.reviewedAt || request.updatedAt || request.createdAt || 0).getTime();
      return normalizeAuthEmail(request.requesterEmail || request.email) === email
        && requestTargetKey(request) === targetKey
        && request.status === 'denied'
        && reviewedAt >= now - 30 * 24 * 60 * 60 * 1000;
    });
    if (deniedRecently) return { ok: false, error: 'blocked' };

    const pending = requests.some(function(request) {
      return normalizeAuthEmail(request.requesterEmail || request.email) === email
        && requestTargetKey(request) === targetKey
        && (request.status === 'pending' || request.status === 'contacting');
    });
    if (pending) return { ok: false, error: 'pending' };

    const timestamp = new Date().toISOString();
    if (!account) {
      const salt = Utilities.getUuid() + Utilities.getUuid();
      account = {
        id: Utilities.getUuid(),
        email: email,
        fullName: String(body.fullName || ''),
        role: 'host',
        status: 'pending',
        passwordSalt: salt,
        passwordHash: hashPassword(password, salt),
        sessions: [],
        createdAt: timestamp,
        updatedAt: timestamp
      };
      accounts.push(account);
      accountIndex = accounts.length - 1;
    } else {
      const hasMembership = activeMembershipsForAccount(account.id).length > 0;
      if (account.status === 'denied') account.status = hasMembership ? 'active' : 'pending';
      account.fullName = String(body.fullName || account.fullName || '');
      account.updatedAt = timestamp;
      accounts[accountIndex] = account;
    }

    const request = {
      id: Utilities.getUuid(),
      fullName: String(body.fullName || ''),
      hostName: String(body.hostName || body.organization || ''),
      organization: String(body.organization || ''),
      position: String(body.position || ''),
      phone: String(body.phone || ''),
      message: String(body.message || body.details || ''),
      type: type,
      targetHostId: targetHostId,
      requesterAccountId: account.id,
      requesterEmail: email,
      email: email,
      status: 'pending',
      createdAt: timestamp
    };

    writeResourceList('accounts', accounts);
    requests.push(request);
    writeResourceList('hostRequests', requests);
    return { ok: true, accountId: account.id, hostRequest: request };
  });
}

function handleModerateHostRequest(body) {
  return withScriptLock(function() {
    const actor = findSessionActor(body.token);
    if (!actor || actor.account.role !== 'adm' || !isAllowlistedAdmEmail(actor.account.email)) {
      return { ok: false, reason: 'forbidden' };
    }

    const requests = readResourceList('hostRequests');
    const requestIndex = requests.findIndex(function(item) { return item.id === body.id; });
    if (requestIndex < 0) return { ok: false, reason: 'not_found' };
    const request = requests[requestIndex];
    const status = String(body.status || '');
    if (['pending', 'contacting', 'approved', 'denied'].indexOf(status) < 0) return { ok: false, reason: 'invalid_status' };

    const hosts = readResourceList('hosts');
    const memberships = readResourceList('hostMemberships');
    const accounts = readResourceList('accounts');
    const accountIndex = accounts.findIndex(function(item) { return item.id === (request.requesterAccountId || request.accountId); });
    if (accountIndex < 0) return { ok: false, reason: 'account_not_found' };
    const account = accounts[accountIndex];
    let host = null;
    let membership = null;

    if (status === 'approved') {
      if (request.status === 'approved' && request.targetHostId) {
        host = hosts.find(function(item) { return item.id === request.targetHostId; }) || null;
        membership = memberships.find(function(item) {
          return item.accountId === account.id && item.hostId === request.targetHostId && item.status === 'active';
        }) || null;
      }

      if (!membership) {
        let targetHostId = request.type === 'join_existing_host'
          ? String(request.targetHostId || '').trim()
          : String(request.hostId || request.targetHostId || '').trim();

        if (request.type === 'join_existing_host') {
          host = hosts.find(function(item) { return item.id === targetHostId; }) || null;
          if (!host) return { ok: false, reason: 'target_host_not_found' };
        } else {
          if (!targetHostId) targetHostId = Utilities.getUuid();
          host = hosts.find(function(item) { return item.id === targetHostId; }) || null;
          if (!host) {
            host = {
              id: targetHostId,
              hostPasscode: '',
              name: String(request.hostName || account.fullName || 'New host'),
              address: '',
              googleMapsUrl: '',
              googlePlaceId: '',
              lat: 45.5017,
              lng: -73.5673,
              languages: [],
              website: '',
              instagram: '',
              facebook: '',
              whatsapp: '',
              events: []
            };
            hosts.push(host);
            writeResourceList('hosts', hosts);
          }
        }

        const now = new Date().toISOString();
        const existingMembershipIndex = memberships.findIndex(function(item) {
          return item.accountId === account.id && item.hostId === targetHostId;
        });
        membership = existingMembershipIndex >= 0 ? memberships[existingMembershipIndex] : {
          id: Utilities.getUuid(),
          accountId: account.id,
          hostId: targetHostId,
          role: 'manager',
          createdAt: now
        };
        membership.status = 'active';
        membership.role = 'manager';
        membership.sourceRequestId = request.id;
        membership.updatedByAccountId = actor.account.id;
        membership.updatedAt = now;
        if (existingMembershipIndex >= 0) memberships[existingMembershipIndex] = membership;
        else memberships.push(membership);

        // Repair any legacy duplicate rows for this account/host pair.
        const dedupedMemberships = [];
        let keptPair = false;
        memberships.forEach(function(item) {
          if (item.accountId === account.id && item.hostId === targetHostId) {
            if (!keptPair) {
              dedupedMemberships.push(membership);
              keptPair = true;
            }
          } else {
            dedupedMemberships.push(item);
          }
        });
        writeResourceList('hostMemberships', dedupedMemberships);
        account.status = 'active';
        account.reviewedAt = now;
        account.updatedAt = now;
        accounts[accountIndex] = account;
        writeResourceList('accounts', accounts);
        request.targetHostId = targetHostId;
      }
    } else if (status === 'denied') {
      const now = new Date().toISOString();
      const hasActiveMembership = memberships.some(function(item) {
        return item.accountId === account.id && item.status === 'active';
      });
      if (!hasActiveMembership) {
        account.status = 'denied';
        account.sessions = [];
        account.reviewedAt = now;
        account.updatedAt = now;
        accounts[accountIndex] = account;
        writeResourceList('accounts', accounts);
      }
    }

    request.status = status;
    request.reviewedAt = new Date().toISOString();
    request.reviewedByAccountId = actor.account.id;
    requests[requestIndex] = request;
    writeResourceList('hostRequests', requests);

    const finalHosts = readResourceList('hosts');
    const finalMemberships = readResourceList('hostMemberships');
    const finalRequests = readResourceList('hostRequests');
    return {
      ok: true,
      hostRequest: request,
      host: host,
      hostMembership: membership,
      hosts: finalHosts,
      hostMemberships: finalMemberships,
      hostRequests: finalRequests
    };
  });
}

function handleSubmitReport(body) {
  return withScriptLock(function() {
    const input = body.report && typeof body.report === 'object' ? body.report : {};
    const reports = readResourceList('reports');
    const now = new Date().toISOString();
    const report = Object.assign({}, input, {
      id: input.id || Utilities.getUuid(),
      status: 'pending',
      createdAt: input.createdAt || now
    });
    delete report.password;
    delete report.token;
    reports.push(report);
    writeResourceList('reports', reports);
    return { ok: true, report: report };
  });
}

function handleUpdateReportStatus(body) {
  return withScriptLock(function() {
    const actor = findSessionActor(body.token);
    if (!actor) return { ok: false, reason: 'unauthorized' };
    const reports = readResourceList('reports');
    const index = reports.findIndex(function(item) { return item.id === body.id; });
    if (index < 0) return { ok: false, reason: 'not_found' };

    const isAdm = actor.account.role === 'adm' && isAllowlistedAdmEmail(actor.account.email);
    if (!isAdm) {
      const memberships = actor.memberships;
      if (!reports[index].hostId || !memberships.some(function(item) { return item.hostId === reports[index].hostId; })) {
        return { ok: false, reason: 'forbidden' };
      }
    }

    reports[index] = Object.assign({}, reports[index], {
      status: String(body.status || 'pending'),
      reviewedAt: new Date().toISOString(),
      reviewedByAccountId: actor.account.id
    });
    writeResourceList('reports', reports);

    const allowedHostIds = actor.memberships.map(function(item) { return item.hostId; });
    const visibleReports = isAdm ? reports : reports.filter(function(item) {
      return item.hostId && allowedHostIds.indexOf(item.hostId) >= 0;
    });
    return { ok: true, reports: visibleReports };
  });
}

function normalizeLiveEvent(entry) {
  const now = new Date().toISOString();
  const titleBase = String(entry && (entry.titleBase || entry.title) || '').trim() || 'Live Event';
  return {
    id: entry && entry.id || Utilities.getUuid(),
    title: String(entry && entry.title || titleBase).trim(),
    titleBase: titleBase,
    description: String(entry && entry.description || ''),
    status: entry && entry.status || 'active',
    joinCode: String(entry && entry.joinCode || '').trim(),
    createdByAccountId: String(entry && entry.createdByAccountId || ''),
    createdByHostId: String(entry && entry.createdByHostId || ''),
    startedAt: entry && entry.startedAt || now,
    endedAt: entry && entry.endedAt || '',
    filters: entry && entry.filters && typeof entry.filters === 'object' ? entry.filters : {}
  };
}

function normalizeLiveEventParticipant(entry) {
  return {
    liveEventId: String(entry && entry.liveEventId || ''),
    hostId: String(entry && entry.hostId || ''),
    accountId: String(entry && entry.accountId || ''),
    isLead: Boolean(entry && entry.isLead),
    joinedAt: entry && entry.joinedAt || new Date().toISOString(),
    capturedAt: entry && (entry.capturedAt || entry.lastLocationAt) || '',
    lastLocationAt: entry && (entry.lastLocationAt || entry.capturedAt) || '',
    lat: Number(entry && (entry.lat || entry.latitude)) || null,
    lng: Number(entry && (entry.lng || entry.longitude)) || null,
    latitude: Number(entry && (entry.latitude || entry.lat)) || null,
    longitude: Number(entry && (entry.longitude || entry.lng)) || null,
    accuracyMeters: Number(entry && entry.accuracyMeters) || 0,
    speedKmh: Number(entry && entry.speedKmh) || 0,
    isSharingEnabled: !(entry && entry.isSharingEnabled === false)
  };
}

function resolveUniqueLiveEventTitle(titleBase, liveEvents, currentId) {
  const normalizedBase = String(titleBase || '').trim() || 'Live Event';
  const activeTitles = (liveEvents || [])
    .filter(function(event) { return event.status === 'active' && event.id !== currentId; })
    .map(function(event) { return String(event.title || '').trim().toLowerCase(); });
  let candidate = normalizedBase;
  let suffix = 2;
  while (activeTitles.indexOf(candidate.toLowerCase()) >= 0) {
    candidate = normalizedBase + ' (' + suffix + ')';
    suffix += 1;
  }
  return candidate;
}

function isAdmAccount(accountId) {
  const accounts = readResourceList('accounts');
  const account = accounts.find(function(item) { return item.id === accountId; });
  return Boolean(account && account.role === 'adm' && account.status === 'active' && isAllowlistedAdmEmail(account.email));
}

function isActiveHostMember(accountId, hostId) {
  const memberships = readResourceList('hostMemberships');
  return memberships.some(function(item) {
    return item.accountId === accountId && item.hostId === hostId && item.status === 'active';
  });
}

function handleCreateLiveEvent(body) {
  return withScriptLock(function() {
    const actor = findSessionActor(body.token);
    if (!actor) return { ok: false, error: 'unauthorized' };
    const input = body.liveEvent || {};
    const hostId = String(input.createdByHostId || '');
    const isAdm = actor.account.role === 'adm' && isAllowlistedAdmEmail(actor.account.email);
    if (!isAdm && !isActiveHostMember(actor.account.id, hostId)) return { ok: false, error: 'forbidden' };

    const liveEvents = readResourceList('liveEvents').map(normalizeLiveEvent);
    const liveEvent = normalizeLiveEvent(Object.assign({}, input, {
      createdByAccountId: actor.account.id,
      createdByHostId: hostId
    }));
    liveEvent.titleBase = liveEvent.titleBase || liveEvent.title;
    liveEvent.title = resolveUniqueLiveEventTitle(liveEvent.titleBase, liveEvents, liveEvent.id);
    liveEvents.push(liveEvent);
    writeResourceList('liveEvents', liveEvents);
    return { ok: true, liveEvent: liveEvent };
  });
}

function handleJoinLiveEvent(body) {
  return withScriptLock(function() {
    const actor = findSessionActor(body.token);
    if (!actor) return { ok: false, error: 'unauthorized' };
    const liveEvents = readResourceList('liveEvents').map(normalizeLiveEvent);
    const liveEvent = liveEvents.find(function(event) { return event.id === body.liveEventId && event.status === 'active'; });
    if (!liveEvent) return { ok: false, error: 'live_event_not_found' };

    const isAdm = actor.account.role === 'adm' && isAllowlistedAdmEmail(actor.account.email);
    const hostId = String(body.hostId || '');
    if (!isAdm && !actor.memberships.some(function(item) { return item.hostId === hostId; })) {
      return { ok: false, error: 'host_membership_required' };
    }
    if (!isAdm && liveEvent.joinCode !== String(body.joinCode || '').trim()) return { ok: false, error: 'invalid_join_code' };

    const participants = readResourceList('liveEventParticipants').map(normalizeLiveEventParticipant);
    const participant = normalizeLiveEventParticipant({
      liveEventId: liveEvent.id,
      hostId: hostId,
      accountId: actor.account.id,
      isLead: isAdm && Boolean(body.isLead)
    });
    const next = participants.filter(function(item) {
      return !(item.liveEventId === participant.liveEventId && item.hostId === participant.hostId && item.accountId === participant.accountId);
    });
    next.push(participant);
    writeResourceList('liveEventParticipants', next);
    return { ok: true, participant: participant };
  });
}

function handlePublishLiveEventParticipantLocation(body) {
  return withScriptLock(function() {
    const actor = findSessionActor(body.token);
    if (!actor) return { ok: false, error: 'unauthorized' };
    const accountId = actor.account.id;
    const hostId = String(body.hostId || '');
    const isAdm = actor.account.role === 'adm' && isAllowlistedAdmEmail(actor.account.email);
    if (!isAdm && !actor.memberships.some(function(item) { return item.hostId === hostId; })) {
      return { ok: false, error: 'host_membership_required' };
    }

    const liveEvents = readResourceList('liveEvents').map(normalizeLiveEvent);
    if (!liveEvents.some(function(event) { return event.id === body.liveEventId && event.status === 'active'; })) {
      return { ok: false, error: 'live_event_not_found' };
    }
    const participants = readResourceList('liveEventParticipants').map(normalizeLiveEventParticipant);
    const index = participants.findIndex(function(item) {
      return item.liveEventId === body.liveEventId && item.hostId === hostId && item.accountId === accountId;
    });
    const existing = index >= 0 ? participants[index] : null;
    const capturedAt = body.capturedAt || new Date().toISOString();
    const capturedTime = new Date(capturedAt).getTime();
    const existingTime = new Date(existing && (existing.capturedAt || existing.lastLocationAt) || 0).getTime();
    if (existing && !isNaN(existingTime) && !isNaN(capturedTime) && capturedTime <= existingTime) {
      return { ok: false, error: 'stale_or_out_of_order_location' };
    }

    const participant = normalizeLiveEventParticipant(existing || {
      liveEventId: body.liveEventId,
      hostId: hostId,
      accountId: accountId
    });
    participant.capturedAt = capturedAt;
    participant.lastLocationAt = capturedAt;
    participant.lat = Number(body.lat || body.latitude);
    participant.lng = Number(body.lng || body.longitude);
    participant.latitude = participant.lat;
    participant.longitude = participant.lng;
    participant.accuracyMeters = Number(body.accuracyMeters) || 0;
    participant.speedKmh = Number(body.speedKmh) || 0;
    participant.isSharingEnabled = body.isSharingEnabled !== false;
    if (index >= 0) participants[index] = participant; else participants.push(participant);
    writeResourceList('liveEventParticipants', participants);
    return { ok: true, participant: participant };
  });
}

function toCamelCase(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  return normalized.replace(/[-_\s]+(.)/g, (_, group) => group.toUpperCase());
}

function readResourceList(resource) {
  const resolved = resolveSheet(resource, SpreadsheetApp.getActiveSpreadsheet());
  if (!resolved) return [];
  return parseSheetPayload(resolved.sheet);
}

function writeResourceList(resource, list) {
  const resolved = resolveSheet(resource, SpreadsheetApp.getActiveSpreadsheet());
  if (!resolved) return;
  resolved.sheet.getRange(2, 1).setValue(JSON.stringify(Array.isArray(list) ? list : []));
}

function createResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

const ADM_ALLOWLIST = [
  'dmarkprogrammer@gmail.com',
  'davincicarnevale@gmail.com',
  'jato30.jato30@gmail.com',
  'danielm.b.barbosa@hotmail.com',
  'youthmontrealmvnmt@gmail.com'
];
