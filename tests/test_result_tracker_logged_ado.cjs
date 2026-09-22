const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('frontend/test-assignment-workbook.js', 'utf8');

test('Sync with ADO reuses the same suite status source as Test Planner', () => {
  assert.match(source, /\/api\/test-plans\/read-suite/);
  assert.match(source, /plannerStatus/);
  assert.match(source, /aggregateAdoStatus/);
  assert.match(source, /incoming === 'Failed'/);
});

test('Failed imports are never automatically logged', () => {
  assert.match(source, /if \(importedResult !== 'Passed'\) return 'Need Analysis'/);
  assert.match(source, /Need Analysis/);
});

test('Passed imports are Passed only when eligible, otherwise Skipped', () => {
  assert.match(source, /adoStatus === 'Active' \? 'Passed' : 'Skipped'/);
  assert.match(source, /Allow duplicated logging/);
});
