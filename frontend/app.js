const output = document.querySelector('#output');
const healthBadge = document.querySelector('#healthBadge');
const adoConnectionBadge = document.querySelector('#adoConnectionBadge');
const setupStatus = document.querySelector('#setupStatus');
const readIds = document.querySelector('#readIds');

const creatableTabTypes = {
  feature: 'Feature',
  task: 'Task',
  'user-story': 'User Story',
};

function parseIds() {
  return readIds.value
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number);
}

function selectedRules() {
  const rules = [];
  if (document.querySelector('#ruleSmart').checked) rules.push('smart');
  if (document.querySelector('#ruleSplit').checked) rules.push('split_into_three');
  return rules;
}

function setupPayload() {
  return {
    adoOrganization: document.querySelector('#adoOrganization').value,
    adoProject: document.querySelector('#adoProject').value,
    adoPat: document.querySelector('#adoPat').value,
    aiProvider: 'github',
    aiBaseUrl: document.querySelector('#aiBaseUrl').value,
    aiModel: document.querySelector('#aiModel').value,
    githubToken: document.querySelector('#githubToken').value,
  };
}

function clearSecretInputs() {
  document.querySelector('#adoPat').value = '';
  document.querySelector('#githubToken').value = '';
}

function writePayload() {
  const parentText = document.querySelector('#parentId').value.trim();
  return {
    type: document.querySelector('#workItemType').value,
    title: document.querySelector('#title').value,
    description: document.querySelector('#description').value,
    parentId: parentText ? Number(parentText) : null,
    rules: selectedRules(),
  };
}

function show(data) {
  output.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

function setSetupStatus(text, state = '') {
  setupStatus.textContent = text;
  setupStatus.classList.remove('ok', 'error');
  if (state) setupStatus.classList.add(state);
}

function setAdoConnection(text, state = '') {
  adoConnectionBadge.textContent = text;
  adoConnectionBadge.classList.remove('ok', 'error');
  if (state) adoConnectionBadge.classList.add(state);
}

function activateWorkTab(tabName) {
  document.querySelectorAll('.work-tab').forEach((tab) => {
    const active = tab.dataset.workTab === tabName;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });

  document.querySelectorAll('.work-page').forEach((page) => {
    const active = page.dataset.workPage === tabName;
    page.classList.toggle('active', active);
    page.hidden = !active;
  });

  if (creatableTabTypes[tabName]) {
    document.querySelector('#workItemType').value = creatableTabTypes[tabName];
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || `Request failed: ${response.status}`);
  }
  return data;
}

async function checkHealth() {
  try {
    await api('/api/health');
    healthBadge.textContent = 'Backend ready';
    healthBadge.classList.add('ok');
  } catch (error) {
    healthBadge.textContent = 'Backend offline';
    healthBadge.classList.add('error');
  }
}

async function checkAdoConnection() {
  try {
    const data = await api('/api/setup/ado-connection');
    setAdoConnection(data.message || 'ADO connected', 'ok');
    return data;
  } catch (error) {
    setAdoConnection('ADO not connected', 'error');
    return null;
  }
}

async function checkSetup() {
  try {
    const status = await api('/api/setup/status');
    const ready = status.adoOrganizationConfigured
      && status.adoProjectConfigured
      && status.adoPatConfigured
      && status.aiBaseUrlConfigured
      && status.aiModelConfigured
      && status.githubTokenConfigured;
    setSetupStatus(ready ? 'Configured' : 'Missing values', ready ? 'ok' : 'error');
    if (status.adoOrganizationConfigured && status.adoProjectConfigured && status.adoPatConfigured) {
      await checkAdoConnection();
    } else {
      setAdoConnection('ADO not connected', 'error');
    }
    show(status);
  } catch (error) {
    setSetupStatus('Setup check failed', 'error');
    setAdoConnection('ADO not connected', 'error');
    show(error.message);
  }
}

document.querySelectorAll('.work-tab').forEach((tab) => {
  tab.addEventListener('click', () => activateWorkTab(tab.dataset.workTab));
});

