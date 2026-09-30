const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('frontend/main-tabs.js', 'utf8');
const html = fs.readFileSync('frontend/index.html', 'utf8');
const routes = fs.readFileSync('backend/routes/work_item_routes.py', 'utf8');

test('Setup is the default landing tab when no URL hash selects another page', () => {
  assert.match(source, /const DEFAULT_TAB_INDEX = 0;/);
  assert.match(source, /hashIndex >= 0 \? hashIndex : DEFAULT_TAB_INDEX/);
});

test('only Setup, Test Results, and Work Items remain as main tabs', () => {
  const labels = source.match(/const TAB_LABELS = \[([\s\S]*?)\];/)[1];
  assert.deepEqual([...labels.matchAll(/'([^']+)'/g)].map((match) => match[1]),
    ['Setup', 'Test Results', 'Work Items']);
  assert.equal((html.match(/<main class="layout">([\s\S]*?)<\/main>/)[1].match(/<section class="panel(?: |")/g) || []).length, 3);
  assert.doesNotMatch(html, /id="(?:readButton|analyzeButton|draftButton|createButton|updateButton|output)"/);
  assert.doesNotMatch(routes, /@work_items_bp\.(?:patch|post)\("\/(?:analyze|draft|create|<int:work_item_id>)/);
  assert.match(routes, /@work_items_bp\.post\("\/read"\)/);
});
