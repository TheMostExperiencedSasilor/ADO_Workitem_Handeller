(() => {
  const $ = (id) => document.getElementById(id);
  if (!$('tcSearch')) return;
  const state = { results: [], page: 0, selected: null, version: 0, searchVersion: 0,
    historyLoaded: false, historyBusy: false, nextSkip: null, historyRows: [] };
  const pageSize = 10;
  const tabs = [...document.querySelectorAll('[data-tc-tab]')];
  const text = (value) => {
    if (value == null || value === '') return '—';
    if (typeof value === 'object') return value.displayName || value.uniqueName || value.name || JSON.stringify(value);
    return String(value);
  };
  function node(tag, content, className) {
    const element = document.createElement(tag);
    if (content != null) element.textContent = content;
    if (className) element.className = className;
    return element;
  }
  function message(id, value, error = false) {
    $(id).textContent = value;
    $(id).classList.toggle('tc-error', error);
  }
  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (response.status === 405 || (response.status === 500 && /405 Method Not Allowed/i.test(data.error || ''))) {
      throw new Error('The running backend does not support this Test Case request. Stop and relaunch the app after updating, then reconnect to ADO. Refreshing the browser alone will not load the new backend.');
    }
    if (!response.ok) throw new Error(data.error || 'Could not load test case data.');
    return data;
  }
  // Rebuild a small HTML allowlist. ADO descriptions/steps are untrusted rich text.
  function rich(value) {
    const result = node('div', null, 'tc-rich');
    if (value == null || value === '') { result.textContent = 'Not provided'; return result; }
    const parsed = new DOMParser().parseFromString(String(value), 'text/html');
    const allowed = new Set(['P', 'DIV', 'BR', 'STRONG', 'B', 'I', 'EM', 'U', 'S', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'PRE', 'CODE', 'BLOCKQUOTE', 'A']);
    const blocked = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'LINK', 'META']);
    function copy(source, target) {
      for (const child of source.childNodes) {
        if (child.nodeType === 3) { target.appendChild(document.createTextNode(child.textContent)); continue; }
        if (child.nodeType !== 1 || blocked.has(child.tagName)) continue;
        if (!allowed.has(child.tagName)) { copy(child, target); continue; }
        const clean = document.createElement(child.tagName.toLowerCase());
        if (child.tagName === 'A') {
          try {
            const url = new URL(child.getAttribute('href'));
            if (['https:', 'http:'].includes(url.protocol)) {
              clean.href = url.href; clean.target = '_blank'; clean.rel = 'noopener noreferrer';
            }
          } catch { /* Keep link text without an unsafe or relative destination. */ }
        }
        copy(child, clean); target.appendChild(clean);
      }
    }
    copy(parsed.body, result);
    return result;
  }
  function activateTab(panelId) {
    tabs.forEach((tab) => {
      const active = tab.dataset.tcTab === panelId;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      $(tab.dataset.tcTab).hidden = !active;
    });
    if (panelId === 'tcHistory' && !state.historyLoaded && !state.historyBusy) loadHistory(true);
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tcTab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
      activateTab(tabs[next].dataset.tcTab); tabs[next].focus();
    });
  });
  function help() {
    const id = $('tcField').value === 'id';
    $('tcQuery').placeholder = id ? 'Enter a test case ID' : 'For example: HYSYS MCP';
    $('tcQuery').inputMode = id ? 'numeric' : 'text';
    $('tcSearchHelp').textContent = id
      ? 'Exact ID finds one test case. Flexible ID matches the starting digits; spaces are ignored.'
      : 'Flexible title: phrase at the start → phrase anywhere → all words in the same order. Exact match uses the full title (case-insensitive).';
  }
  $('tcField').addEventListener('change', help);
  function renderResults() {
    $('tcResultRows').replaceChildren();
    const start = state.page * pageSize;
    state.results.slice(start, start + pageSize).forEach((item) => {
      const row = node('tr');
      row.classList.toggle('tc-selected-row', state.selected === item.id);
      const input = document.createElement('input');
      input.type = 'radio'; input.name = 'tcSelection'; input.value = String(item.id);
      input.checked = state.selected === item.id;
      input.setAttribute('aria-label', `Select test case ${item.id}: ${item.title}`);
      input.addEventListener('change', () => selectCase(item.id));
      const cell = node('td'); cell.appendChild(input); row.appendChild(cell);
      for (const key of ['id', 'title', 'state', 'assignedTo']) row.appendChild(node('td', text(item[key])));
      row.addEventListener('click', (event) => { if (event.target !== input) { input.checked = true; selectCase(item.id); } });
      $('tcResultRows').appendChild(row);
    });
    $('tcResults').hidden = state.results.length === 0;
    $('tcPageInfo').textContent = `Page ${state.page + 1} of ${Math.max(1, Math.ceil(state.results.length / pageSize))} · ${state.results.length} test cases · select one`;
    $('tcPrev').disabled = state.page === 0;
    $('tcNext').disabled = start + pageSize >= state.results.length;
  }
  $('tcPrev').addEventListener('click', () => { state.page--; renderResults(); });
  $('tcNext').addEventListener('click', () => { state.page++; renderResults(); });
  function clearSelection() {
    state.version++; state.selected = null; state.historyLoaded = false; state.historyBusy = false;
    state.nextSkip = null; state.historyRows = [];
    $('tcSelected').hidden = true; $('tcHistoryRows').replaceChildren();
    $('tcHistoryMore').hidden = true; $('tcHistoryRefresh').disabled = false;
    message('tcDetailStatus', ''); message('tcHistoryStatus', 'Open History to load execution results.');
  }
  $('tcSearch').addEventListener('submit', async (event) => {
    event.preventDefault();
    const version = ++state.searchVersion;
    clearSelection(); state.results = []; state.page = 0; renderResults();
    $('tcSearchButton').disabled = true; $('tcSearch').setAttribute('aria-busy', 'true');
    message('tcSearchStatus', 'Searching ADO Test Cases…');
    try {
      const data = await request('/api/work-items/test-cases/search', { method: 'POST', body: JSON.stringify({
        field: $('tcField').value, mode: $('tcMode').value, query: $('tcQuery').value,
      }) });
      if (version !== state.searchVersion) return;
      state.results = data.testCases; renderResults();
      message('tcSearchStatus', state.results.length ? `${state.results.length} test case${state.results.length === 1 ? '' : 's'} found. Select one to view.` : 'No matching Test Cases found.');
    } catch (error) {
      if (version === state.searchVersion) message('tcSearchStatus', error.message, true);
    } finally {
      if (version === state.searchVersion) { $('tcSearchButton').disabled = false; $('tcSearch').setAttribute('aria-busy', 'false'); }
    }
  });
  const normalized = (value) => value.replace(/[^a-z0-9]/gi, '').toLowerCase();
  function renderCase(data) {
    const fields = data.fields;
    const find = (...names) => fields.find((field) => names.some((name) => normalized(field.name) === normalized(name)
      || normalized(field.referenceName.split('.').pop()) === normalized(name)));
    const value = (...names) => find(...names)?.value;
    $('tcSelectedId').textContent = `TEST CASE ${data.id}`;
    $('tcSelectedTitle').textContent = data.title;
    $('tcSelectedMeta').textContent = `${text(value('State'))} · ${text(value('AssignedTo'))} · ${text(value('AreaPath'))}`;
    $('tcAdoLink').href = data.url;
    $('tcDetails').replaceChildren(); $('tcAutomation').replaceChildren();
    const layout = node('div', null, 'tc-detail-layout');
    const main = node('div'); const planning = node('aside', null, 'tc-planning');
    const consumed = new Set(['System.Description', 'Microsoft.VSTS.TCM.Steps']);
    function section(parent, title, content) { const block = node('section', null, 'tc-section'); block.append(node('h4', title), content); parent.appendChild(block); }
    section(main, 'Description', rich(value('Description')));
    const preconditions = find('PreConditions', 'Precondition', 'PreConditionsBlock');
    if (preconditions) consumed.add(preconditions.referenceName);
    section(main, 'Pre Conditions', rich(preconditions?.value));
    const table = node('table', null, 'tc-table tc-steps');
    const head = node('thead'); const headings = node('tr');
    ['Step', 'Action', 'Expected result'].forEach((label) => headings.appendChild(node('th', label)));
    head.appendChild(headings); table.appendChild(head);
    const body = node('tbody');
    data.steps.forEach((step, index) => { const row = node('tr'); row.appendChild(node('td', String(index + 1)));
      for (const key of ['action', 'expected']) { const cell = node('td'); cell.appendChild(rich(step[key])); row.appendChild(cell); }
      body.appendChild(row); });
    table.appendChild(body); const wrap = node('div', null, 'tc-table-wrap'); wrap.appendChild(table);
    section(main, 'Steps', data.steps.length ? wrap : node('p', 'No steps provided.'));
    function fieldList(entries) {
      const list = node('dl', null, 'tc-field-list');
      entries.forEach((entry) => { const term = node('dt', entry.name); term.title = entry.referenceName;
        const detail = node('dd'); detail.appendChild(rich(text(entry.value))); list.append(term, detail); });
      return list;
    }
    const automation = fields.filter((field) => /automat|testtool|scriptname|scriptlocation/i.test(field.name + field.referenceName));
    automation.forEach((field) => consumed.add(field.referenceName));
    section($('tcAutomation'), 'Associated Automation', fieldList(automation));
    if (!automation.length) $('tcAutomation').appendChild(node('p', 'No automation details recorded.'));
    const notes = find('Notes');
    if (notes) { section($('tcAutomation'), 'Notes', rich(notes.value)); consumed.add(notes.referenceName); }
    const planningFields = fields.filter((field) => !consumed.has(field.referenceName)
      && !field.referenceName.startsWith('System.') && field.value !== '' && field.value != null);
    section(planning, 'Planning', fieldList(planningFields));
    section(planning, 'Classification', fieldList(fields.filter((field) => ['System.State', 'System.Reason', 'System.AssignedTo', 'System.AreaPath', 'System.IterationPath', 'System.Tags'].includes(field.referenceName))));
    layout.append(main, planning); $('tcDetails').appendChild(layout);
    $('tcSelected').hidden = false;
    activateTab('tcDetails');
  }
  async function selectCase(id) {
    clearSelection(); state.selected = id; const version = state.version;
    renderResults(); message('tcDetailStatus', `Loading Test Case ${id}…`);
    try {
      const data = await request(`/api/work-items/test-cases/${id}`);
      if (version !== state.version) return;
      renderCase(data); message('tcDetailStatus', data.warning || '');
    } catch (error) { if (version === state.version) message('tcDetailStatus', error.message, true); }
  }
  function renderHistory() {
    $('tcHistoryRows').replaceChildren();
    state.historyRows.forEach((item) => {
      const row = node('tr');
      const date = new Date(item.loggedDate);
      const dateText = item.loggedDate && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Not recorded';
      for (const value of [item.testSuite, item.testPlan, item.result, dateText, item.tester || 'Not recorded']) row.appendChild(node('td', text(value)));
      const resultCell = row.children[2];
      resultCell.className = item.result.toLowerCase() === 'passed' ? 'tc-passed' : item.result.toLowerCase() === 'failed' ? 'tc-failed' : '';
      row.children[3].title = item.loggedDate;
      $('tcHistoryRows').appendChild(row);
    });
  }
  async function loadHistory(reset = false) {
    if (!state.selected || state.historyBusy) return;
    const version = state.version;
    const skip = reset ? 0 : state.nextSkip;
    if (skip === null) return;
    state.historyBusy = true;
    if (reset) { state.historyRows = []; state.nextSkip = null; renderHistory(); $('tcHistoryMore').hidden = true; }
    $('tcHistoryRefresh').disabled = true; $('tcHistoryMore').disabled = true;
    message('tcHistoryStatus', 'Loading execution history…');
    try {
      const data = await request(`/api/work-items/test-cases/${state.selected}/history?skip=${skip}`);
      if (version !== state.version) return;
      state.historyRows.push(...data.history); state.nextSkip = data.nextSkip; state.historyLoaded = true;
      renderHistory(); $('tcHistoryMore').hidden = data.nextSkip === null;
      message('tcHistoryStatus', state.historyRows.length ? `${state.historyRows.length} execution result${state.historyRows.length === 1 ? '' : 's'} loaded.${data.nextSkip !== null ? ' Load more for older results.' : ''}`
        : 'No execution history returned by ADO for this test case.');
    } catch (error) { if (version === state.version) message('tcHistoryStatus', `${error.message} Use Refresh history to retry.`, true); }
    finally { if (version === state.version) { state.historyBusy = false; $('tcHistoryRefresh').disabled = false; $('tcHistoryMore').disabled = false; } }
  }
  $('tcHistoryRefresh').addEventListener('click', () => loadHistory(true));
  $('tcHistoryMore').addEventListener('click', () => loadHistory(false));
  help();
})();
