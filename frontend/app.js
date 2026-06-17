const output = document.querySelector('#output');
const healthBadge = document.querySelector('#healthBadge');
const adoConnectionBadge = document.querySelector('#adoConnectionBadge');
const setupStatus = document.querySelector('#setupStatus');
const readIds = document.querySelector('#readIds');

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
