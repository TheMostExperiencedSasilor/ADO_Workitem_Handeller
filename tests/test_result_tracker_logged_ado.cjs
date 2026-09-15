const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('frontend/result-tracker-logged-ado.js', 'utf8');
const css = fs.readFileSync('frontend/result-tracker-workflow.css', 'utf8');
const tabs = fs.readFileSync('frontend/main-tabs.js', 'utf8');

test('Fill dropdown includes Logged ADO results', () => {
  assert.match(source, /Logged ADO results/);
  assert.match(source, /__LOGGED_ADO__/);
  assert.match(source, /\/api\/test-plans\/logged-results/);
});

test('Logged ADO fill only targets editable blanks and preserves existing values', () => {
  assert.match(source, /!select\.value && !select\.disabled/);
  assert.match(source, /Existing results will not be changed/);
  assert.match(source, /locked blank cell\(s\) skipped/);
  assert.match(source, /conflicting Test Point results/);
});

test('special Logged ADO option is intercepted before ordinary Fill logic', () => {
  assert.match(source, /addEventListener\('change',[\s\S]*true\)/);
  assert.match(source, /stopImmediatePropagation/);
});

test('dropdown summaries are styled as real buttons', () => {
  assert.match(css, /summary\.secondary-button/);
  assert.match(css, /display: inline-flex/);
  assert.match(css, /background: #2f3b55/);
  assert.match(css, /color: #fff/);
});

test('logged ADO fill script loads after workflow controls', () => {
  const workflow = tabs.indexOf("result-tracker-workflow.js");
  const logged = tabs.indexOf("result-tracker-logged-ado.js");
  assert.ok(workflow >= 0 && logged > workflow);
});
