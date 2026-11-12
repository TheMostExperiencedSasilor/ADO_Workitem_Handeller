(() => {
  const el = (id) => document.getElementById(id);
  const token = el('copilotToken');
  const connect = el('connectAiButton');
  const disconnect = el('disconnectAiButton');
  const model = el('chatModel');
  const input = el('chatInput');
  const ids = el('chatContextIds');
  const messages = el('chatMessages');
  const toggle = el('chatToggle');
  const box = el('chatbox');
  let connected = false;
  let connecting = false;
  let busy = false;
  let history = [];

  function controls() {
    connect.disabled = connecting || busy || !token.value.trim();
    disconnect.disabled = !connected || connecting || busy;
    token.disabled = connecting || busy;
    model.disabled = !connected || connecting || busy;
    input.disabled = !connected || connecting || busy;
    el('chatSend').disabled = !connected || connecting || busy || !input.value.trim();
    el('chatNew').disabled = connecting || busy;
    ids.disabled = connecting || busy;
    el('aiConnectProgress').hidden = !connecting;
  }

  function error(message = '') {
    el('aiSetupError').textContent = message;
    el('aiSetupError').hidden = !message;
  }

  function resetChat() {
    history = [];
    messages.replaceChildren();
    input.value = '';
  }

  function status(data) {
    connected = data.connected === true;
    const previous = model.value;
    model.replaceChildren();
    for (const item of data.models || []) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name || item.id;
      model.appendChild(option);
    }
    const options = [...model.options];
    model.value = options.find((item) => item.value === previous)?.value
      || options.find((item) => /luna/i.test(item.value))?.value || options[0]?.value || '';
    el('aiSetupStatus').textContent = connected ? 'Copilot connected' : 'Not connected';
    el('chatStatus').textContent = connected ? 'Copilot connected' : 'Connect to Copilot in Setup to start.';
    el('chatSetup').hidden = connected;
    controls();
  }

  function message(text, role) {
    const node = document.createElement('div');
    node.className = `message ${role}`;
    node.textContent = text;
    messages.appendChild(node);
    messages.scrollTop = messages.scrollHeight;
    return node;
  }

  function showChat(show) {
    box.classList.toggle('hidden', !show);
    toggle.setAttribute('aria-expanded', String(show));
    if (show && connected && !busy) input.focus();
    if (!show) toggle.focus();
  }

  toggle.addEventListener('click', () => showChat(box.classList.contains('hidden')));
  el('chatClose').addEventListener('click', () => showChat(false));
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') showChat(false);
  });
  el('chatSetup').addEventListener('click', () => {
    document.querySelector('#main-tab-0')?.click();
    token.focus();
    showChat(false);
    token.focus();
  });
  token.addEventListener('input', () => { error(); controls(); });
  input.addEventListener('input', controls);
  el('chatNew').addEventListener('click', () => {
    if (busy || connecting) return;
    resetChat();
    ids.value = '';
    controls();
    if (connected) input.focus();
  });

  connect.addEventListener('click', async () => {
    if (connect.disabled) return;
    connecting = true;
    error();
    resetChat();
    el('aiSetupStatus').textContent = 'Connecting to Copilot…';
    el('chatStatus').textContent = 'Connecting to Copilot…';
    controls();
    try {
      status(await api('/api/chat/connect', { method: 'POST', body: JSON.stringify({ token: token.value.trim() }) }));
      token.value = '';
    } catch (err) {
      status({ connected: false });
      error(err.message);
    } finally {
      connecting = false;
      controls();
    }
  });

  disconnect.addEventListener('click', async () => {
    if (disconnect.disabled) return;
    connecting = true;
    controls();
    error();
    try {
      status(await api('/api/chat/disconnect', { method: 'POST' }));
      token.value = '';
      resetChat();
    } catch (err) { error(err.message); }
    finally { connecting = false; controls(); }
  });

  el('chatForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || !connected || connecting || busy) return;
    const contextIds = ids.value.trim() ? ids.value.trim().split(/[\s,;]+/) : [];
    if (contextIds.length > 20 || contextIds.some((id) => !/^[1-9][0-9]{0,9}$/.test(id))) {
      el('chatStatus').textContent = 'Enter up to 20 positive work-item IDs, separated by commas or spaces.';
      ids.focus();
      return;
    }
    busy = true;
    input.value = '';
    controls();
    message(question, 'user');
    const reply = message('Thinking…', 'ai');
    try {
      const data = await api('/api/chat', {
        method: 'POST', body: JSON.stringify({ message: question, model: model.value, ids: contextIds, history }),
      });
      reply.textContent = data.answer;
      history.push({ role: 'user', content: question }, { role: 'assistant', content: data.answer.slice(0, 16000) });
      history = history.slice(-20);
      el('chatStatus').textContent = data.contextIds.length
        ? `Copilot connected · Attached: ${data.contextIds.join(', ')}` : 'Copilot connected';
    } catch (err) {
      reply.textContent = err.message;
      reply.classList.add('error');
      input.value = question;
    } finally {
      busy = false;
      controls();
      messages.scrollTop = messages.scrollHeight;
      if (!box.classList.contains('hidden')) input.focus();
    }
  });

  controls();
  api('/api/chat/status').then(status).catch((err) => {
    status({ connected: false });
    error(err.message);
  });
})();
