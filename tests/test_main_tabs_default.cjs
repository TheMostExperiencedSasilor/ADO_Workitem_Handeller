const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('frontend/main-tabs.js', 'utf8');

test('Setup is the default landing tab', () => {
  assert.match(source, /const DEFAULT_TAB_INDEX = 0;/);
});