document.querySelector('#saveSetupButton').addEventListener('click', async () => {
  try {
    show('Saving setup to backend .env...');
    const result = await api('/api/setup', {
      method: 'POST',
      body: JSON.stringify(setupPayload()),
    });
    clearSecretInputs();
    setSetupStatus('Saved', 'ok');
    await checkAdoConnection();
    show(result);
  } catch (error) {
    setSetupStatus('Save failed', 'error');
    setAdoConnection('ADO not connected', 'error');
    show(error.message);
  }
});

document.querySelector('#checkSetupButton').addEventListener('click', checkSetup);

document.querySelector('#readButton').addEventListener('click', async () => {
  try {
    show('Reading work items...');
    show(await api('/api/work-items/read', {
      method: 'POST',
      body: JSON.stringify({ ids: parseIds() }),
    }));
  } catch (error) {
    show(error.message);
  }
});

document.querySelector('#analyzeButton').addEventListener('click', async () => {
  try {
    show('Analyzing work items...');
    show(await api('/api/work-items/analyze', {
      method: 'POST',
      body: JSON.stringify({
        ids: parseIds(),
        instruction: document.querySelector('#analysisInstruction').value,
      }),
    }));
  } catch (error) {
    show(error.message);
  }
});

document.querySelector('#draftButton').addEventListener('click', async () => {
  try {
    show('Drafting work items...');
    show(await api('/api/work-items/draft', {
      method: 'POST',
      body: JSON.stringify({
        ids: parseIds(),
        request: document.querySelector('#draftRequest').value,
        rules: selectedRules(),
      }),
    }));
  } catch (error) {
    show(error.message);
  }
});

document.querySelector('#createButton').addEventListener('click', async () => {
  try {
    show('Creating work item...');
    show(await api('/api/work-items/create', {
      method: 'POST',
      body: JSON.stringify(writePayload()),
    }));
  } catch (error) {
    show(error.message);
  }
});

document.querySelector('#updateButton').addEventListener('click', async () => {
  try {
    const updateId = document.querySelector('#updateId').value.trim();
    if (!updateId) {
      throw new Error('Update ID is required for edit.');
    }
    show('Updating work item...');
    show(await api(`/api/work-items/${Number(updateId)}`, {
      method: 'PATCH',
      body: JSON.stringify(writePayload()),
    }));
  } catch (error) {
    show(error.message);
  }
});

const chatToggle = document.querySelector('#chatToggle');
const chatbox = document.querySelector('#chatbox');
const chatClose = document.querySelector('#chatClose');
const chatMessages = document.querySelector('#chatMessages');
const chatForm = document.querySelector('#chatForm');
const chatInput = document.querySelector('#chatInput');

chatToggle.addEventListener('click', () => chatbox.classList.toggle('hidden'));
chatClose.addEventListener('click', () => chatbox.classList.add('hidden'));

function addMessage(text, role) {
  const node = document.createElement('div');
  node.className = `message ${role}`;
  node.textContent = text;
  chatMessages.appendChild(node);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  chatInput.value = '';
  addMessage(message, 'user');
  addMessage('Thinking...', 'ai');
  const thinkingNode = chatMessages.lastElementChild;
  try {
    const data = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message, ids: parseIds() }),
    });
    thinkingNode.textContent = data.answer;
  } catch (error) {
    thinkingNode.textContent = error.message;
  }
});

checkHealth();
checkSetup();

// Test Plan / Suite is independent of the work-item tabs and their output.
let testSuitePoints = [];
let visibleTestPoints = [];
const testRowHeights = new Map();
const testColumnWidths = [150, 600, 150, 220, 100];
const testSuiteStatus = document.querySelector('#testSuiteStatus');
const testSuiteResults = document.querySelector('#testSuiteResults');
const loadTestSuiteButton = document.querySelector('#loadTestSuiteButton');
const copyTestSuiteButton = document.querySelector('#copyTestSuiteButton');
const copyFailedTestsButton = document.querySelector('#copyFailedTestsButton');

function setTestSuiteStatus(message, error = false) {
  testSuiteStatus.textContent = message;
  testSuiteStatus.classList.toggle('error', error);
}

