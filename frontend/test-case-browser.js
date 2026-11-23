function mountPostDevelopmentBugBrowser() {
  const target = document.querySelector?.('[data-work-page="post-development-bug"]');
  const source = document.querySelector?.('[data-work-page="test-case"]');
  if (!target || !source) return null;

  const view = document.createDocumentFragment();
  for (const element of source.children) {
    if (!element.matches('.work-page-heading')) view.appendChild(element.cloneNode(true));
  }
  for (const id of ['tcAutomation', 'tcAutomationTab', 'tcHistory', 'tcHistoryTab']) view.querySelector('#' + id).remove();

  const links = target.querySelector('#pdbLinkView').content.cloneNode(true);
  view.querySelector('.tc-tabs').appendChild(links.querySelector('#tcLinksTab'));
  view.querySelector('#tcSelected').insertBefore(links.querySelector('#tcLinks'), view.querySelector('#tcHistoryCalendar'));

  for (const element of view.querySelectorAll('[id], [aria-controls], [aria-labelledby], [aria-label]')) {
    for (const attribute of ['id', 'aria-controls', 'aria-labelledby']) {
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, value.replace(/\btc(?=[A-Z])/g, 'pdb'));
    }
    const label = element.getAttribute('aria-label');
    if (label) element.setAttribute('aria-label', label.replace(/test case/gi, 'post development bug'));
  }
  view.querySelector('caption').textContent = 'Search results — select one post development bug';
  target.appendChild(view);
  return target;
}

