const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('frontend/test-assignment-workbook.js', 'utf8');
const tabs = fs.readFileSync('frontend/main-tabs.js', 'utf8');

test('Result Tracker follows ADO -> import -> sync -> preview -> publish', () => {
  assert.match(source, /Update from ADO/);
  assert.match(source, /Sync with ADO/);
  assert.match(source, /Bring in results/);
  assert.match(source, /Ready-to-log preview/);
  assert.match(source, /Result Logging/);
});

test('only Passed preview rows are sent to publishing outputs', () => {
  assert.match(source, /row\.action === 'Passed'/);
  assert.match(source, /Create ADO Test Run/);
  assert.match(source, /Transfer to OTE/);
  assert.match(source, /Skipped and Need Analysis rows will not be included/);
});

test('legacy editable tracker workflow assets are no longer loaded', () => {
  assert.doesNotMatch(tabs, /result-tracker-workflow\.js/);
  assert.doesNotMatch(tabs, /result-tracker-logged-ado\.js/);
  assert.doesNotMatch(tabs, /ote-transfer\.js/);
});


test('Update from ADO is retryable after invalid or incomplete input', () => {
  assert.match(source, /let updateInFlight = false/);
  assert.match(source, /function refreshUpdateButton\(\)/);
  assert.match(source, /urlInput\.addEventListener\('input', handleAssignmentInputChanged\)/);
  assert.match(source, /testerInput\.addEventListener\('input', handleAssignmentInputChanged\)/);
  assert.match(source, /Input changed\. Click Update from ADO to try again\./);
  assert.match(source, /finally \{[\s\S]*updateInFlight = false;[\s\S]*refreshUpdateButton\(\)/);
});
