const output = document.querySelector('#output');
const healthBadge = document.querySelector('#healthBadge');
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

function show(data) {
  output.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
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

document.querySelector('#createButton').addEventListener('click', async () => {
  try {
    show('Creating work item...');
    const parentText = document.querySelector('#parentId').value.trim();
    show(await api('/api/work-items/create', {
      method: 'POST',
      body: JSON.stringify({
        type: document.querySelector('#workItemType').value,
        title: document.querySelector('#title').value,
        description: document.querySelector('#description').value,
        parentId: parentText ? Number(parentText) : null,
        rules: selectedRules(),
      }),
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
