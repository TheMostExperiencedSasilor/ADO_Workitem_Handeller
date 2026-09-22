const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('frontend/index.html', 'utf8');
const js = fs.readFileSync('frontend/app.js', 'utf8');

test('Setup exposes a real Test connection action', () => {
  assert.match(html, /id="testAdoConnectionButton"[^>]*>Test connection<\/button>/);
  assert.doesNotMatch(html, />Check setup<\/button>/);
  assert.match(js, /api\('\/api\/setup\/ado-connection', \{\s*method: 'POST'/);
});

test('Setup clearly distinguishes saved PAT and unsaved edits', () => {
  assert.match(js, /const PAT_MASK = '\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*'/);
  assert.match(js, /adoPat: adoPatDirty \? adoPatInput\.value : ''/);
  assert.match(js, /setSetupStatus\('Unsaved changes'\)/);
  assert.match(js, /setAdoConnection\('ADO not checked'\)/);
});

test('Setup keeps configured state separate from connection state', () => {
  assert.match(js, /setSetupStatus\(setupMessage, ready \? 'ok' : 'error'\)/);
  assert.match(js, /setAdoConnection\(data\.message \|\| 'ADO connected', 'ok'\)/);
});


test('ADO connection shows an indeterminate progress indicator', () => {
  assert.match(html, /id="adoConnectionProgress"/);
  assert.match(html, /id="adoConnectionText"/);
  assert.match(js, /setAdoConnection\('Connecting to ADO…', 'connecting'\)/);
});

test('saved PAT stays visually masked without sending the mask as the PAT', () => {
  assert.match(js, /adoPatInput\.value = adoPatSaved \? PAT_MASK : ''/);
  assert.match(js, /setSavedPatMask\(Boolean\(payload\.adoPat\) \|\| hadSavedPat\)/);
});
