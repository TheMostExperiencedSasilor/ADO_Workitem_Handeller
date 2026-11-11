(() => {
  const $ = (id) => document.getElementById(id);
  if (!$('tcSearch')) return;
  const state = { results: [], page: 0, selected: null, version: 0, searchVersion: 0,
    historyLoaded: false, historyBusy: false, nextSkip: null, historyRows: [], historyPage: 0,
    historyError: '', historyPageMessage: '', historyWarnings: new Set(), historyFilterError: '' };
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
    $('tcDetailProgress').hidden = true; $('tcHistoryProgress').hidden = true;
    state.historyPage = 0; state.historyError = ''; state.historyPageMessage = ''; state.historyWarnings = new Set();
    historyFilterIds.forEach((id) => { $(id).value = ''; }); renderHistory();
    message('tcDetailStatus', ''); message('tcHistoryStatus', 'Open History to load execution results.');
  }
  $('tcSearch').addEventListener('submit', async (event) => {
    event.preventDefault();
    const version = ++state.searchVersion;
    clearSelection(); state.results = []; state.page = 0; renderResults();
    $('tcSearchButton').disabled = true; $('tcSearch').setAttribute('aria-busy', 'true');
    $('tcSearchProgress').hidden = false;
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
      if (version === state.searchVersion) { $('tcSearchButton').disabled = false; $('tcSearchProgress').hidden = true; $('tcSearch').setAttribute('aria-busy', 'false'); }
    }
  });
  const normalized = (value) => value.replace(/[^a-z0-9]/gi, '').toLowerCase();
  function acceptedDateField(field) {
    const names = ['automatedandaccepteddate', 'automatedaccepteddate'];
    return names.includes(normalized(field.name)) || names.includes(normalized(field.referenceName.split('.').pop()));
  }
  function fieldValue(field) {
    if (!acceptedDateField(field) || !field.value) return text(field.value);
    const date = new Date(field.value);
    if (Number.isNaN(date.getTime())) return text(field.value);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      hour12: true, timeZoneName: 'short',
    }).formatToParts(date).map((part) => [part.type, part.value]));
    return `${parts.month}/${parts.day}/${parts.year} ${parts.hour}:${parts.minute} ${parts.dayPeriod} ${parts.timeZoneName}`;
  }
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
        const detail = node('dd'); detail.appendChild(rich(fieldValue(entry)));
        if (acceptedDateField(entry)) detail.title = text(entry.value);
        list.append(term, detail); });
      return list;
    }
    const hiddenAutomation = fields.filter((field) => field.referenceName === 'Microsoft.VSTS.TCM.AutomationStatus'
      || normalized(field.name) === 'automationstatus');
    hiddenAutomation.forEach((field) => consumed.add(field.referenceName));
    const automation = fields.filter((field) => !consumed.has(field.referenceName)
      && /automat|testtool|scriptname|scriptlocation/i.test(field.name + field.referenceName));
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
    renderResults(); $('tcDetailProgress').hidden = false; message('tcDetailStatus', `Loading Test Case ${id}…`);
    try {
      const data = await request(`/api/work-items/test-cases/${id}`);
      if (version !== state.version) return;
      renderCase(data); message('tcDetailStatus', data.warning || '');
    } catch (error) { if (version === state.version) message('tcDetailStatus', error.message, true); }
    finally { if (version === state.version) $('tcDetailProgress').hidden = true; }
  }
  const historyFilterIds = ['tcHistorySuite', 'tcHistoryPlan', 'tcHistoryOutcome', 'tcHistoryTester', 'tcHistoryFrom', 'tcHistoryTo'];
  const outcomeKey = (value) => String(value || '').toLowerCase().replace(/[\s_-]+/g, '');
  function historySize() { const size = Number($('tcHistoryPageSize').value); return [10, 20, 30].includes(size) ? size : 20; }
  function filteredHistory() {
    const contains = (value, id) => String(value || '').toLowerCase().includes($(id).value.trim().toLowerCase());
    const wanted = outcomeKey($('tcHistoryOutcome').value);
    const from = $('tcHistoryFrom').value ? new Date(`${$('tcHistoryFrom').value}T00:00:00`) : null;
    const to = $('tcHistoryTo').value ? new Date(`${$('tcHistoryTo').value}T23:59:59.999`) : null;
    state.historyFilterError = from && to && from > to ? 'From date must be on or before To date.' : '';
    return state.historyFilterError ? [] : state.historyRows.filter((item) => {
      const outcome = outcomeKey(item.result);
      const resultMatch = !wanted || (wanted === 'other'
        ? !['failed', 'passed', 'blocked', 'notexecuted', 'notrun', 'inconclusive', 'aborted'].includes(outcome)
        : wanted === 'notexecuted' ? ['notexecuted', 'notrun'].includes(outcome) : outcome === wanted);
      const date = new Date(item.loggedDate);
      return contains(item.testSuite, 'tcHistorySuite') && contains(item.testPlan, 'tcHistoryPlan')
        && contains(item.tester, 'tcHistoryTester') && resultMatch
        && (!(from || to) || (!Number.isNaN(date.getTime()) && (!from || date >= from) && (!to || date <= to)));
    });
  }
  function renderHistory() {
    const filtered = filteredHistory();
    const size = historySize(), pages = Math.ceil(filtered.length / size);
    state.historyPage = Math.max(0, Math.min(state.historyPage, Math.max(0, pages - 1)));
    $('tcHistoryRows').replaceChildren();
    filtered.slice(state.historyPage * size, (state.historyPage + 1) * size).forEach((item) => {
      const row = node('tr');
      const date = new Date(item.loggedDate);
      const dateText = item.loggedDate && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Not recorded';
      for (const value of [item.testSuite, item.testPlan, item.result, dateText, item.tester || 'Not recorded']) row.appendChild(node('td', text(value)));
      const resultCell = row.children[2];
      resultCell.className = outcomeKey(item.result) === 'passed' ? 'tc-passed' : outcomeKey(item.result) === 'failed' ? 'tc-failed' : '';
      row.children[3].title = item.loggedDate;
      $('tcHistoryRows').appendChild(row);
    });
    if (!filtered.length && state.historyLoaded) {
      const row = node('tr'), cell = node('td', state.historyBusy ? 'No matches loaded yet. Older results are still loading…' : 'No execution results match the current filters.', 'tc-history-empty');
      cell.colSpan = 5; row.appendChild(cell); $('tcHistoryRows').appendChild(row);
    }
    $('tcHistoryFirst').disabled = $('tcHistoryPrev').disabled = state.historyPage === 0;
    $('tcHistoryNext').disabled = $('tcHistoryLast').disabled = state.historyPage >= pages - 1;
    if (document.activeElement !== $('tcHistoryPage')) $('tcHistoryPage').value = state.historyPage + 1;
    $('tcHistoryPage').max = Math.max(1, pages);
    $('tcHistoryPageTotal').textContent = `of ${pages}${state.historyBusy ? ' so far' : ''}`;
    $('tcHistoryCount').textContent = `${filtered.length} matching of ${state.historyRows.length} loaded${state.historyBusy ? ' so far' : ''}`;
    $('tcHistoryRefresh').disabled = state.historyBusy;
    $('tcHistoryMore').hidden = !state.historyError;
    $('tcHistoryMore').disabled = state.historyBusy;
    $('tcHistoryProgress').hidden = !state.historyBusy;
    $('tcHistory').setAttribute('aria-busy', String(state.historyBusy));
    const status = state.historyError ? `${state.historyError} Use Retry loading to continue, or Refresh history to start again.`
      : state.historyBusy ? `Loading execution history… ${state.historyRows.length} results loaded; searching older executions.`
      : !state.historyLoaded ? 'Open History to load execution results.'
      : state.historyRows.length ? `${state.historyRows.length} execution results loaded. All available history has been checked.`
      : 'No execution history returned by ADO for this test case.';
    const warning = [...state.historyWarnings].join(' ');
    message('tcHistoryStatus', [state.historyFilterError, state.historyPageMessage, status, warning].filter(Boolean).join(' '),
      Boolean(state.historyError || state.historyFilterError || state.historyPageMessage));
  }
  function goHistory(page) { state.historyPage = page; state.historyPageMessage = ''; renderHistory(); }
  $('tcHistoryFirst').addEventListener('click', () => goHistory(0));
  $('tcHistoryPrev').addEventListener('click', () => goHistory(state.historyPage - 1));
  $('tcHistoryNext').addEventListener('click', () => goHistory(state.historyPage + 1));
  $('tcHistoryLast').addEventListener('click', () => goHistory(Math.ceil(filteredHistory().length / historySize()) - 1));
  function typedHistoryPage() {
    const page = Number($('tcHistoryPage').value), pages = Math.ceil(filteredHistory().length / historySize());
    if (!Number.isInteger(page) || page < 1 || page > pages) {
      state.historyPageMessage = 'Enter an available page number. Older pages may still be loading.'; renderHistory(); return;
    }
    goHistory(page - 1);
  }
  $('tcHistoryGo').addEventListener('click', typedHistoryPage);
  $('tcHistoryPage').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); typedHistoryPage(); } });
  $('tcHistoryPageSize').addEventListener('change', () => goHistory(0));
  historyFilterIds.forEach((id) => $(id).addEventListener('input', () => goHistory(0)));
  $('tcHistoryClear').addEventListener('click', () => { historyFilterIds.forEach((id) => { $(id).value = ''; }); goHistory(0); });
  async function loadHistory(reset = false) {
    if (!state.selected || state.historyBusy) return;
    const version = state.version;
    let skip = reset ? 0 : state.nextSkip;
    if (skip === null) return;
    state.historyBusy = true; state.historyError = ''; state.historyPageMessage = '';
    if (reset) { state.historyRows = []; state.historyLoaded = false; state.nextSkip = null; state.historyPage = 0; state.historyWarnings = new Set(); }
    renderHistory();
    try {
      do {
        const data = await request(`/api/work-items/test-cases/${state.selected}/history?skip=${skip}`);
        if (version !== state.version) return;
        if (!Array.isArray(data.history) || (data.nextSkip !== null && (!Number.isInteger(data.nextSkip) || data.nextSkip <= skip))) {
          throw new Error('ADO returned an invalid history page.');
        }
        const identities = new Set(state.historyRows.filter((item) => item.runId != null && item.resultId != null).map((item) => `${item.runId}:${item.resultId}`));
        data.history.forEach((item) => {
          const key = item.runId != null && item.resultId != null ? `${item.runId}:${item.resultId}` : null;
          if (!key || !identities.has(key)) { state.historyRows.push(item); if (key) identities.add(key); }
        });
        (data.warnings || []).forEach((warning) => state.historyWarnings.add(warning));
        state.nextSkip = data.nextSkip; state.historyLoaded = true;
        renderHistory(); skip = data.nextSkip;
      } while (skip !== null);
    } catch (error) {
      if (version === state.version) { state.historyError = error.message; state.nextSkip = skip; }
    } finally {
      if (version === state.version) { state.historyBusy = false; renderHistory(); }
    }
  }
  $('tcHistoryRefresh').addEventListener('click', () => loadHistory(true));
  $('tcHistoryMore').addEventListener('click', () => loadHistory(false));
  help();
})();
