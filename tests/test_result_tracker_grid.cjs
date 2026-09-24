const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('frontend/test-assignment-workbook.js', 'utf8');
const index = fs.readFileSync('frontend/index.html', 'utf8');

test('Result Tracker is an ingestion/staging page rather than an editable spreadsheet', () => {
  assert.match(source, /Bring in results/);
  assert.match(source, /Ready-to-log preview/);
  assert.match(source, /This table is read-only/);
  assert.doesNotMatch(source, /tracking-result-select/);
  assert.doesNotMatch(index, /result-tracker-grid\.js/);
});

test('Result Tracker accepts CSV, TXT, and pasted TestResult output', () => {
  assert.match(source, /id="importResultCsv"/);
  assert.match(source, /id="importResultTxt"/);
  assert.match(source, /id="testResultPaste"/);
  assert.match(source, /Apply Pasted Results/);
  assert.match(source, /parseResultCsv/);
  assert.match(source, /parseTestResultTxt/);
});

test('preview contains only the fields needed to review logging', () => {
  for (const heading of ['Test Case ID', 'Title', 'Imported Result', 'Latest ADO Status', 'Action']) {
    assert.match(source, new RegExp(heading));
  }
});
