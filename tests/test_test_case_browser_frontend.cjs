// Run with: node --test tests/test_test_case_browser_frontend.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadBrowser({ timeZone } = {}) {
  class Element {
    constructor(tag = 'div', content) {
      this.tagName = tag.toUpperCase(); this.nodeType = tag === '#text' ? 3 : 1;
      this.style = {}; this.childNodes = []; this.listeners = {}; this.attributes = {}; this.dataset = {};
      this._text = content || ''; this.value = ''; this.hidden = false;
      this.classes = new Set();
      this.classList = { toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name) };
    }
    get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
    get textContent() { return this._text + this.childNodes.map((node) => node.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.childNodes = []; }
    appendChild(child) { this.childNodes.push(child); return child; }
    append(...children) { children.forEach((child) => this.appendChild(child)); }
    replaceChildren(...children) { this._text = ''; this.childNodes = children; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key]; }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    focus() { this.focused = true; }
    getBoundingClientRect() { return { top: 80, right: 400, bottom: 110, left: 200 }; }
    contains(target) { return this === target || this.childNodes.some((child) => child.contains(target)); }
  }
  const nodes = new Map();
  const $ = (id) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const tabs = ['Details', 'Automation', 'History'].map((name) => {
    const tab = $(`tc${name}Tab`); tab.dataset.tcTab = `tc${name}`; return tab;
  });
  $('tcField').value = 'id'; $('tcMode').value = 'exact';
  $('tcHistoryCalendar').hidden = true;
  const documentListeners = {};
  const calls = [];
  const context = vm.createContext({
    URL, console,
    window: { innerWidth: 1200, innerHeight: 800, addEventListener() {} },
    Intl: timeZone ? { DateTimeFormat: function(locale, options) { return new Intl.DateTimeFormat(locale, { ...options, timeZone }); } } : Intl,
    document: { getElementById: $, querySelectorAll: () => tabs, addEventListener: (type, handler) => { documentListeners[type] = handler; },
      createElement: (tag) => new Element(tag), createTextNode: (value) => new Element('#text', value) },
    DOMParser: class { parseFromString(value) { return { body: { childNodes: [new Element('#text', value)] } }; } },
    fetch: async (url, options) => { calls.push([url, options]); return context.respond(url, options); },
    respond: async () => ({ ok: true, json: async () => ({}) }),
  });
  vm.runInContext(fs.readFileSync('frontend/test-case-browser.js', 'utf8'), context);
  const json = (data, ok = true) => ({ ok, json: async () => data });
  const submit = () => $('tcSearch').listeners.submit({ preventDefault() {} });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const details = (id) => ({ id, title: `Case ${id}`, url: `https://dev.azure.com/org/project/_workitems/edit/${id}`,
    fields: [{ name: 'State', referenceName: 'System.State', value: 'Design' }], steps: [] });
  const findAll = (element, predicate) => element.childNodes.flatMap((child) => [ ...(predicate(child) ? [child] : []), ...findAll(child, predicate) ]);
  return { $, context, calls, submit, flush, json, details, Element, findAll, documentListeners };
}

function results(count = 2) {
  return { testCases: Array.from({ length: count }, (_, index) => ({ id: index + 1, title: `Case ${index + 1}`, state: 'Design', assignedTo: 'Tester' })) };
}