function testPointsMarkdown(points, failedOnly = false) {
  const escapeCell = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
  const rows = failedOnly ? points.filter((point) => point.outcome === 'Failed') : points;
  return [
    '| Test Case ID | Title | Outcome | Tester | Order |',
    '|---:|---|---|---|---:|',
    ...rows.map((point) => `| ${[point.testCaseId, point.title, point.outcome, point.tester, point.order].map(escapeCell).join(' | ')} |`),
  ].join('\n');
}

function renderTestSuite(data) {
  const summary = document.querySelector('#testSuiteSummary');
  summary.replaceChildren();
  for (const [label, value] of [
    ['Test Plan', data.planId], ['Suite', data.suiteId], ['Total', data.summary.total],
    ['Passed', data.summary.passed], ['Failed', data.summary.failed], ['Other / Not Run', data.summary.other],
  ]) {
    const item = document.createElement('span');
    item.textContent = `${label}: ${value}`;
    summary.appendChild(item);
  }
  const resultFilter = document.querySelector('#testFilterResult');
  resultFilter.replaceChildren();
  for (const result of ['', ...new Set(data.testPoints.map((point) => point.outcome))]) {
    const option = document.createElement('option');
    option.value = result;
    option.textContent = result || 'All results';
    resultFilter.appendChild(option);
  }
  clearTestFilters();
  testSuiteResults.hidden = false;
}

function filterTestPoints(points, filters) {
  const includes = (value, query) => String(value ?? '').toLowerCase().includes(query.trim().toLowerCase());
  return points.filter((point) => includes(point.testCaseId, filters.id)
    && includes(point.title, filters.title) && includes(point.tester || 'Unassigned', filters.tester)
    && (!filters.result || point.outcome === filters.result));
}

function renderFilteredTests() {
  visibleTestPoints = filterTestPoints(testSuitePoints, {
    id: document.querySelector('#testFilterId').value,
    title: document.querySelector('#testFilterTitle').value,
    result: document.querySelector('#testFilterResult').value,
    tester: document.querySelector('#testFilterTester').value,
  });
  document.querySelector('#testSuiteFilterStatus').textContent = visibleTestPoints.length
    ? `Showing ${visibleTestPoints.length} of ${testSuitePoints.length} test points.`
    : 'No test points match the filters.';
  copyTestSuiteButton.disabled = visibleTestPoints.length === 0;
  copyFailedTestsButton.disabled = !visibleTestPoints.some((point) => point.outcome === 'Failed');
  const body = document.querySelector('#testSuiteRows');
  const fragment = document.createDocumentFragment();
  for (const point of visibleTestPoints) {
    const row = document.createElement('tr');
    for (const key of ['testCaseId', 'title', 'outcome', 'tester', 'order']) {
      const cell = document.createElement('td');
      if (key === 'outcome') {
        const badge = document.createElement('span');
        const state = point.outcome === 'Passed' ? 'passed' : point.outcome === 'Failed' ? 'failed' : 'neutral';
        badge.className = `test-outcome ${state}`;
        badge.textContent = point.outcome;
        cell.appendChild(badge);
      } else {
        cell.textContent = key === 'tester' ? point.tester || 'Unassigned' : point[key] ?? '';
      }
      row.appendChild(cell);
    }
    if (testRowHeights.has(point)) row.style.height = `${testRowHeights.get(point)}px`;
    const handle = makeResizeHandle('row', 'Resize row height',
      () => row.getBoundingClientRect().height,
      (size) => { row.style.height = `${size}px`; testRowHeights.set(point, size); }, 40);
    row.children[0].appendChild(handle);
    fragment.appendChild(row);
  }
  body.replaceChildren(fragment);
  testSuiteResults.hidden = false;
}

