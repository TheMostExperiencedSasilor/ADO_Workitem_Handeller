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
  assert.match(js, /PAT saved — enter a new value to replace it/);
  assert.match(js, /setSetupStatus\('Unsaved changes'\)/);
  assert.match(js, /setAdoConnection\('ADO not checked'\)/);
});

test('Setup keeps configured state separate from connection state', () => {
  assert.match(js, /setSetupStatus\(setupMessage, ready \? 'ok' : 'error'\)/);
  assert.match(js, /setAdoConnection\(data\.message \|\| 'ADO connected', 'ok'\)/);
});
