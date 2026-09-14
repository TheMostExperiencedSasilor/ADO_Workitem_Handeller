const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('frontend/test-planner-layout.css', 'utf8');
const js = fs.readFileSync('frontend/test-planner-layout.js', 'utf8');
const planner = fs.readFileSync('frontend/test-planner.js', 'utf8');

test('planner table owns a visible horizontal scrollbar', () => {
  assert.match(css, /overflow-x:\s*scroll\s*!important/);
  assert.match(css, /table-layout:\s*fixed\s*!important/);
});

test('planner keeps Test Case ID as the first real data column', () => {
  assert.ok(planner.indexOf('data-label="Test Case ID"') < planner.indexOf('data-label="Title"'));
  assert.match(css, /\.planner-table \.planner-selection-cell\s*\{[\s\S]*display:\s*table-cell\s*!important/);
  assert.match(css, /planner-table:not\(\.selection-mode\) \.planner-selection-cell[\s\S]*width:\s*0\s*!important/);
});

test('planner wraps normal text but keeps Test Case IDs and status intact', () => {
  assert.match(css, /overflow-wrap:\s*anywhere\s*!important/);
  assert.match(css, /td:nth-child\(2\)[\s\S]*white-space:\s*nowrap\s*!important/);
  assert.match(css, /td:nth-child\(4\)[\s\S]*white-space:\s*nowrap\s*!important/);
});

test('column resize updates colgroup, every real cell and total table width', () => {
  assert.match(js, /setExactWidth\(cols\[index \+ 1\], width\)/);
  assert.match(js, /querySelectorAll\(`tr > :nth-child\(\$\{position\}\)`\)/);
  assert.match(js, /setExactWidth\(cell, width\)/);
  assert.match(js, /table\.style\.width/);
  assert.match(js, /handle\.setPointerCapture/);
});

test('resize handle is clickable on the real inside edge of each sticky header', () => {
  assert.match(css, /test-resize-handle\.column[\s\S]*right:\s*0;/);
  assert.match(css, /test-resize-handle\.column[\s\S]*pointer-events:\s*auto;/);
  assert.doesNotMatch(css, /test-resize-handle\.column[\s\S]{0,200}right:\s*-\d/);
});
