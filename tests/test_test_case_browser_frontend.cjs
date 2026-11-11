// Run with: node --test tests/test_test_case_browser_frontend.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadBrowser() {
  class Element {
    constructor(tag = 'div', content) {
      this.tagName = tag.toUpperCase(); this.nodeType = tag === '#text' ? 3 : 1;
      this.childNodes = []; this.listeners = {}; this.attributes = {}; this.dataset = {};
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
  }
  const nodes = new Map();
  const $ = (id) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const tabs = ['Details', 'Automation', 'History'].map((name) => {
    const tab = $(`tc${name}Tab`); tab.dataset.tcTab = `tc${name}`; return tab;
  });
  $('tcField').value = 'id'; $('tcMode').value = 'exact';
  const calls = [];
  const context = vm.createContext({
    URL, console,
    document: { getElementById: $, querySelectorAll: () => tabs,
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
  return { $, context, calls, submit, flush, json, details, Element, findAll };
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
  assert.equal($('tcHistoryMore').hidden, false);
  $('tcHistoryMore').listeners.click(); await flush();
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
