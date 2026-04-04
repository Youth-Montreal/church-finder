/**
 * Youth Montreal Host Finder - Backend Workspace
 * Canonical resources: 'hosts', 'reports', 'hostRequests'
 */

const RESOURCE_CONFIG = {
  hosts: {
    sheetName: 'hosts',
    resourceAliases: ['churches'],
    sheetAliases: ['churches']
  },
  reports: {
    sheetName: 'reports',
    resourceAliases: ['suggestion', 'suggestions'],
    sheetAliases: ['suggestions']
  },
  hostRequests: {
    sheetName: 'hostRequests',
    resourceAliases: ['hostRequest', 'titleRequest', 'titleRequests'],
    sheetAliases: ['hostRequest', 'titleRequest', 'titleRequests']
  }
};

function canonicalizeResource(resource) {
  const resourceName = String(resource || '').trim();
  if (!resourceName) return '';
  if (RESOURCE_CONFIG[resourceName]) return resourceName;
  const match = Object.keys(RESOURCE_CONFIG).find((key) =>
    RESOURCE_CONFIG[key].resourceAliases.includes(resourceName)
  );
  return match || '';
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
    sheet = config.sheetAliases
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

  const values = resolved.sheet.getDataRange().getValues();
  const data = values.length > 1 ? JSON.parse(values[1][0]) : [];

  const result = {};
  result[resolved.resource] = data;
  return createResponse(result);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const resolved = resolveSheet(body.resource, SpreadsheetApp.getActiveSpreadsheet());
    const payload = body.payload;
    if (!resolved) return createResponse({ error: 'Resource not found' });

    resolved.sheet.getRange(2, 1).setValue(JSON.stringify(payload));
    return createResponse({ success: true, resource: resolved.resource });
  } catch (err) {
    return createResponse({ error: err.toString() });
  }
}

function createResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
