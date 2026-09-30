const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('frontend/index.html', 'utf8');
const js = fs.readFileSync('frontend/app.js', 'utf8');
const css = fs.readFileSync('frontend/styles.css', 'utf8');
const windowsLauncher = fs.readFileSync('launcher/Start-Windows.ps1', 'utf8');

test('browser header has a glowing live app status indicator', () => {
  assert.match(html, /id="healthBadge"[^>]*backend-status/);
  assert.match(html, /class="backend-status-dot"/);
  assert.match(html, /id="healthStatusText"/);
  assert.match(css, /backend-glow-green/);
  assert.match(css, /backend-glow-red/);
});

test('health status continuously switches between running and stopped', () => {
  assert.match(js, /healthStatusText\.textContent = 'App is running'/);
  assert.match(js, /healthStatusText\.textContent = 'App is stopped'/);
  assert.match(js, /window\.setInterval\(checkHealth, 2000\)/);
});

test('Windows launcher waits for bootstrap then exits while backend stays detached', () => {
  assert.match(windowsLauncher, /\$process\.WaitForExit\(\)/);
  assert.match(windowsLauncher, /-WindowStyle Hidden -PassThru/);
});
