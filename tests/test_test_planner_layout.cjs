const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('frontend/test-planner-layout.css', 'utf8');
const js = fs.readFileSync('frontend/test-planner-layout.js', 'utf8');

test('planner table owns a visible horizontal scrollbar', () => {
  assert.match(css, /overflow-x:\s*scroll\s*!important/);
  assert.match(css, /table-layout:\s*fixed\s*!important/);
});

test('planner wraps normal text but keeps Test Case IDs and status intact', () => {
  assert.match(css, /overflow-wrap:\s*anywhere\s*!important/);
  assert.match(css, /td:nth-child\(2\)[\s\S]*white-space:\s*nowrap\s*!important/);
  assert.match(css, /td:nth-child\(4\)[\s\S]*white-space:\s*nowrap\s*!important/);
});

test('column resize updates every real cell and total table width', () => {
  assert.match(js, /querySelectorAll\(`tr > :nth-child\(\$\{position\}\)`\)/);
  assert.match(js, /cell\.style\.width/);
  assert.match(js, /table\.style\.width/);
  assert.match(js, /handle\.setPointerCapture/);
});

test('hidden selection column cannot steal Test Case ID width', () => {
  assert.match(css, /planner-table:not\(\.selection-mode\) \.planner-selection-col/);
  assert.match(css, /width:\s*0\s*!important/);
});