test('search pagination, one-case radios, keyboard tabs, lazy history and load more', async () => {
  const { $, context, calls, submit, json, details, flush, findAll } = loadBrowser();
  context.respond = async (url) => json(url.endsWith('/search') ? results(12) : url.includes('/history')
    ? { history: [{ testSuite: 'Suite', testPlan: 'Plan', result: 'Passed', loggedDate: '2026-11-01T08:00:00Z', tester: 'Actual tester' }], nextSkip: url.endsWith('skip=0') ? 50 : null }
    : details(Number(url.split('/').pop())));
  $('tcQuery').value = '12 34'; $('tcMode').value = 'flexible';
  await submit();
  assert.deepEqual(JSON.parse(calls[0][1].body), { field: 'id', mode: 'flexible', query: '12 34' });
  assert.equal($('tcResultRows').children.length, 10);
  assert.equal($('tcPrev').disabled, true);
  $('tcNext').listeners.click();
  assert.equal($('tcResultRows').children.length, 2);
  assert.equal($('tcNext').disabled, true);
  $('tcPrev').listeners.click();
  const radio = $('tcResultRows').children[0].children[0].children[0];
  assert.equal(radio.type, 'radio'); assert.equal(radio.name, 'tcSelection');
  await radio.listeners.change();
  assert.equal($('tcSelected').hidden, false);
  assert.equal(calls.filter(([url]) => url.includes('/history')).length, 0);
  $('tcDetailsTab').listeners.keydown({ key: 'End', preventDefault() {} });
  await flush();
  assert.equal($('tcHistoryTab').attributes['aria-selected'], 'true');
  assert.equal($('tcHistoryRows').children[0].children.length, 5);
  assert.equal($('tcHistoryRows').children[0].children[4].textContent, 'Actual tester');
  assert.equal($('tcHistoryMore').hidden, true); // Older pages load automatically.
  assert.equal($('tcHistoryProgress').hidden, true);
  assert.ok(calls.some(([url]) => url.endsWith('/history?skip=50')));
  assert.equal($('tcHistoryMore').hidden, true);
  await $('tcResultRows').children[1].children[0].children[0].listeners.change();
  assert.equal($('tcSelectedId').textContent, 'TEST CASE 2');
  assert.equal($('tcHistoryRows').children.length, 0);
  const selected = findAll($('tcResultRows'), (element) => element.type === 'radio' && element.checked);
  assert.equal(selected.length, 1); assert.equal(selected[0].value, '2');
});

test('rapid selection ignores stale details and history responses', async () => {
  const { $, context, submit, json, details, flush } = loadBrowser();
  let finishDetail, finishHistory;
  context.respond = async (url) => {
    if (url.endsWith('/search')) return json(results());
    if (url.endsWith('/1')) return new Promise((resolve) => { finishDetail = () => resolve(json(details(1))); });
    if (url.includes('/history')) return new Promise((resolve) => { finishHistory = () => resolve(json({ history: [{ result: 'Failed', tester: 'Stale tester' }], nextSkip: null })); });
    return json(details(2));
  };
  await submit();
  const first = $('tcResultRows').children[0].children[0].children[0].listeners.change();
  await $('tcResultRows').children[1].children[0].children[0].listeners.change();
  finishDetail(); await first;
  assert.equal($('tcSelectedId').textContent, 'TEST CASE 2');
  $('tcHistoryTab').listeners.click(); await flush();
  await $('tcResultRows').children[1].children[0].children[0].listeners.change();
  finishHistory(); await flush();
  assert.equal($('tcHistoryRows').children.length, 0);
});

test('errors remain visible and recover on a new search or history retry', async () => {
  const { $, context, submit, json, details, flush } = loadBrowser();
  context.respond = async () => json({ error: 'ADO not connected' }, false);
  await submit();
  assert.equal($('tcSearchStatus').textContent, 'ADO not connected');
  assert.equal($('tcSearchButton').disabled, false);
  assert.equal($('tcSelected').hidden, true);
  context.respond = async (url) => json(url.endsWith('/search') ? results() : details(1));
  await submit(); await $('tcResultRows').children[0].children[0].children[0].listeners.change();
  context.respond = async () => json({ error: 'Access denied' }, false);
  $('tcHistoryTab').listeners.click(); await flush();
  assert.match($('tcHistoryStatus').textContent, /Access denied/);
  assert.equal($('tcHistoryRefresh').disabled, false);
  context.respond = async () => json({ history: [], nextSkip: null });
  $('tcHistoryRefresh').listeners.click(); await flush();
  assert.match($('tcHistoryStatus').textContent, /No execution history/);
});

test('rich content retains formatting and strips scripts, event handlers and unsafe links', async () => {
  const { $, context, submit, json, details, Element, findAll } = loadBrowser();
  context.DOMParser = class { parseFromString(value) {
    if (value !== 'MALICIOUS_HTML') return { body: { childNodes: [new Element('#text', value)] } };
    const script = new Element('script', 'evil()'); const bold = new Element('b', 'Keep formatting');
    bold.textContent = ''; bold.appendChild(new Element('#text', 'Keep formatting')); bold.setAttribute('onclick', 'evil()');
    const link = new Element('a', 'Unsafe link'); link.setAttribute('href', 'javascript:evil()');
    return { body: { childNodes: [script, bold, link] } };
  } };
  const data = details(1); data.fields.push({ referenceName: 'System.Description', name: 'Description', value: 'MALICIOUS_HTML' });
  context.respond = async (url) => json(url.endsWith('/search') ? results() : data);
  await submit(); await $('tcResultRows').children[0].children[0].children[0].listeners.change();
  assert.equal(findAll($('tcDetails'), (element) => element.tagName === 'SCRIPT').length, 0);
  const bold = findAll($('tcDetails'), (element) => element.tagName === 'B')[0];
  assert.equal(bold.textContent, 'Keep formatting'); assert.equal(bold.getAttribute('onclick'), undefined);
  const link = findAll($('tcDetails'), (element) => element.tagName === 'A')[0];
  assert.equal(link.href, undefined);
});

