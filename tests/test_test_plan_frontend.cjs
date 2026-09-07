// Run with: node --test tests/test_test_plan_frontend.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadApp() {
  const nodes = new Map();
  const element = () => ({
    value: '', textContent: '', children: [], listeners: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
  });
  const context = vm.createContext({
    document: {
      querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
      querySelectorAll() { return []; }, createElement: element, createDocumentFragment: element,
    },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    navigator: { clipboard: { writeText: async (text) => { context.copied = text; } } },
  });
  vm.runInContext(fs.readFileSync('frontend/app.js', 'utf8'), context);
  return { context, nodes };
}

test('Markdown escapes pipes, backslashes, newlines and HTML; missing Order stays blank', () => {
  const { context } = loadApp();
  context.points = [{ testCaseId: 1, title: 'A\\|B\n<script>', outcome: 'Failed', order: null }];
  const markdown = vm.runInContext('testPointsMarkdown(points)', context);
  assert.equal(markdown, '| Test Case ID | Title | Outcome | Order |\n|---:|---|---|---:|\n| 1 | A\\\\\\|B &lt;script&gt; | Failed |  |');
});

test('load, safe rendering, both clipboard buttons, empty suite and failed reload', async () => {
  const { context, nodes } = loadApp();
  const data = { planId: 83602, suiteId: 106867, summary: { total: 2, passed: 1, failed: 1, other: 0 },
    testPoints: [{ testCaseId: 2, title: '<img onerror=alert(1)>', outcome: 'Failed', order: 21 },
      { testCaseId: 1, title: 'Passed case', outcome: 'Passed', order: 23 }] };
  nodes.get('#testPlanUrl') || context.document.querySelector('#testPlanUrl');
  nodes.get('#testPlanUrl').value = 'https://dev.azure.com/org/project/_testPlans/execute?suiteId=106867&planId=83602';
  context.fetch = async (path, options) => {
    assert.equal(path, '/api/test-plans/read-suite');
    assert.deepEqual(Object.keys(JSON.parse(options.body)), ['url']);
    assert.equal(nodes.get('#loadTestSuiteButton').disabled, true);
    return { ok: true, json: async () => data };
  };
  const submit = () => nodes.get('#testSuiteForm').listeners.submit({ preventDefault() {} });
  await submit();
  assert.equal(nodes.get('#copyFailedTestsButton').disabled, false);
  const cells = nodes.get('#testSuiteRows').children[0].children[0].children;
  assert.equal(cells[1].textContent, '<img onerror=alert(1)>');
  assert.equal(cells[1].children.length, 0);
  assert.equal(cells[2].children[0].className, 'test-outcome failed');
  await nodes.get('#copyFailedTestsButton').listeners.click();
  assert.match(context.copied, /Failed/);
  assert.doesNotMatch(context.copied, /Passed case/);
  await nodes.get('#copyTestSuiteButton').listeners.click();
  assert.match(context.copied, /Passed case/);
  data.testPoints = []; data.summary = { total: 0, passed: 0, failed: 0, other: 0 };
  await submit();
  assert.equal(nodes.get('#copyTestSuiteButton').disabled, true);
  assert.equal(nodes.get('#copyFailedTestsButton').disabled, true);
  context.fetch = async () => ({ ok: false, status: 504, json: async () => ({ error: 'API timeout' }) });
  await submit();
  assert.equal(nodes.get('#testSuiteResults').hidden, true);
  assert.equal(nodes.get('#testSuiteStatus').textContent, 'API timeout');
  assert.equal(nodes.get('#loadTestSuiteButton').disabled, false);
});
