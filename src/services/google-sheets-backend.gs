/**
 * Youth Montreal Host Finder - Backend Workspace
 * Canonical resources: account, host, hostMembership, hostRequest, liveEvent, liveEventParticipant, report
 */

const RESOURCE_CONFIG = {
  hosts: { sheetName: 'host', resourceAliases: ['host', 'churches'], sheetAliases: ['hosts', 'churches'] },
  reports: { sheetName: 'report', resourceAliases: ['report', 'suggestion', 'suggestions'], sheetAliases: ['reports', 'suggestions'] },
  hostRequests: { sheetName: 'hostRequest', resourceAliases: ['hostRequest', 'titleRequest', 'titleRequests'], sheetAliases: ['hostRequests', 'titleRequests'] },
  accounts: { sheetName: 'account', resourceAliases: ['account'], sheetAliases: ['accounts'] },
  hostMemberships: { sheetName: 'hostMembership', resourceAliases: ['hostMembership'], sheetAliases: ['hostMemberships'] },
  liveEvents: { sheetName: 'liveEvent', resourceAliases: ['liveEvent'], sheetAliases: ['liveEvents'] },
  liveEventParticipants: { sheetName: 'liveEventParticipant', resourceAliases: ['liveEventParticipant'], sheetAliases: ['liveEventParticipants'] }
};

const ADM_ALLOWLIST = ['developer@youthmontreal.org', 'founder@youthmontreal.org', 'cofounder@youthmontreal.org'];

function canonicalizeResource(resource) { const name = String(resource || '').trim(); if (!name) return ''; if (RESOURCE_CONFIG[name]) return name; return Object.keys(RESOURCE_CONFIG).find((k) => RESOURCE_CONFIG[k].resourceAliases.includes(name)) || ''; }
function ensureJsonSheet(sheet) { if (!sheet) return; if (sheet.getLastRow() === 0) sheet.appendRow(['data_json']); const header = String(sheet.getRange(1, 1).getValue() || '').trim(); if (!header) sheet.getRange(1, 1).setValue('data_json'); }
function resolveSheet(resource, spreadsheet) { const canonical = canonicalizeResource(resource); if (!canonical) return null; const config = RESOURCE_CONFIG[canonical]; const preferred = spreadsheet.getSheetByName(config.sheetName); let sheet = preferred || config.sheetAliases.map((n) => spreadsheet.getSheetByName(n)).find(Boolean) || null; if (!sheet) sheet = spreadsheet.insertSheet(config.sheetName); else if (sheet.getName() !== config.sheetName && !preferred) sheet.setName(config.sheetName); ensureJsonSheet(sheet); return { resource: canonical, sheet }; }
function setup() { const ss = SpreadsheetApp.getActiveSpreadsheet(); Object.keys(RESOURCE_CONFIG).forEach((resource) => { const resolved = resolveSheet(resource, ss); if (resolved) ensureJsonSheet(resolved.sheet); }); }
function readResourceList(resource) { const resolved = resolveSheet(resource, SpreadsheetApp.getActiveSpreadsheet()); if (!resolved) return []; const values = resolved.sheet.getDataRange().getValues(); return values.length > 1 && values[1][0] ? JSON.parse(values[1][0]) : []; }
function writeResourceList(resource, payload) { const resolved = resolveSheet(resource, SpreadsheetApp.getActiveSpreadsheet()); if (!resolved) return false; resolved.sheet.getRange(2, 1).setValue(JSON.stringify(payload)); return true; }

function doGet(e) { const resolved = resolveSheet(e.parameter.resource, SpreadsheetApp.getActiveSpreadsheet()); if (!resolved) return createResponse({ error: 'Resource not found' }); const data = readResourceList(resolved.resource); const result = {}; result[resolved.resource] = data; return createResponse(result); }

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

function createResponse(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