function initializeWorkItemBrowser(bugPage = null) {
  const isBug = Boolean(bugPage);
  const itemName = isBug ? 'Post Development Bug' : 'Test Case';
  const itemLabel = itemName.toLowerCase();
  const api = '/api/work-items/' + (isBug ? 'post-development-bugs' : 'test-cases');
  const $ = (id) => document.getElementById(isBug ? id.replace(/^tc/, 'pdb') : id);
  if (!$('tcSearch')) return;
  const state = { results: [], page: 0, selected: null, version: 0, searchVersion: 0,
    historyLoaded: false, historyBusy: false, nextSkip: null, historyRows: [], historyPage: 0,
    historyError: '', historyPageMessage: '', historyWarnings: new Set(), historyFilterError: '' };
  const pageSize = 10;
  let linksLoaded = false, linksLoading = false;
  const tabs = [...(bugPage ? bugPage.querySelectorAll('[data-tc-tab]') : document.querySelectorAll('[data-tc-tab]:not([id^=pdb])'))];
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
      throw new Error(`The running backend does not support this ${itemName} request. Stop and relaunch the app after updating, then reconnect to ADO. Refreshing the browser alone will not load the new backend.`);
    }
    if (!response.ok) throw new Error(data.error || `Could not load ${itemLabel} data.`);
    return data;
  }
  // Rebuild a small HTML allowlist. ADO descriptions/steps are untrusted rich text.
  function rich(value, parse = (html) => new DOMParser().parseFromString(html, 'text/html').body) {
    const result = node('div', null, 'tc-rich');
    if (value == null || value === '') { result.textContent = 'Not provided'; return result; }
    const parsed = parse(String(value));
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
    copy(parsed, result);
    return result;
  }
  function activateTab(panelId) {
    tabs.forEach((tab) => {
      const active = tab.dataset.tcTab === panelId;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      $(tab.dataset.tcTab).hidden = !active;
    });
    if (activeRange?.panel !== panelId) closeCalendar(false);
    if (panelId === 'tcModHistory') modifications.load();
    if (panelId === 'tcLinks') loadLinks();
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
    $('tcQuery').placeholder = id ? `Enter a ${itemLabel} ID` : isBug ? 'Enter a bug title' : 'For example: HYSYS MCP';
    $('tcQuery').inputMode = id ? 'numeric' : 'text';
    $('tcSearchHelp').textContent = id
      ? `Exact ID finds one ${itemLabel}. Flexible ID matches the starting digits; spaces are ignored.`
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
      input.type = 'radio'; input.name = isBug ? 'pdbSelection' : 'tcSelection'; input.value = String(item.id);
      input.checked = state.selected === item.id;
      input.setAttribute('aria-label', `Select ${itemLabel} ${item.id}: ${item.title}`);
      input.addEventListener('change', () => selectCase(item.id));
      const cell = node('td'); cell.appendChild(input); row.appendChild(cell);
      for (const key of ['id', 'title', 'state', 'assignedTo']) row.appendChild(node('td', text(item[key])));
      row.addEventListener('click', (event) => { if (event.target !== input) { input.checked = true; selectCase(item.id); } });
      $('tcResultRows').appendChild(row);
    });
    $('tcResults').hidden = state.results.length === 0;
    $('tcPageInfo').textContent = `Page ${state.page + 1} of ${Math.max(1, Math.ceil(state.results.length / pageSize))} · ${state.results.length} ${itemLabel}${state.results.length === 1 ? '' : 's'} · select one`;
    $('tcPrev').disabled = state.page === 0;
    $('tcNext').disabled = start + pageSize >= state.results.length;
  }
  $('tcPrev').addEventListener('click', () => { state.page--; renderResults(); });
  $('tcNext').addEventListener('click', () => { state.page++; renderResults(); });
  function clearSelection() {
    closeCalendar(false); modifications.reset();
    state.version++; state.selected = null;
    $('tcSelected').hidden = true; $('tcDetailProgress').hidden = true;
    message('tcDetailStatus', '');
    if (isBug) {
      linksLoaded = false; linksLoading = false;
      $('tcLinksGroups').replaceChildren();
      $('tcLinksRetry').hidden = true;
      message('tcLinksStatus', '');
      return;
    }
    state.historyLoaded = false; state.historyBusy = false;
    state.nextSkip = null; state.historyRows = [];
    $('tcHistoryRows').replaceChildren();
    $('tcHistoryMore').hidden = true; $('tcHistoryRefresh').disabled = false;
    $('tcHistoryProgress').hidden = true;
    state.historyPage = 0; state.historyError = ''; state.historyPageMessage = ''; state.historyWarnings = new Set();
    historyFilterIds.forEach((id) => { $(id).value = ''; }); renderHistory();
    message('tcHistoryStatus', 'Open Execution History to load execution results.');
  }
  $('tcSearch').addEventListener('submit', async (event) => {
    event.preventDefault();
    const version = ++state.searchVersion;
    clearSelection(); state.results = []; state.page = 0; renderResults();
    $('tcSearchButton').disabled = true; $('tcSearch').setAttribute('aria-busy', 'true');
    $('tcSearchProgress').hidden = false;
    message('tcSearchStatus', `Searching ADO ${itemName}s…`);
    try {
      const data = await request(`${api}/search`, { method: 'POST', body: JSON.stringify({
        field: $('tcField').value, mode: $('tcMode').value, query: $('tcQuery').value,
      }) });
      if (version !== state.searchVersion) return;
      state.results = isBug ? data.bugs : data.testCases; renderResults();
      message('tcSearchStatus', state.results.length ? `${state.results.length} ${itemLabel}${state.results.length === 1 ? '' : 's'} found. Select one to view.` : `No matching ${itemName}s found.`);
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
  function renderSteps(steps, warning) {
    const content = node('div');
    const toolbar = node('div', null, 'tc-step-toolbar');
    const status = node('span');
    status.setAttribute('role', 'status');
    const copyAll = node('button', 'Copy All Steps', 'secondary-button');
    copyAll.type = 'button';
    copyAll.setAttribute('aria-haspopup', 'dialog');
    copyAll.setAttribute('aria-controls', 'tcCopyDialog');
    const normalizedSteps = testStepMarkdown.prepare(steps);
    copyAll.addEventListener('click', () => testStepCopy.open(normalizedSteps, copyAll, warning));
    toolbar.append(copyAll, status);
    content.appendChild(toolbar);
    if (warning) content.appendChild(node('p', warning, 'tc-hint'));

    const table = node('table', null, 'tc-table tc-steps');
    const head = node('thead');
    const headings = node('tr');
    ['Step', 'Action', 'Expected result'].forEach((label) => headings.appendChild(node('th', label)));
    head.appendChild(headings);
    const body = node('tbody');
    steps.forEach((step, index) => {
      const row = node('tr');
      const prepared = normalizedSteps[index];
      const number = node('td');
      const stepControls = node('div', null, 'tc-step-controls');
      stepControls.append(node('span', prepared.step), testStepCopy.buttonFor(prepared, (value, error = false) => {
        status.textContent = value;
        status.classList.toggle('tc-error', error);
      }));
      number.appendChild(stepControls);
      row.appendChild(number);
      for (const key of ['action', 'expected']) {
        const cell = node('td');
        cell.appendChild(rich(step[key], testStepMarkdown.parseHtml));
        row.appendChild(cell);
      }
      body.appendChild(row);
    });
    table.append(head, body);
    const wrap = node('div', null, 'tc-table-wrap');
    wrap.appendChild(table);
    content.appendChild(wrap);
    return content;
  }
  function renderCase(data) {
    const fields = data.fields;
    const find = (...names) => fields.find((field) => names.some((name) => normalized(field.name) === normalized(name)
      || normalized(field.referenceName.split('.').pop()) === normalized(name)));
    const value = (...names) => find(...names)?.value;
    $('tcSelectedId').textContent = `${itemName.toUpperCase()} ${data.id}`;
    $('tcSelectedTitle').textContent = data.title;
    $('tcSelectedMeta').textContent = `${text(value('State'))} · ${text(value('AssignedTo'))} · ${text(value('AreaPath'))}`;
    $('tcAdoLink').href = data.url;
    $('tcDetails').replaceChildren();
    if (!isBug) $('tcAutomation').replaceChildren();
    const layout = node('div', null, 'tc-detail-layout');
    const main = node('div'); const planning = node('aside', null, 'tc-planning');
    const consumed = new Set(['System.Description', 'Microsoft.VSTS.TCM.Steps']);
    function section(parent, title, content) { const block = node('section', null, 'tc-section'); block.append(node('h4', title), content); parent.appendChild(block); }
    section(main, 'Description', rich(value('Description')));
    if (isBug) {
      for (const [label, names] of [
        ['Repro Steps', ['Repro Steps', 'Reproduction Steps']],
        ['System Info', ['System Info']],
        ['Resolution', ['Resolution', 'Resolution Details']],
      ]) {
        const field = find(...names);
        if (field?.value) {
          consumed.add(field.referenceName);
          section(main, label, rich(field.value));
        }
      }
      setLinkCount(data.linkCount ?? 0);
    } else {
      const preconditions = find('PreConditions', 'Precondition', 'PreConditionsBlock');
      if (preconditions) consumed.add(preconditions.referenceName);
      section(main, 'Pre Conditions', rich(preconditions?.value));
      section(main, 'Steps', data.steps.length ? renderSteps(data.steps, data.stepsWarning) : node('p', 'No steps provided.'));
    }
    function fieldList(entries) {
      const list = node('dl', null, 'tc-field-list');
      entries.forEach((entry) => { const term = node('dt', entry.name); term.title = entry.referenceName;
        const detail = node('dd');
        if (entry.referenceName === 'System.Tags') {
          const labels = String(entry.value ?? '').split(';').map((label) => label.trim()).filter(Boolean);
          if (labels.length) {
            const tags = node('ul', null, 'tc-tags');
            tags.setAttribute('role', 'list');
            labels.forEach((label) => tags.appendChild(node('li', label, 'tc-tag')));
            detail.appendChild(tags);
          } else {
            detail.textContent = '—';
          }
        } else if (acceptedDateField(entry) || testCaseDateTime.isDateField(entry, entry.value)) {
          detail.textContent = testCaseDateTime.format(entry.value, text(entry.value));
          if (entry.value) detail.title = text(entry.value);
        } else {
          detail.appendChild(rich(text(entry.value)));
        }
        list.append(term, detail); });
      return list;
    }
    if (!isBug) {
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
    }
    const planningFields = fields.filter((field) => !consumed.has(field.referenceName)
      && !field.referenceName.startsWith('System.') && field.value !== '' && field.value != null);
    section(planning, 'Planning', fieldList(planningFields));
    section(planning, 'Classification', fieldList(fields.filter((field) => ['System.State', 'System.Reason', 'System.AssignedTo', 'System.AreaPath', 'System.IterationPath', 'System.Tags'].includes(field.referenceName))));
    layout.append(main, planning); $('tcDetails').appendChild(layout);
    $('tcSelected').hidden = false;
    modifications.reset(data.id, fields);
    activateTab('tcDetails');
  }
  async function selectCase(id) {
    clearSelection(); state.selected = id; const version = state.version;
    renderResults(); $('tcDetailProgress').hidden = false; message('tcDetailStatus', `Loading ${itemName} ${id}…`);
    try {
      const data = await request(`${api}/${id}`);
      if (version !== state.version) return;
      renderCase(data); message('tcDetailStatus', data.warning || '');
    } catch (error) { if (version === state.version) message('tcDetailStatus', error.message, true); }
    finally { if (version === state.version) $('tcDetailProgress').hidden = true; }
  }
  const historyFilterIds = ['tcHistorySuite', 'tcHistoryPlan', 'tcHistoryOutcome', 'tcHistoryTester', 'tcHistoryFrom', 'tcHistoryTo'];
  const calendar = { month: new Date(), awaitingEnd: false, focus: '', buttons: new Map() };
  const popup = $('tcHistoryCalendar');
  let activeRange = null;
  const dayKey = (date) => `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const readDay = (key) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(key || '') ? new Date(`${key}T12:00:00`) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  };
  const monthDay = (year, month, day = 1) => new Date(year, month, day, 12);
  function calendarDateLabel(key) {
    const date = readDay(key);
    return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).format(date) : '';
  }
  function updateCalendarTrigger(range) {
    const start = range.from.value, end = range.to.value;
    range.trigger.classList.toggle('active', Boolean(start || end));
    range.trigger.title = start || end
      ? `${calendarDateLabel(start) || 'Any date'} – ${calendarDateLabel(end) || 'Any date'}. Click to choose a date range.`
      : 'Choose a start date, then an end date. A third click starts a new range.';
  }
  function positionCalendar() {
    if (!activeRange) return;
    const anchor = activeRange.trigger.getBoundingClientRect();
    const width = popup.offsetWidth || 310, height = popup.offsetHeight || 390;
    const left = Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12));
    const top = anchor.bottom + height + 8 <= window.innerHeight - 12 ? anchor.bottom + 8 : Math.max(12, anchor.top - height - 8);
    popup.style.left = `${left}px`; popup.style.top = `${top}px`;
  }
  function closeCalendar(returnFocus = true) {
    if (!activeRange) return;
    const { trigger } = activeRange;
    popup.hidden = true;
    activeRange = null;
    trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus) trigger.focus();
  }
  function chooseCalendarDay(key) {
    const { from, to, onChange } = activeRange;
    const start = from.value;
    if (!calendar.awaitingEnd || !start) {
      from.value = key; to.value = ''; calendar.awaitingEnd = true;
    } else {
      from.value = key < start ? key : start;
      to.value = key < start ? start : key;
      calendar.awaitingEnd = false;
    }
    const date = readDay(key);
    calendar.month = monthDay(date.getFullYear(), date.getMonth()); calendar.focus = key;
    onChange(); renderCalendar(); calendar.buttons.get(key)?.focus();
  }
  function moveCalendarMonth(offset) {
    calendar.month = monthDay(calendar.month.getFullYear(), calendar.month.getMonth() + offset);
    calendar.focus = dayKey(calendar.month); renderCalendar();
  }
  function calendarKeydown(event, key) {
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(event.key in offsets) && !['Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return;
    event.preventDefault();
    let date = readDay(key);
    if (event.key in offsets) date.setDate(date.getDate() + offsets[event.key]);
    else if (event.key === 'Home') date.setDate(date.getDate() - date.getDay());
    else if (event.key === 'End') date.setDate(date.getDate() + 6 - date.getDay());
    else {
      const next = monthDay(date.getFullYear(), date.getMonth() + (event.key === 'PageUp' ? -1 : 1));
      date = monthDay(next.getFullYear(), next.getMonth(), Math.min(date.getDate(), monthDay(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
    }
    calendar.focus = dayKey(date); calendar.month = monthDay(date.getFullYear(), date.getMonth());
    renderCalendar(); calendar.buttons.get(calendar.focus)?.focus();
  }
  function renderCalendar() {
    const year = calendar.month.getFullYear(), month = calendar.month.getMonth();
    const start = activeRange.from.value, end = activeRange.to.value, today = dayKey(new Date());
    const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(calendar.month);
    $('tcCalendarMonth').replaceChildren();
    for (let index = 0; index < 12; index++) {
      const option = node('option', new Intl.DateTimeFormat('en-US', { month: 'long' }).format(monthDay(year, index)));
      option.value = String(index); $('tcCalendarMonth').appendChild(option);
    }
    $('tcCalendarMonth').value = String(month);
    $('tcCalendarYear').replaceChildren();
    for (let value = Math.min(1990, year); value <= Math.max(new Date().getFullYear() + 10, year); value++) {
      const option = node('option', String(value)); option.value = String(value); $('tcCalendarYear').appendChild(option);
    }
    $('tcCalendarYear').value = String(year);
    const grid = $('tcCalendarDays'); grid.replaceChildren(); grid.setAttribute('aria-label', monthLabel);
    const weekdays = node('div', null, 'tc-calendar-week'); weekdays.setAttribute('role', 'row');
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((day) => { const cell = node('span', day); cell.setAttribute('role', 'columnheader'); weekdays.appendChild(cell); });
    grid.appendChild(weekdays); calendar.buttons = new Map();
    const first = monthDay(year, month); first.setDate(first.getDate() - first.getDay());
    if (!calendar.focus) calendar.focus = start || (new Date().getMonth() === month && new Date().getFullYear() === year ? today : dayKey(calendar.month));
    for (let week = 0; week < 6; week++) {
      const row = node('div', null, 'tc-calendar-week'); row.setAttribute('role', 'row');
      for (let day = 0; day < 7; day++) {
        const date = monthDay(first.getFullYear(), first.getMonth(), first.getDate() + week * 7 + day), key = dayKey(date);
        const endpoint = key === start || key === end, inside = Boolean(start && end && key >= start && key <= end);
        const cell = node('div', null, 'tc-calendar-cell'); cell.setAttribute('role', 'gridcell'); cell.setAttribute('aria-selected', String(endpoint || inside));
        const button = node('button', String(date.getDate()), 'tc-calendar-day'); button.type = 'button'; button.dataset.date = key;
        button.classList.toggle('outside', date.getMonth() !== month); button.classList.toggle('today', key === today);
        button.classList.toggle('endpoint', endpoint); button.classList.toggle('in-range', inside);
        button.tabIndex = key === calendar.focus ? 0 : -1;
        button.setAttribute('aria-label', `${calendarDateLabel(key)}${key === start ? ', start date' : ''}${key === end ? ', end date' : ''}`);
        if (key === today) button.setAttribute('aria-current', 'date');
        button.addEventListener('click', () => chooseCalendarDay(key));
        button.addEventListener('keydown', (event) => calendarKeydown(event, key));
        cell.appendChild(button); row.appendChild(cell); calendar.buttons.set(key, button);
      }
      grid.appendChild(row);
    }
    $('tcCalendarRange').textContent = start ? `${calendarDateLabel(start)}${end ? ` – ${calendarDateLabel(end)}` : ' – …'}` : end ? `Through ${calendarDateLabel(end)}` : 'All dates';
    $('tcCalendarHint').textContent = calendar.awaitingEnd ? 'Choose an end date.' : start && end ? 'Range selected. Click a date to start a new range.' : 'Choose a start date.';
    updateCalendarTrigger(activeRange); positionCalendar();
  }
  function bindCalendar(panel, latest, onChange) {
    const range = { panel, from: $(panel + 'From'), to: $(panel + 'To'), trigger: $(panel + 'DateTrigger'), onChange };
    const { from, to, trigger } = range;
    trigger.addEventListener('click', () => {
      if (activeRange === range) { closeCalendar(); return; }
      closeCalendar(false);
      activeRange = range;
      const date = readDay(from.value || to.value) || readDay(testCaseDateTime.dayKey(latest())) || new Date();
      calendar.month = monthDay(date.getFullYear(), date.getMonth()); calendar.focus = dayKey(date);
      calendar.awaitingEnd = Boolean(from.value && !to.value);
      popup.hidden = false; trigger.setAttribute('aria-expanded', 'true');
      renderCalendar(); calendar.buttons.get(calendar.focus)?.focus();
    });
    return {
      update: () => updateCalendarTrigger(range),
      sync: () => {
        updateCalendarTrigger(range);
        if (activeRange === range) {
          calendar.awaitingEnd = Boolean(from.value && !to.value);
          renderCalendar();
        }
      },
    };
  }
  const executionCalendar = isBug ? null : bindCalendar('tcHistory', () => state.historyRows.find((row) => testCaseDateTime.parse(row.loggedDate))?.loggedDate, () => goHistory(0));
  const modificationCalendar = bindCalendar('tcModHistory', () => modifications.latest(), () => modifications.filter());
  const modifications = createModificationHistory({ $, node, request, rich, syncCalendar: modificationCalendar.sync, api, itemName });
  $('tcCalendarPrev').addEventListener('click', () => moveCalendarMonth(-1));
  $('tcCalendarNext').addEventListener('click', () => moveCalendarMonth(1));
  $('tcCalendarMonth').addEventListener('change', () => {
    calendar.month = monthDay(calendar.month.getFullYear(), Number($('tcCalendarMonth').value)); calendar.focus = dayKey(calendar.month); renderCalendar();
  });
  $('tcCalendarYear').addEventListener('change', () => {
    calendar.month = monthDay(Number($('tcCalendarYear').value), calendar.month.getMonth()); calendar.focus = dayKey(calendar.month); renderCalendar();
  });
  $('tcCalendarClear').addEventListener('click', () => {
    const { from, to, onChange } = activeRange;
    from.value = ''; to.value = ''; calendar.awaitingEnd = false; onChange(); renderCalendar();
  });
  $('tcCalendarClose').addEventListener('click', () => closeCalendar());
  $('tcCalendarDone').addEventListener('click', () => closeCalendar());
  document.addEventListener('click', (event) => {
    if (!activeRange) return;
    // The event path survives a day button being replaced when the grid refreshes.
    const path = event.composedPath?.() || [];
    const { trigger } = activeRange;
    if (!path.includes(popup) && !path.includes(trigger)
      && !popup.contains(event.target) && !trigger.contains(event.target)) closeCalendar(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && activeRange) { event.preventDefault(); closeCalendar(); }
  });
  window.addEventListener('resize', positionCalendar);
  document.addEventListener('scroll', positionCalendar, true);
  const outcomeKey = (value) => String(value || '').toLowerCase().replace(/[\s_-]+/g, '');
  function historySize() { const size = Number($('tcHistoryPageSize').value); return [10, 20, 30].includes(size) ? size : 20; }
  function filteredHistory() {
    const contains = (value, id) => String(value || '').toLowerCase().includes($(id).value.trim().toLowerCase());
    const wanted = outcomeKey($('tcHistoryOutcome').value);
    const from = $('tcHistoryFrom').value, to = $('tcHistoryTo').value;
    state.historyFilterError = from && to && from > to ? 'From date must be on or before To date.' : '';
    return state.historyFilterError ? [] : state.historyRows.filter((item) => {
      const outcome = outcomeKey(item.result);
      const resultMatch = !wanted || (wanted === 'other'
        ? !['failed', 'passed', 'blocked', 'notexecuted', 'notrun', 'inconclusive', 'aborted'].includes(outcome)
        : wanted === 'notexecuted' ? ['notexecuted', 'notrun'].includes(outcome) : outcome === wanted);
      return contains(item.testSuite, 'tcHistorySuite') && contains(item.testPlan, 'tcHistoryPlan')
        && contains(item.tester, 'tcHistoryTester') && resultMatch
        && testCaseDateTime.inRange(item.loggedDate, from, to);
    });
  }
  function renderHistory() {
    executionCalendar.update();
    const filtered = filteredHistory();
    const size = historySize(), pages = Math.ceil(filtered.length / size);
    state.historyPage = Math.max(0, Math.min(state.historyPage, Math.max(0, pages - 1)));
    $('tcHistoryRows').replaceChildren();
    filtered.slice(state.historyPage * size, (state.historyPage + 1) * size).forEach((item) => {
      const row = node('tr');
      const dateText = testCaseDateTime.format(item.loggedDate);
      for (const value of [item.testSuite, item.testPlan, item.result, dateText, item.tester || 'Not recorded']) row.appendChild(node('td', text(value)));
      const resultCell = row.children[2];
      resultCell.className = outcomeKey(item.result) === 'passed' ? 'tc-passed' : outcomeKey(item.result) === 'failed' ? 'tc-failed' : '';
      if (item.loggedDate) row.children[3].title = item.loggedDate;
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
      : !state.historyLoaded ? 'Open Execution History to load execution results.'
      : state.historyRows.length ? `${state.historyRows.length} execution results loaded. All available history has been checked.`
      : 'No execution history returned by ADO for this test case.';
    const warning = [...state.historyWarnings].join(' ');
    message('tcHistoryStatus', [state.historyFilterError, state.historyPageMessage, status, warning].filter(Boolean).join(' '),
      Boolean(state.historyError || state.historyFilterError || state.historyPageMessage));
  }
  function goHistory(page) { state.historyPage = page; state.historyPageMessage = ''; renderHistory(); }
  if (!isBug) {
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
    historyFilterIds.forEach((id) => $(id).addEventListener('input', () => {
      if (id === 'tcHistoryFrom' || id === 'tcHistoryTo') executionCalendar.sync();
      goHistory(0);
    }));
    $('tcHistoryClear').addEventListener('click', () => {
      historyFilterIds.forEach((id) => { $(id).value = ''; });
      executionCalendar.sync();
      goHistory(0);
    });
  }
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
  if (!isBug) {
    $('tcHistoryRefresh').addEventListener('click', () => loadHistory(true));
    $('tcHistoryMore').addEventListener('click', () => loadHistory(false));
  } else {
    $('tcLinksRetry').addEventListener('click', loadLinks);
  }

  function setLinkCount(count) {
    $('tcLinksTab').setAttribute('aria-label', `Links (${count})`);
    $('tcLinksCount').textContent = count ? String(count) : '';
  }

  function renderLinks(links) {
    const labels = new Map([
      ['System.LinkTypes.Related', 'Related'],
      ['System.LinkTypes.Hierarchy-Forward', 'Child'],
      ['System.LinkTypes.Hierarchy-Reverse', 'Parent'],
      ['System.LinkTypes.Dependency-Forward', 'Successor'],
      ['System.LinkTypes.Dependency-Reverse', 'Predecessor'],
      ['Hyperlink', 'Hyperlink'],
      ['ArtifactLink', 'Artifact'],
    ]);
    const groups = new Map();
    for (const link of links) {
      const group = labels.get(link.type) || link.type;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(link);
    }

    const result = document.createDocumentFragment();
    for (const [name, group] of groups) {
      const wrap = node('div', null, 'tc-table-wrap tc-links-group');
      const table = node('table', null, 'tc-table');
      const head = node('thead');
      const headings = node('tr');
      for (const label of ['Link', 'State', 'Latest Update', 'Comment']) headings.appendChild(node('th', label));
      head.appendChild(headings);
      const body = node('tbody');
      for (const link of group) {
        const row = node('tr');
        const linkCell = node('td');
        const title = link.id == null ? link.name || link.url || name
          : [link.id, link.title].filter(Boolean).join(' ');
        if (/^https:\/\//i.test(link.url || '')) {
          const anchor = node('a', title);
          anchor.href = link.url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
          linkCell.appendChild(anchor);
        } else {
          linkCell.textContent = title;
        }
        row.append(linkCell, node('td', text(link.state)),
          node('td', testCaseDateTime.format(link.changedAt, '—')), node('td', text(link.comment)));
        body.appendChild(row);
      }
      table.append(node('caption', name), head, body);
      wrap.appendChild(table);
      result.appendChild(wrap);
    }
    $('tcLinksGroups').replaceChildren(result);
  }

  async function loadLinks() {
    if (!state.selected || linksLoaded || linksLoading) return;
    const { version, selected } = state;
    linksLoading = true;
    $('tcLinksRetry').hidden = true;
    message('tcLinksStatus', 'Loading links…');
    try {
      const { links } = await request(`${api}/${selected}/links`);
      if (version !== state.version) return;
      renderLinks(links);
      setLinkCount(links.length);
      message('tcLinksStatus', links.length ? '' : 'This bug has no links.');
      linksLoaded = true;
    } catch (error) {
      if (version !== state.version) return;
      message('tcLinksStatus', error.message, true);
      $('tcLinksRetry').hidden = false;
    } finally {
      if (version === state.version) linksLoading = false;
    }
  }

  help();
}

initializeWorkItemBrowser();
const postDevelopmentBugPage = mountPostDevelopmentBugBrowser();
if (postDevelopmentBugPage) initializeWorkItemBrowser(postDevelopmentBugPage);
