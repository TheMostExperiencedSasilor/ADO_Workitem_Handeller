const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('frontend/main-tabs.js', 'utf8');

test('Setup is the default landing tab when no URL hash selects another page', () => {
  assert.match(source, /const DEFAULT_TAB_INDEX = 0;/);
  assert.match(source, /hashIndex >= 0 \? hashIndex : DEFAULT_TAB_INDEX/);
});