test('old Flask backend 405 responses explain restart and ADO reconnection', async () => {
  for (const status of [405, 500]) {
    const { $, context, submit } = loadBrowser();
    context.respond = async () => ({ ok: false, status, json: async () => ({ error: '405 Method Not Allowed: The method is not allowed for the requested URL.' }) });
    await submit();
    assert.match($('tcSearchStatus').textContent, /Stop and relaunch/);
    assert.match($('tcSearchStatus').textContent, /reconnect to ADO/);
    assert.doesNotMatch($('tcSearchStatus').textContent, /^405/);
    assert.equal($('tcSearchButton').disabled, false);
  }
});

test('non-JSON method errors also explain restart', async () => {
  const { $, context, submit } = loadBrowser();
  context.respond = async () => ({ ok: false, status: 405, json: async () => { throw new Error('HTML response'); } });
  await submit();
  assert.match($('tcSearchStatus').textContent, /Stop and relaunch/);
});

test('history filters find older failures while background pages load and footer pagination stays local', async () => {
  const { $, context, submit, json, details, flush, calls } = loadBrowser();
  const row = (id, result) => ({ resultId: id, runId: 99, testSuite: result === 'Failed' ? 'Beta Suite (7)' : 'Alpha Suite (6)',
    testPlan: 'Release Plan (8)', result, loggedDate: result === 'Failed' ? '2026-10-29T12:00:00' : '2026-11-01T12:00:00', tester: 'Johnie' });
  let older;
  context.respond = async (url) => {
    if (url.endsWith('/search')) return json(results(1));
    if (!url.includes('/history')) return json(details(1));
    if (url.endsWith('skip=0')) return json({ history: Array.from({ length: 50 }, (_, i) => row(i, 'Passed')), nextSkip: 50 });
    return new Promise((resolve) => { older = () => resolve(json({ history: Array.from({ length: 10 }, (_, i) => row(50 + i, 'Failed')), nextSkip: null })); });
  };
  await submit(); await $('tcResultRows').children[0].children[0].children[0].listeners.change();
  $('tcHistoryTab').listeners.click(); await flush();
  assert.equal($('tcHistoryRows').children.length, 20);
  assert.equal($('tcHistoryProgress').hidden, false);
  assert.match($('tcHistoryCount').textContent, /50 loaded so far/);
  $('tcHistoryOutcome').value = 'Failed'; $('tcHistoryOutcome').listeners.input();
  assert.match($('tcHistoryRows').textContent, /Older results are still loading/);
  older(); await flush();
  assert.equal($('tcHistoryProgress').hidden, true);
  assert.equal($('tcHistoryRows').children.length, 10);
  assert.match($('tcHistoryCount').textContent, /10 matching of 60 loaded/);
  assert.match($('tcHistoryStatus').textContent, /All available history has been checked/);
  for (const [id, value] of [['tcHistorySuite', 'bEtA'], ['tcHistoryPlan', 'release'], ['tcHistoryTester', 'JOHNIE'],
    ['tcHistoryFrom', '2026-10-29'], ['tcHistoryTo', '2026-10-29']]) { $(id).value = value; $(id).listeners.input(); }
  assert.equal($('tcHistoryRows').children.length, 10);
  $('tcHistoryTester').value = 'Other tester'; $('tcHistoryTester').listeners.input();
  assert.match($('tcHistoryRows').textContent, /No execution results match/);
  $('tcHistoryClear').listeners.click();
  assert.equal($('tcHistoryRows').children.length, 20);
  const requestCount = calls.length;
  $('tcHistoryPageSize').value = '10'; $('tcHistoryPageSize').listeners.change();
  assert.equal($('tcHistoryRows').children.length, 10);
  assert.equal($('tcHistoryPageTotal').textContent, 'of 6');
  $('tcHistoryLast').listeners.click();
  assert.equal($('tcHistoryPage').value, 6);
  assert.equal($('tcHistoryNext').disabled, true);
  assert.match($('tcHistoryRows').textContent, /Failed/);
  $('tcHistoryPage').value = '2'; $('tcHistoryGo').listeners.click();
  assert.equal($('tcHistoryPage').value, 2);
  $('tcHistoryPrev').listeners.click();
  assert.equal($('tcHistoryFirst').disabled, true);
  $('tcHistoryPage').value = '999'; $('tcHistoryGo').listeners.click();
  assert.match($('tcHistoryStatus').textContent, /Enter an available page number/);
  assert.equal(calls.length, requestCount); // Filters and page navigation do not refetch ADO.
});

