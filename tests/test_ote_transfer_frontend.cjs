const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('frontend/test-assignment-workbook.js', 'utf8');

test('OTE remains a publishing option from the staged preview', () => {
  assert.match(source, /Transfer to OTE/);
  assert.match(source, /\/api\/test-plans\/transfer-to-ote/);
  assert.match(source, /oteWorkbookFile/);
});

test('OTE receives only preview rows whose Action is Passed', () => {
  assert.match(source, /rowsReadyToLog/);
  assert.match(source, /row\.action === 'Passed'/);
  assert.match(source, /resultKey', 'round1Results'/);
});

test('OTE remains a non-destructive completed-workbook export', () => {
  assert.match(source, /_Completed\.xlsx/);
});