document.querySelector('#testSuiteForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (loadTestSuiteButton.disabled) return;
  loadTestSuiteButton.disabled = true;
  copyTestSuiteButton.disabled = true;
  copyFailedTestsButton.disabled = true;
  testSuiteResults.hidden = true;
  testSuitePoints = [];
  visibleTestPoints = [];
  testRowHeights.clear();
  setTestSuiteStatus('Loading test suite…');
  try {
    const data = await api('/api/test-plans/read-suite', {
      method: 'POST',
      body: JSON.stringify({ url: document.querySelector('#testPlanUrl').value.trim() }),
    });
    if (!Array.isArray(data.testPoints) || !data.summary) throw new Error('Invalid response from the backend.');
    testSuitePoints = data.testPoints;
    renderTestSuite(data);
    copyTestSuiteButton.disabled = testSuitePoints.length === 0;
    copyFailedTestsButton.disabled = !testSuitePoints.some((point) => point.outcome === 'Failed');
    setTestSuiteStatus(data.message || 'Test suite loaded.');
  } catch (error) {
    setTestSuiteStatus(error.message || 'Unable to load the test suite.', true);
  } finally {
    loadTestSuiteButton.disabled = false;
  }
});

async function copyTestSuite(failedOnly) {
  const markdown = testPointsMarkdown(visibleTestPoints, failedOnly);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(markdown);
    } else {
      // Support the existing app when opened over HTTP on a local network.
      const field = document.createElement('textarea');
      field.value = markdown;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      const previousFocus = document.activeElement;
      document.body.appendChild(field);
      try {
        field.select();
        if (!document.execCommand('copy')) throw new Error('Copy unavailable');
      } finally {
        field.remove();
        previousFocus?.focus();
      }
    }
    setTestSuiteStatus(failedOnly ? 'Failed cases copied as Markdown.' : 'Table copied as Markdown.');
  } catch {
    setTestSuiteStatus('Could not copy. Allow clipboard access or open the app on localhost/HTTPS and try again.', true);
  }
}

copyTestSuiteButton.addEventListener('click', () => copyTestSuite(false));
copyFailedTestsButton.addEventListener('click', () => copyTestSuite(true));


function clearTestFilters() {
  for (const id of ['testFilterId', 'testFilterTitle', 'testFilterResult', 'testFilterTester']) {
    document.querySelector(`#${id}`).value = '';
  }
  renderFilteredTests();
}
for (const id of ['testFilterId', 'testFilterTitle', 'testFilterResult', 'testFilterTester']) {
  document.querySelector(`#${id}`).addEventListener(id === 'testFilterResult' ? 'change' : 'input', renderFilteredTests);
}
document.querySelector('#clearTestFilters').addEventListener('click', clearTestFilters);

function makeResizeHandle(axis, label, getSize, setSize, minimum) {
  const handle = document.createElement('span');
  handle.className = `test-resize-handle ${axis}`;
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-label', label);
  handle.setAttribute('aria-orientation', axis === 'column' ? 'vertical' : 'horizontal');
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const start = axis === 'column' ? event.clientX : event.clientY;
    const initial = getSize();
    handle.setPointerCapture(event.pointerId);
    const move = (next) => setSize(Math.max(minimum, initial + (axis === 'column' ? next.clientX : next.clientY) - start));
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      handle.removeEventListener('lostpointercapture', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    handle.addEventListener('lostpointercapture', stop);
  });
  handle.addEventListener('keydown', (event) => {
    const decrease = axis === 'column' ? 'ArrowLeft' : 'ArrowUp';
    const increase = axis === 'column' ? 'ArrowRight' : 'ArrowDown';
    if (![decrease, increase].includes(event.key)) return;
    event.preventDefault();
    setSize(Math.max(minimum, getSize() + (event.key === increase ? 10 : -10)));
  });
  return handle;
}

function applyTestColumnWidths() {
  document.querySelectorAll('#testSuiteColumns col').forEach((col, index) => {
    col.style.width = `${testColumnWidths[index]}px`;
  });
  document.querySelector('#testSuiteTable').style.width = `${testColumnWidths.reduce((sum, width) => sum + width, 0)}px`;
}
document.querySelectorAll('#testSuiteTable th').forEach((header, index) => {
  header.appendChild(makeResizeHandle('column', `Resize ${header.textContent} column`,
    () => testColumnWidths[index],
    (size) => { testColumnWidths[index] = size; applyTestColumnWidths(); }, 80));
});
document.querySelector('#resetTestSizes').addEventListener('click', () => {
  testColumnWidths.splice(0, 5, 150, 600, 150, 220, 100);
  testRowHeights.clear();
  applyTestColumnWidths();
  renderFilteredTests();
});
applyTestColumnWidths();
