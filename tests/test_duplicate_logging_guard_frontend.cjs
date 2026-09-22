const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('frontend/test-assignment-workbook.js', 'utf8');

test('duplicate logging remains opt-in', () => {
  assert.match(source, /id="allowDuplicateLogging" type="checkbox"/);
  assert.doesNotMatch(source, /id="allowDuplicateLogging" type="checkbox" checked/);
  assert.match(source, /Allow duplicated logging/);
});

test('duplicate setting affects preview action and both final publishing paths', () => {
  assert.match(source, /if \(allowDuplicate\.checked\) return 'Passed'/);
  assert.match(source, /allowDuplicateLogging: Boolean\(allowDuplicate\.checked\)/);
  assert.match(source, /formData\.append\('allowDuplicateLogging'/);
});

test('a fresh ADO sync is required before publishing', () => {
  assert.match(source, /previewFresh/);
  assert.match(source, /Sync with ADO again before publishing/);
  assert.match(source, /Publishing remains disabled until a successful sync/);
});
