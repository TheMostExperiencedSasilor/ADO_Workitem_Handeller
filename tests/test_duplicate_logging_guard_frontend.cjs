const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('frontend/ote-transfer.js', 'utf8');

test('Result Tracker exposes safe duplicate logging controls', () => {
  assert.match(source, /id="allowDuplicateLogging"/);
  assert.match(source, /Allow duplicated logging/);
  assert.match(source, /id = 'updateAssignmentFromAdo'|id='updateAssignmentFromAdo'|updateAssignmentFromAdo/);
  assert.match(source, /Update from ADO/);
});

test('duplicate logging is opt-in and injected into both publishing paths', () => {
  assert.doesNotMatch(source, /allowDuplicate\.checked\s*=\s*true/);
  assert.match(source, /payload\.allowDuplicateLogging = Boolean\(allowDuplicate\.checked\)/);
  assert.match(source, /formData\.append\(\s*'allowDuplicateLogging'/);
});

test('Update from ADO restores local editable values for matching cases', () => {
  assert.match(source, /editableCellSnapshot/);
  assert.match(source, /restoreSnapshot/);
  assert.match(source, /local results restored/);
});

test('logging dialogs refresh eligibility from ADO', () => {
  assert.match(source, /\/api\/test-plans\/logging-eligibility/);
  assert.match(source, /refreshEligibility\('ado'\)/);
  assert.match(source, /refreshEligibility\('ote'\)/);
});
