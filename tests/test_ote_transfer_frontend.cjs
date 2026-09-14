const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const oteSource = fs.readFileSync('frontend/ote-transfer.js', 'utf8');
const trackerSource = fs.readFileSync('frontend/test-assignment-workbook.js', 'utf8');
const tabsSource = fs.readFileSync('frontend/main-tabs.js', 'utf8');

test('OTE is restored as an additional option beside ADO Test Run publishing', () => {
  assert.match(trackerSource, /Create ADO Test Run/);
  assert.match(oteSource, /Transfer to OTE/);
  assert.match(oteSource, /transfer-to-ote/);
  assert.match(tabsSource, /ote-transfer\.js/);
});

test('OTE transfer exposes all four tracker result sources', () => {
  for (const key of ['round1Results', 'round2Results', 'singleRunResults', 'manualRun']) {
    assert.match(oteSource, new RegExp(key));
  }
});

test('OTE remains a non-destructive completed-workbook export', () => {
  assert.match(oteSource, /_Completed\.xlsx/);
  assert.match(oteSource, /original file is not overwritten/);
});
