const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('frontend/test-planner-layout.css', 'utf8');
const js = fs.readFileSync('frontend/test-planner-layout.js', 'utf8');

test('planner table owns a visible horizontal scrollbar', () => {
  assert.match(css, /overflow-x:\s*scroll\s*!important/);
  assert.match(css, /table-layout:\s*fixed\s*!important/);
});

test('planner wraps normal text but keeps Test Case IDs intact', () => {
  assert.match(css, /overflow-wrap:\s*anywhere\s*!important/);
  assert.match(css, /td:nth-child\(2\)[\s\S]*white-space:\s*nowrap\s*!important/);
});

test('column resize updates the real table width and header width', () => {
  assert.match(js, /header\.style\.width/);
  assert.match(js, /table\.style\.width/);
  assert.match(js, /stopImmediatePropagation\(\)/);
});
