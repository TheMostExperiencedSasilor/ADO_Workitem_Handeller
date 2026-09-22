const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('frontend/index.html', 'utf8');
const js = fs.readFileSync('frontend/app.js', 'utf8');

test('Setup exposes one disabled Connect to ADO action', () => {
  assert.match(html, /id="connectAdoButton" type="button" disabled>Connect to ADO<\/button>/);
  assert.doesNotMatch(html, />Save setup<\/button>/);
  assert.doesNotMatch(html, />Test connection<\/button>/);
});

test('Connect to ADO is enabled only when all three visible fields are filled', () => {
  assert.match(js, /adoOrganizationInput\.value\.trim\(\)/);
  assert.match(js, /adoProjectInput\.value\.trim\(\)/);
  assert.match(js, /adoPatInput\.value\.trim\(\)/);
  assert.match(js, /connectAdoButton\.disabled = adoConnecting \|\| !allFieldsFilled/);
});

test('PAT is blank on load and cleared again after a successful connection', () => {
  assert.match(js, /adoPatInput\.value = ''/);
  assert.doesNotMatch(js, /PAT_MASK/);
  assert.doesNotMatch(js, /setSavedPatMask/);
});

test('Connect to ADO saves before checking the saved ADO connection', () => {
  const save = js.indexOf("api('/api/setup', {");
  const connect = js.indexOf("api('/api/setup/ado-connection')", save);
  assert.ok(save >= 0);
  assert.ok(connect > save);
});

test('ADO connection keeps the indeterminate progress indicator', () => {
  assert.match(html, /id="adoConnectionProgress"/);
  assert.match(html, /id="adoConnectionText"/);
  assert.match(js, /setAdoConnection\('Connecting to ADO…', 'connecting'\)/);
});

test('Setup keeps configured state separate from connection state', () => {
  assert.match(js, /setSetupStatus\('Configured', 'ok'\)/);
  assert.match(js, /setAdoConnection\(connection\.message \|\| 'ADO connected', 'ok'\)/);
});