test('history retains partial rows on failure, retries the failed page and deduplicates overlapping results', async () => {
  const { $, context, submit, json, details, flush } = loadBrowser();
  const row = (id) => ({ runId: 9, resultId: id, testSuite: 'Suite', testPlan: 'Plan', result: 'Failed', tester: 'Tester' });
  let fail = true;
  context.respond = async (url) => {
    if (url.endsWith('/search')) return json(results(1));
    if (!url.includes('/history')) return json(details(1));
    if (url.endsWith('skip=0')) return json({ history: [row(1)], nextSkip: 50 });
    return fail ? json({ error: 'ADO timeout' }, false) : json({ history: [row(1), row(2)], nextSkip: null, warnings: ['One name unavailable.'] });
  };
  await submit(); await $('tcResultRows').children[0].children[0].children[0].listeners.change();
  $('tcHistoryTab').listeners.click(); await flush();
  assert.equal($('tcHistoryProgress').hidden, true);
  assert.equal($('tcHistoryRows').children.length, 1);
  assert.equal($('tcHistoryMore').hidden, false);
  assert.match($('tcHistoryStatus').textContent, /ADO timeout/);
  assert.doesNotMatch($('tcHistoryStatus').textContent, /All available history/);
  fail = false;
  $('tcHistoryMore').listeners.click(); await flush();
  assert.equal($('tcHistoryRows').children.length, 2);
  assert.equal($('tcHistoryMore').hidden, true);
  assert.match($('tcHistoryStatus').textContent, /One name unavailable/);
});

test('progress bars cover pending searches and details, then clear after errors or completion', async () => {
  const { $, context, submit, json, details } = loadBrowser();
  let finishSearch, finishDetail;
  context.respond = async (url) => url.endsWith('/search')
    ? new Promise((resolve) => { finishSearch = () => resolve(json(results(1))); })
    : new Promise((resolve) => { finishDetail = () => resolve(json(details(1))); });
  const search = submit();
  assert.equal($('tcSearchProgress').hidden, false);
  finishSearch(); await search;
  assert.equal($('tcSearchProgress').hidden, true);
  const detail = $('tcResultRows').children[0].children[0].children[0].listeners.change();
  assert.equal($('tcDetailProgress').hidden, false);
  finishDetail(); await detail;
  assert.equal($('tcDetailProgress').hidden, true);
  context.respond = async () => json({ error: 'Search failed' }, false);
  await submit();
  assert.equal($('tcSearchProgress').hidden, true);
  assert.equal($('tcDetailProgress').hidden, true);
});

test('invalid date range and non-advancing ADO pages report errors without claiming complete history', async () => {
  const { $, context, submit, json, details, flush } = loadBrowser();
  context.respond = async (url) => json(url.endsWith('/search') ? results(1) : url.includes('/history')
    ? { history: [], nextSkip: 0 } : details(1));
  await submit(); await $('tcResultRows').children[0].children[0].children[0].listeners.change();
  $('tcHistoryTab').listeners.click(); await flush();
  assert.match($('tcHistoryStatus').textContent, /invalid history page/);
  assert.equal($('tcHistoryMore').hidden, false);
  $('tcHistoryFrom').value = '2026-11-10'; $('tcHistoryTo').value = '2026-11-01';
  $('tcHistoryFrom').listeners.input();
  assert.match($('tcHistoryStatus').textContent, /From date must be on or before/);
});

