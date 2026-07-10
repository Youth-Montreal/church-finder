/**
 * Youth Montreal Host Finder - Backend Workspace
 * Canonical resources: account, host, hostMembership, hostRequest, liveEvent, liveEventParticipant, report
 */

const RESOURCE_CONFIG = {
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
  hostRequests: {
    sheetName: 'hostRequests',
    resourceAliases: ['hostrequest', 'hostrequests', 'title request', 'title requests', 'titlerequest', 'titlerequests'],
    sheetAliases: ['hostrequest', 'hostrequests', 'title request', 'title requests', 'titlerequest', 'titlerequests']
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
  const resolved = resolveSheet(e.parameter.resource, SpreadsheetApp.getActiveSpreadsheet());
  if (!resolved) return createResponse({ error: 'Resource not found' });

  const data = parseSheetPayload(resolved.sheet);

  const result = {};
  result[resolved.resource] = data;
  return createResponse(result);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'verifySession') return createResponse(handleVerifySession(body));
    if (body.action === 'exchangeHostAccessCode') return createResponse(handleExchangeHostAccessCode(body));
    const resolved = resolveSheet(body.resource, SpreadsheetApp.getActiveSpreadsheet());
    if (!resolved) return createResponse({ error: 'Resource not found' });
    resolved.sheet.getRange(2, 1).setValue(JSON.stringify(body.payload));
    return createResponse({ success: true, resource: resolved.resource });
  } catch (err) {
    return createResponse({ error: err.toString() });
  }
}

function handleVerifySession(body) {
  if (body.role === 'adm') {
    const accounts = readResourceList('accounts');
    const account = accounts.find((item) => item.admAccessCode === body.accessCode);
    return { valid: Boolean(account), isAdm: Boolean(account && ADM_ALLOWLIST.includes(String(account.email || '').toLowerCase())), accountId: account ? account.id : null };
  }
  if (body.role === 'host') {
    const memberships = readResourceList('hostMemberships');
    const session = memberships.find((item) => item.sessionToken === body.token && item.status !== 'revoked');
    return { valid: Boolean(session), accountId: session ? session.accountId : null, hostMembership: session || null };
  }
  return { valid: false };
}

function handleExchangeHostAccessCode(body) {
  const memberships = readResourceList('hostMemberships');
  const membership = memberships.find((item) => item.hostAccessCode === body.accessCode && item.status !== 'revoked');
  if (!membership) return { valid: false };
  const token = Utilities.getUuid();
  membership.sessionToken = token;
  membership.sessionIssuedAt = new Date().toISOString();
  writeResourceList('hostMemberships', memberships);
  return { valid: true, token, accountId: membership.accountId, hostMembership: membership };
}

function toCamelCase(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  return normalized.replace(/[-_\s]+(.)/g, (_, group) => group.toUpperCase());
}
