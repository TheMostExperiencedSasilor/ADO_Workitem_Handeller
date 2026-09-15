const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('frontend/result-tracker-workflow.js', 'utf8');
const css = fs.readFileSync('frontend/result-tracker-workflow.css', 'utf8');
const tabs = fs.readFileSync('frontend/main-tabs.js', 'utf8');

test('Result Tracker uses the simplified top-level workflow', () => {
  assert.match(source, /resultTrackerUpdateFromAdo/);
  assert.match(source, /Update from ADO/);
  assert.match(source, /Work <span/);
  assert.match(source, /Result Logging <span/);
  assert.match(source, /saveButton\.click\(\)/);
  assert.match(source, /openButton\.click\(\)/);
});

test('result logging menu retains both outputs and duplicate protection', () => {
  assert.match(source, /loggingPanel\.append\(createRunButton, transferButton\)/);
  assert.match(source, /allowDuplicateLogging/);
  assert.match(source, /result-tracker-menu-checkbox/);
});

test('each result column gets a safe Fill control', () => {
  assert.match(source, /fill-result-column/);
  assert.match(source, /<option value="Passed">Passed<\/option>/);
  assert.match(source, /<option value="Failed">Failed<\/option>/);
  assert.match(source, /!select\.value && !select\.disabled/);
  assert.match(source, /Existing and locked results will not be changed/);
});

test('result checker locks cells after the first Passed without deleting values', () => {
  assert.match(source, /id="lockResultsAfterPassed" type="checkbox" checked/);
  assert.match(source, /firstPassedIndex/);
  assert.match(source, /index > firstPassedIndex/);
  assert.match(source, /select\.dataset\.lockedValue = select\.value/);
  assert.match(source, /select\.disabled = true/);
  assert.doesNotMatch(source, /select\.value\s*=\s*['"]Not Required['"]/);
});

test('proxy-state observer cannot observe and retrigger its own disabled writes', () => {
  assert.match(source, /setDisabledIfChanged/);
  assert.match(source, /proxyStateObserver\.observe\(control/);
  assert.match(source, /\[originalReadButton, updateButton, saveButton, openButton\]/);
  assert.doesNotMatch(source, /MutationObserver\(syncProxyStates\)\.observe\(section/);
});

test('workflow assets are loaded by the Test Results workspace', () => {
  assert.match(tabs, /result-tracker-workflow\.css/);
  assert.match(tabs, /result-tracker-workflow\.js/);
  assert.match(css, /result-cell-locked/);
});