test('Automation hides generic status, keeps State of Automation, and formats accepted date in local time', async () => {
  for (const [timeZone, expected] of [
    ['UTC', 'May/06/2025 02:27 AM UTC'],
    ['Asia/Shanghai', 'May/06/2025 10:27 AM GMT+8'],
    ['America/New_York', 'May/05/2025 10:27 PM EDT'],
  ]) {
    const { $, context, submit, json, details, findAll } = loadBrowser({ timeZone });
    const data = details(1);
    data.fields.push(
      { name: 'Automation status', referenceName: 'Microsoft.VSTS.TCM.AutomationStatus', value: 'Not Automated' },
      { name: 'State of Automation', referenceName: 'Custom.StateOfAutomation', value: 'Automated and Accepted' },
      { name: 'Automated and Accepted Date', referenceName: 'Custom.AcceptedDate', value: '2025-05-06T02:27:26.623Z' },
      { name: 'Automation Test Tool', referenceName: 'Custom.TestTool', value: 'UFT Developer' },
      { name: 'Automation Script Name', referenceName: 'Custom.ScriptName', value: 'VSTS24092' },
    );
    context.respond = async (url) => json(url.endsWith('/search') ? results(1) : data);
    await submit(); await $('tcResultRows').children[0].children[0].children[0].listeners.change();
    const labels = findAll($('tcAutomation'), (element) => element.tagName === 'DT').map((element) => element.textContent);
    assert.ok(!labels.includes('Automation status'));
    assert.ok(labels.includes('State of Automation'));
    assert.match($('tcAutomation').textContent, /Automated and Accepted/);
    assert.match($('tcAutomation').textContent, /UFT Developer/);
    assert.match($('tcAutomation').textContent, /VSTS24092/);
    assert.ok($('tcAutomation').textContent.includes(expected), $('tcAutomation').textContent);
    assert.ok(!$('tcDetails').textContent.includes('Not Automated')); // Hidden row does not move into Planning.
    const accepted = findAll($('tcAutomation'), (element) => element.tagName === 'DD' && element.title === '2025-05-06T02:27:26.623Z');
    assert.equal(accepted.length, 1); // Preserve exact source value in the tooltip.
  }
});

test('invalid accepted dates and notes remain intact', async () => {
  const { $, context, submit, json, details } = loadBrowser({ timeZone: 'UTC' });
  const data = details(1);
  data.fields.push(
    { name: 'Automated and Accepted Date', referenceName: 'Custom.AcceptedDate', value: 'Date not provided' },
    { name: 'Notes', referenceName: 'Custom.Notes', value: 'Accepted in HYSYS V15 AES Media 620.' },
  );
  context.respond = async (url) => json(url.endsWith('/search') ? results(1) : data);
  await submit(); await $('tcResultRows').children[0].children[0].children[0].listeners.change();
  assert.match($('tcAutomation').textContent, /Date not provided/);
  assert.match($('tcAutomation').textContent, /Accepted in HYSYS V15 AES Media 620/);
});

test('calendar selects inclusive start/end dates and third click starts a new range', async () => {
  const { $, context, submit, json, details, flush, findAll, documentListeners } = loadBrowser();
  const dates = ['2026-11-11T00:00:00', '2026-11-10T23:59:59.999', '2026-11-01T00:00:00', '2026-10-31T23:59:59.999'];
  context.respond = async (url) => json(url.endsWith('/search') ? results(1) : url.includes('/history')
    ? { history: dates.map((loggedDate, id) => ({ runId: 1, resultId: id, result: 'Failed', loggedDate })), nextSkip: null } : details(1));
  await submit(); await $('tcResultRows').children[0].children[0].children[0].listeners.change();
  $('tcHistoryTab').listeners.click(); await flush();
  $('tcHistoryOutcome').value = 'Failed'; $('tcHistoryOutcome').listeners.input();
  $('tcHistoryDateTrigger').listeners.click();
  const day = (key) => findAll($('tcCalendarDays'), (element) => element.dataset.date === key)[0];
  assert.equal($('tcHistoryDateTrigger').attributes['aria-expanded'], 'true');
  const first = day('2026-11-01'); first.listeners.click();
  // Native bubbling keeps the pre-render event path even after the day node is replaced.
  documentListeners.click({ target: first, composedPath: () => [first, $('tcHistoryCalendar')] });
  assert.equal($('tcHistoryCalendar').hidden, false);
  assert.equal($('tcHistoryFrom').value, '2026-11-01');
  assert.equal($('tcHistoryTo').value, '');
  assert.equal($('tcCalendarHint').textContent, 'Choose an end date.');
  day('2026-11-10').listeners.click();
  assert.equal($('tcHistoryFrom').value, '2026-11-01');
  assert.equal($('tcHistoryTo').value, '2026-11-10');
  assert.equal($('tcHistoryRows').children.length, 2); // Both date boundaries included.
  assert.ok(day('2026-11-05').classes.has('in-range'));
  assert.ok(day('2026-11-10').classes.has('endpoint'));
  assert.equal($('tcHistoryCalendar').hidden, false);
  day('2026-11-08').listeners.click();
  assert.equal($('tcHistoryFrom').value, '2026-11-08');
  assert.equal($('tcHistoryTo').value, '');
  assert.equal($('tcCalendarHint').textContent, 'Choose an end date.');
  $('tcCalendarClear').listeners.click();
  assert.equal($('tcHistoryFrom').value, ''); assert.equal($('tcHistoryTo').value, '');
  assert.equal($('tcHistoryOutcome').value, 'Failed');
  assert.equal($('tcHistoryRows').children.length, 4);
});

