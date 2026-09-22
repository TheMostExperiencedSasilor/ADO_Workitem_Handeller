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

test('PAT is blank on startup and cleared after a successful connection', () => {
  assert.match(js, /adoPatInput\.value = ''/);
  assert.doesNotMatch(js, /PAT_MASK/);
  assert.doesNotMatch(js, /setSavedPatMask/);
});

test('startup does not automatically call Azure DevOps', () => {
  const checkSetupStart = js.indexOf('async function checkSetup()');
  const connectStart = js.indexOf('async function connectToAdo()');
  const checkSetupBody = js.slice(checkSetupStart, connectStart);
  assert.doesNotMatch(checkSetupBody, /\/api\/setup\/ado-connection/);
  assert.match(checkSetupBody, /status\.adoConnected/);
  assert.match(checkSetupBody, /setAdoConnection\('ADO not connected', 'error'\)/);
});

test('Connect to ADO is a single session connection request', () => {
  const connectStart = js.indexOf('async function connectToAdo()');
  const connectBody = js.slice(connectStart, js.indexOf("document.querySelectorAll('.work-tab')", connectStart));
  assert.match(connectBody, /api\('\/api\/setup', \{/);
  assert.doesNotMatch(connectBody, /\/api\/setup\/ado-connection/);
  assert.match(connectBody, /patPersisted: false/);
});

test('ADO connection keeps the indeterminate progress indicator', () => {
  assert.match(html, /id="adoConnectionProgress"/);
  assert.match(html, /id="adoConnectionText"/);
  assert.match(js, /setAdoConnection\('Connecting to ADO…', 'connecting'\)/);
});