test('calendar supports leap days, month/year navigation and reversed date ranges', () => {
  const { $, findAll } = loadBrowser();
  $('tcHistoryDateTrigger').listeners.click();
  $('tcCalendarYear').value = '2024'; $('tcCalendarYear').listeners.change();
  $('tcCalendarMonth').value = '1'; $('tcCalendarMonth').listeners.change();
  const day = (key) => findAll($('tcCalendarDays'), (element) => element.dataset.date === key)[0];
  assert.ok(day('2024-02-29'));
  day('2024-02-28').listeners.click();
  $('tcCalendarNext').listeners.click();
  day('2024-03-01').listeners.click();
  assert.equal($('tcHistoryFrom').value, '2024-02-28');
  assert.equal($('tcHistoryTo').value, '2024-03-01');
  $('tcCalendarPrev').listeners.click();
  assert.ok(day('2024-02-29').classes.has('in-range'));
  $('tcCalendarNext').listeners.click();
  day('2024-03-05').listeners.click(); // Third click begins again.
  day('2024-03-01').listeners.click(); // Earlier end is normalized chronologically.
  assert.equal($('tcHistoryFrom').value, '2024-03-01');
  assert.equal($('tcHistoryTo').value, '2024-03-05');
});

test('calendar keyboard navigation crosses months, clamps leap dates and dismisses cleanly', () => {
  const { $, findAll, documentListeners, Element } = loadBrowser();
  $('tcHistoryDateTrigger').listeners.click();
  $('tcCalendarYear').value = '2024'; $('tcCalendarYear').listeners.change();
  $('tcCalendarMonth').value = '2'; $('tcCalendarMonth').listeners.change();
  const day = (key) => findAll($('tcCalendarDays'), (element) => element.dataset.date === key)[0];
  day('2024-03-31').listeners.keydown({ key: 'PageUp', preventDefault() {} });
  assert.equal($('tcCalendarMonth').value, '1');
  assert.equal(day('2024-02-29').tabIndex, 0);
  assert.ok(day('2024-02-29').focused);
  day('2024-02-29').listeners.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal($('tcCalendarMonth').value, '2');
  assert.equal(day('2024-03-01').tabIndex, 0);
  documentListeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal($('tcHistoryCalendar').hidden, true);
  assert.equal($('tcHistoryDateTrigger').attributes['aria-expanded'], 'false');
  assert.ok($('tcHistoryDateTrigger').focused);
  $('tcHistoryDateTrigger').listeners.click();
  documentListeners.click({ target: new Element('div') });
  assert.equal($('tcHistoryCalendar').hidden, true);
});

test('manual dates, Clear filters and test case changes synchronize the calendar', async () => {
  const { $, context, submit, json, details, findAll } = loadBrowser();
  context.respond = async (url) => json(url.endsWith('/search') ? results(2) : details(Number(url.split('/').pop())));
  await submit(); await $('tcResultRows').children[0].children[0].children[0].listeners.change();
  $('tcHistoryFrom').value = '2025-12-20'; $('tcHistoryTo').value = '2026-01-03'; $('tcHistoryFrom').listeners.input();
  $('tcHistoryDateTrigger').listeners.click();
  assert.equal($('tcCalendarYear').value, '2025'); assert.equal($('tcCalendarMonth').value, '11');
  assert.match($('tcCalendarRange').textContent, /Dec 20, 2025.*Jan 03, 2026/);
  $('tcHistoryClear').listeners.click();
  assert.equal($('tcCalendarRange').textContent, 'All dates');
  assert.equal($('tcCalendarHint').textContent, 'Choose a start date.');
  const day = findAll($('tcCalendarDays'), (element) => element.dataset.date === '2025-12-20')[0];
  day.listeners.click();
  await $('tcResultRows').children[1].children[0].children[0].listeners.change();
  assert.equal($('tcHistoryCalendar').hidden, true);
  assert.equal($('tcHistoryFrom').value, ''); assert.equal($('tcHistoryTo').value, '');
});
