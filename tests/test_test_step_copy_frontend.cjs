// Optional Playwright checks. Run with RUN_BROWSER_TESTS=1 node --test.
// Set TEST_CHROMIUM_PATH for an existing Chromium binary, or use Playwright's Chromium.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const browserEnabled = process.env.RUN_BROWSER_TESTS === '1' || Boolean(process.env.TEST_CHROMIUM_PATH);
const chromium = browserEnabled ? require('playwright').chromium : null;

const frontend = path.resolve(__dirname, '../frontend');
const browserTest = (name, run) => test(name, { skip: !chromium && 'Enable real-browser tests with RUN_BROWSER_TESTS=1' }, async (t) => {
  const server = http.createServer(async (request, response) => {
    const file = path.basename(new URL(request.url, 'http://localhost').pathname) || 'index.html';
    try {
      const body = await fs.readFile(path.join(frontend, file));
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const browser = await chromium.launch({ executablePath: process.env.TEST_CHROMIUM_PATH });
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }, timezoneId: 'America/New_York', permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  const calls = [];
  const testCases = Array.from({ length: 12 }, (_, n) => ({ id: n + 1, title: `Test case ${n + 1}` }));
  const steps = Array.from({ length: 550 }, (_, n) => ({
    number: String(n + 1), action: `Load case ${n + 1}.hsc`, expected: '',
  }));
  steps[0].action = '<p>Step 1: Open <LNG Section> &amp; Load Sample.hsc</p><p>Choose <b>Plots</b><br>Compare X | Y.</p>';
  steps[0].expected = '<div>Lists match<br>Keep A &lt; B.</div>';
  steps[1].number = '1.1';
  steps[1].action = '<ol><li><div>Inspect <Flow Rate></div></li><li>Use <sample.hsc>.</li></ol>';
  const mocks = {
    steps, stepsWarning: '',
    modifications: (route) => route.fulfill({ json: { updates: [] } }),
    executions: (route) => route.fulfill({ json: { history: [], nextSkip: null } }),
    rewrite: (route) => route.fulfill({ json: { steps: [] } }),
  };
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const url = new URL(request.url()).pathname;
    calls.push([url, request.method()]);
    if (url === '/api/chat/rewrite-test-steps') return mocks.rewrite(route);
    if (url === '/api/chat/status') return route.fulfill({ json: {
      connected: true, models: [{ id: 'luna', name: 'Luna' }, { id: 'other', name: 'Other' }],
    } });
    if (url.endsWith('/modification-history')) return mocks.modifications(route);
    if (url.endsWith('/history')) return mocks.executions(route);
    if (url.endsWith('/search')) return route.fulfill({ json: { testCases } });
    if (url.endsWith('/test-cases/11')) return route.fulfill({ json: {
      id: 11, title: 'Test case 11', url: 'https://dev.azure.com/org/project/_workitems/edit/11',
      fields: [
        { name: 'State', referenceName: 'System.State', value: 'Design' },
        { name: 'Tags', referenceName: 'System.Tags', value: 'fixed-created-date; PI20; ; TC Migration Batch 2; V15 New Feature;' },
        { name: 'Activated Date', referenceName: 'Microsoft.VSTS.Common.ActivatedDate', type: 'dateTime', value: '2026-03-23T22:59:39.49Z' },
        { name: 'Target Date', referenceName: 'Custom.TargetDate', value: '2026-03-23' },
      ], steps: mocks.steps, stepsWarning: mocks.stepsWarning,
    } });
    return route.fulfill({ json: {} });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await run({ page, calls, mocks });
});

async function openCase(page) {
  await page.getByRole('tab', { name: 'Work Items', exact: true }).click();
  await page.locator('[data-work-tab="test-case"]').click();
  await page.locator('#tcQuery').fill('1');
  await page.locator('#tcSearchButton').click();
  await page.locator('#tcNext').click();
  await page.getByRole('radio', { name: 'Select test case 11: Test case 11' }).check();
}

async function selectCase(page) {
  await openCase(page);
  await page.getByRole('button', { name: 'Copy All Steps' }).waitFor();
}

const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText());

browserTest('normalizes ADO text and exports correct Markdown for one row and all rows', async ({ page, mocks }) => {
  const { plain, markdown } = await page.evaluate((steps) => {
    const plain = testStepMarkdown.prepare(steps);
    return { plain, markdown: testStepMarkdown.table(plain) };
  }, mocks.steps);
  assert.deepEqual(plain[0], {
    step: '1', action: 'Open <LNG Section> & Load Sample.hsc\nChoose Plots\nCompare X | Y.',
    expected: 'Lists match\nKeep A < B.',
  });
  assert.deepEqual(plain[1], {
    step: '1.1', action: '1. Inspect <Flow Rate>\n2. Use <sample.hsc>.', expected: '',
  });
  const lines = markdown.split('\n');
  assert.deepEqual(lines.slice(0, 2), ['| Step | Action | Expected result |', '|---|---|---|']);
  assert.equal(lines[2], '| 1 | Open &lt;LNG Section&gt; &amp; Load Sample.hsc<br>Choose Plots<br>Compare X \\| Y. | Lists match<br>Keep A &lt; B. |');
  assert.equal(lines[3], '| 1.1 | 1. Inspect &lt;Flow Rate&gt;<br>2. Use &lt;sample.hsc&gt;. | |');
  assert.equal(lines.length, 552);
  assert.equal(lines.at(-1), '| 550 | Load case 550.hsc | |');

  const special = await page.evaluate(() => testStepMarkdown.table(testStepMarkdown.prepare([{
    action: '<div><P> &lt;VAPOUR&gt; &amp;lt; &nbsp; _X_ [Y] *Z* ~α~ `tag`</div><script>remove me</script>2.5 bar',
    expected: '<ul><li>Ready</li><li>Verify ≥ 1 &deg;C</li></ul>',
  }])));
  assert.ok(special.includes('&lt;P&gt; &lt;VAPOUR&gt; &amp;lt; \\_X\\_ \\[Y\\] \\*Z\\* \\~α\\~ \\`tag\\`<br>2.5 bar'));
  assert.ok(special.endsWith('| - Ready<br>- Verify ≥ 1 °C |'));
  assert.ok(!special.includes('remove me'));
});

browserTest('row copy is hover and keyboard accessible, and the modal traps focus and copies the full edited draft', async ({ page }) => {
  await selectCase(page);
  const all = page.getByRole('button', { name: 'Copy All Steps' });
  const first = page.getByRole('button', { name: 'Copy step 1', exact: true });
  const second = page.getByRole('button', { name: 'Copy step 1.1', exact: true });
  const css = (button) => button.evaluate((node) => {
    const { opacity, pointerEvents } = getComputedStyle(node);
    return [opacity, pointerEvents];
  });
  assert.deepEqual(await css(first), ['0', 'none']);
  await page.locator('.tc-steps tbody tr').first().hover();
  assert.deepEqual(await css(first), ['1', 'auto']);
  assert.deepEqual(await css(second), ['0', 'none']);
  assert.equal(await first.locator('svg').count(), 1);
  await first.click();
  assert.equal((await clipboard(page)).split('\n').length, 3);
  assert.match(await clipboard(page), /\| 1 \| Open &lt;LNG Section&gt;/);
  await page.getByText('Step 1 copied.', { exact: true }).waitFor();
  await all.hover();
  await all.focus();
  await page.keyboard.press('Tab');
  assert.equal(await first.evaluate((node) => node === document.activeElement), true);
  assert.deepEqual(await css(first), ['1', 'auto']);
  assert.equal(await first.evaluate((node) => getComputedStyle(node).outlineStyle), 'solid');
  await page.keyboard.press('Enter');
  await page.getByText('Step 1 copied.', { exact: true }).waitFor();

  await all.click();
  const dialog = page.getByRole('dialog', { name: 'Copy Test Steps' });
  const editor = dialog.getByRole('textbox', { name: 'Test steps Markdown' });
  const close = dialog.getByRole('button', { name: 'Close Copy Test Steps' });
  const copy = dialog.getByRole('button', { name: 'Copy', exact: true });
  await dialog.getByText('550 steps').waitFor();
  const original = await editor.inputValue();
  assert.equal(original.split('\n').length, 552);
  assert.equal(await editor.evaluate((node) => node.scrollHeight > node.clientHeight), true);
  await page.keyboard.press('Escape');
  await page.mouse.click(4, 4);
  assert.equal(await dialog.isVisible(), true);
  await copy.focus();
  await page.keyboard.press('Tab');
  assert.equal(await close.evaluate((node) => node === document.activeElement), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await copy.evaluate((node) => node === document.activeElement), true);

  await editor.fill(original + '\nDraft edit.');
  await copy.click();
  await dialog.getByText('Copied to clipboard.').waitFor();
  assert.equal(await clipboard(page), original + '\nDraft edit.');
  await page.evaluate(() => {
    window.readClipboard = navigator.clipboard.readText.bind(navigator.clipboard);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  });
  await editor.fill('Fallback copy');
  await copy.click();
  assert.equal(await page.evaluate(() => window.readClipboard()), 'Fallback copy');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async () => { throw new Error('Permission denied'); } },
  }));
  await copy.click();
  await dialog.getByText('Could not copy. Check clipboard access and try again.').waitFor();
  assert.equal(await editor.inputValue(), 'Fallback copy');
  await page.setViewportSize({ width: 390, height: 600 });
  assert.ok((await dialog.boundingBox()).width <= 390);
  assert.equal(await close.isVisible(), true);
  await close.click();
  assert.equal(await dialog.isVisible(), false);
  assert.equal(await all.evaluate((node) => node === document.activeElement), true);
});

browserTest('AI failures preserve edits, retries use the selected model, and drafts reset independently', async ({ page, calls, mocks }) => {
  mocks.steps = mocks.steps.slice(0, 2);
  await selectCase(page);
  await page.evaluate(() => { document.getElementById('chatModel').value = 'other'; });
  await page.getByRole('button', { name: 'Copy All Steps' }).click();
  const dialog = page.getByRole('dialog', { name: 'Copy Test Steps' });
  const edit = dialog.getByRole('textbox');
  const rewrite = dialog.getByRole('button', { name: 'AI-modification' });
  const version = dialog.getByLabel('Version');
  const reset = dialog.getByRole('button', { name: 'Reset' });
  const firstDraft = await edit.inputValue();
  await edit.fill('My original draft');

  mocks.rewrite = (route) => route.abort();
  await rewrite.click();
  await dialog.getByText('Could not reach the app backend. Please try again.').waitFor();
  assert.equal(await edit.inputValue(), 'My original draft');
  mocks.rewrite = (route) => route.fulfill({ status: 504, json: { error: 'Copilot timed out. Please try again.' } });
  await rewrite.click();
  await dialog.getByText('Copilot timed out. Please try again.').waitFor();
  assert.equal(await edit.inputValue(), 'My original draft');

  let accept;
  mocks.rewrite = async (route) => {
    const payload = route.request().postDataJSON();
    assert.equal(payload.model, 'other');
    assert.equal(payload.steps.length, 2);
    assert.match(payload.steps[0].action, /^Open <LNG Section>/);
    await new Promise((resolve) => { accept = resolve; });
    return route.fulfill({ json: { steps: payload.steps.map((step) => ({
      ...step, expected: 'Verified in Copilot draft.',
    })) } });
  };
  await rewrite.click();
  await dialog.getByRole('progressbar').waitFor();
  assert.equal(await rewrite.isDisabled(), true);
  await rewrite.dispatchEvent('click');
  await page.waitForFunction(() => document.getElementById('tcCopyRewrite').disabled);
  assert.equal(calls.filter(([url]) => url.endsWith('/rewrite-test-steps')).length, 3);
  assert.equal(await edit.inputValue(), 'My original draft');
  accept();
  await dialog.getByText('AI-modified steps are ready.').waitFor();
  assert.equal(await version.inputValue(), 'ai');
  const aiDraft = await edit.inputValue();
  assert.match(aiDraft, /Verified in Copilot draft/);
  await edit.fill('My AI draft');
  await version.selectOption('original');
  assert.equal(await edit.inputValue(), 'My original draft');
  await version.selectOption('ai');
  assert.equal(await edit.inputValue(), 'My AI draft');
  await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
  assert.equal(await clipboard(page), 'My AI draft');
  page.once('dialog', (prompt) => prompt.dismiss());
  await reset.click();
  assert.equal(await edit.inputValue(), 'My AI draft');
  page.once('dialog', (prompt) => prompt.accept());
  await reset.click();
  assert.equal(await edit.inputValue(), aiDraft);
  await version.selectOption('original');
  assert.equal(await edit.inputValue(), 'My original draft');
  page.once('dialog', (prompt) => prompt.accept());
  await reset.click();
  assert.equal(await edit.inputValue(), firstDraft);
  assert.deepEqual(calls.filter(([url, method]) => url.startsWith('/api/work-items') && method !== 'GET'),
    [['/api/work-items/test-cases/search', 'POST']]);
  assert.equal(calls.filter(([url]) => url.endsWith('/rewrite-test-steps')).length, 3);
});

browserTest('copies an incomplete procedure and keeps AI-modification disabled', async ({ page, calls, mocks }) => {
  mocks.steps = [{ number: '2', action: 'Shared steps: #123 (open in ADO to view)', expected: '' }];
  mocks.stepsWarning = 'Some steps could not be loaded.';
  await selectCase(page);
  await page.getByRole('button', { name: 'Copy All Steps' }).click();
  const dialog = page.getByRole('dialog', { name: 'Copy Test Steps' });
  const rewrite = dialog.getByRole('button', { name: 'AI-modification' });
  await dialog.getByText(/AI-modification requires a complete procedure/).waitFor();
  assert.equal(await rewrite.isDisabled(), true);
  await rewrite.dispatchEvent('click');
  assert.equal(calls.some(([url]) => url.endsWith('/rewrite-test-steps')), false);
  await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
  assert.match(await clipboard(page), /\| 2 \| Shared steps: #123/);
});

browserTest('keeps reopened drafts independent of pending and invalid AI results', async ({ page, calls, mocks }) => {
  mocks.steps = mocks.steps.slice(0, 1);
  await selectCase(page);
  const all = page.getByRole('button', { name: 'Copy All Steps' });
  await all.click();
  const dialog = page.getByRole('dialog', { name: 'Copy Test Steps' });
  const rewrite = dialog.getByRole('button', { name: 'AI-modification' });
  const editor = dialog.getByRole('textbox');
  const aiCalls = () => calls.filter(([url]) => url.endsWith('/rewrite-test-steps')).length;
  let complete;
  mocks.rewrite = async (route) => {
    const { steps } = route.request().postDataJSON();
    await new Promise((resolve) => { complete = resolve; });
    return route.fulfill({ json: { steps: steps.map((step) => ({ ...step, expected: 'Old response.' })) } });
  };
  await rewrite.click();
  await dialog.getByRole('progressbar').waitFor();
  await dialog.getByRole('button', { name: 'Close Copy Test Steps' }).click();
  await all.click();
  await dialog.getByText(/previous Copilot request is still finishing/).waitFor();
  assert.equal(await rewrite.isDisabled(), true);
  await editor.fill('New draft');
  await rewrite.dispatchEvent('click');
  assert.equal(aiCalls(), 1);
  complete();
  await dialog.getByRole('progressbar').waitFor({ state: 'hidden' });
  assert.equal(await editor.inputValue(), 'New draft');
  assert.equal(await rewrite.isEnabled(), true);

  mocks.rewrite = (route) => route.fulfill({ json: { steps: [{ step: '2', action: 'Wrong step', expected: 'Ready' }] } });
  await rewrite.click();
  await dialog.getByText(/invalid rewritten steps/).waitFor();
  assert.equal(await editor.inputValue(), 'New draft');
  assert.equal(await rewrite.isEnabled(), true);
  assert.equal(aiCalls(), 2);
});

browserTest('case selection opens Details and the history tabs preserve execution filters and paging', async ({ page, calls, mocks }) => {
  const update = (id, props) => ({ id, revision: id, author: 'Service Account', authorId: 'service',
    changedAt: '2026-03-22T10:00:00Z', fields: [], relations: [], ...props });
  const step = (action) => ({ number: '1', action, expected: 'Case loads' });
  const updates = [
    update(5, { author: 'Joy Cheng', authorId: 'joy', changedAt: '2026-03-23T22:59:39.49Z', fields: [{
      field: 'Microsoft.VSTS.TCM.Steps', label: 'Test Steps',
      steps: { changes: [{
        before: step('Load &lt;Old Plant.hsc&gt; &amp; check "Vapour"'),
        after: step('<div>Load <LNG Plant Simulation.hsc> &amp; inspect "Vapour" &amp;lt; <b onclick="unsafe()">safely</b><script>untrusted markers</script></div>'),
        moved: false,
      }] },
    }] }),
    update(4, { revision: 3, author: 'Joy Cheng', authorId: 'joy', changedAt: '2026-03-23T02:30:00Z',
      relations: [{ operation: 'added', type: 'AttachedFile', name: 'Trends.png' }] }),
    update(3, { changedAt: '2026-03-22T19:00:00Z', fields: [{
      field: 'System.AreaPath', label: 'Area Path', before: 'QA', after: 'QA\\HYSYS',
    }] }),
    update(2, { changedAt: '2026-03-21T10:00:00Z', fields: [{
      field: 'System.State', label: 'State', before: 'Design', after: 'Ready',
    }] }),
    update(1, { created: true, changedAt: '2026-03-20T10:00:00Z' }),
    ...Array.from({ length: 20 }, (_, i) => update(i + 6, { changedAt: '2026-03-18T10:00:00Z' })),
  ];
  mocks.modifications = (route) => route.fulfill({ json: { updates: [...updates].reverse() } });
  mocks.executions = (route) => {
    const laterPage = new URL(route.request().url()).searchParams.get('skip') === '50';
    return route.fulfill({ json: {
      history: [{ runId: 8, resultId: laterPage ? 2 : 1, testSuite: 'Regression Suite', testPlan: 'V15',
        result: laterPage ? 'Failed' : 'Passed', tester: 'Recorded Tester',
        loggedDate: laterPage ? '2026-03-20T18:00:00Z' : '2026-03-23T22:59:39.49Z' }],
      nextSkip: laterPage ? null : 50,
    } });
  };
  await openCase(page);
  const mods = page.getByRole('tab', { name: 'Modification History', exact: true });
  const executions = page.getByRole('tab', { name: 'Execution History', exact: true });
  const timeline = page.getByRole('region', { name: 'Revision timeline' });
  const details = page.getByRole('region', { name: 'Revision details' });
  const active = timeline.locator('[aria-current="true"]');
  await page.getByRole('tabpanel', { name: 'Details', exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Details', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await mods.getAttribute('aria-selected'), 'false');
  assert.equal(calls.filter(([url]) => url.includes('history')).length, 0);
  await mods.click();
  await details.getByText('Step 1 updated').waitFor();
  assert.equal(await mods.getAttribute('aria-selected'), 'true');
  assert.deepEqual(await page.locator('.tc-icon-tab').evaluateAll((tabs) => tabs.map(
    (tab) => [tab.getAttribute('aria-label'), tab.querySelector('svg').getAttribute('width')],
  )), [['Modification History', '20'], ['Execution History', '20']]);
  assert.equal(calls.filter(([url]) => url.endsWith('/history')).length, 0);
  await mods.hover();
  assert.equal(await mods.locator('.tc-tab-tooltip').isVisible(), true);
  const border = () => page.locator('.tc-icon-tab').evaluateAll((tabs) => tabs.map(
    (tab) => getComputedStyle(tab).borderBottomColor,
  ));
  const [blue, transparent] = await border();
  assert.notEqual(blue, 'rgba(0, 0, 0, 0)');
  assert.equal(transparent, 'rgba(0, 0, 0, 0)');
  assert.match(await active.innerText(), /Joy Cheng.*Changed Test Steps.*Mar 23, 2026, 6:59 PM.*Revision 5/s);
  assert.ok((await details.innerText()).includes('Load <Old Plant.hsc> & check "Vapour"'));
  assert.ok((await details.innerText()).includes('Load <LNG Plant Simulation.hsc> & inspect "Vapour" &lt; safely'));
  assert.doesNotMatch(await details.innerText(), /untrusted markers|Case loads/);
  assert.equal(await details.locator('script, [onclick]').count(), 0);

  await timeline.getByRole('button', { name: /Changed Area Path/ }).click();
  assert.match(await active.innerText(), /Changed Area Path/);
  assert.match(await details.innerText(), /Previous\s+QA\s+Updated\s+QA\\HYSYS/);
  await timeline.getByRole('button', { name: /Added attachment/ }).click();
  assert.match(await details.innerText(), /Trends\.png/);
  await timeline.getByRole('button', { name: 'Next revision page' }).click();
  assert.match(await timeline.innerText(), /Page 2 of 2/);
  assert.equal(await timeline.locator('.tc-mod-entry').count(), 5);
  await page.getByLabel('Modified by').selectOption('joy');
  assert.equal(await timeline.locator('.tc-mod-entry').count(), 2);
  await page.getByLabel('Modification type').selectOption('Attachment');
  assert.equal(await timeline.locator('.tc-mod-entry').count(), 1);
  assert.match(await active.innerText(), /Mar 22, 2026, 10:30 PM/);

  await page.getByRole('button', { name: 'Choose modification date range' }).click();
  const pick = (date) => page.locator(`#tcCalendarDays [data-date="${date}"]`).click();
  await pick('2026-03-22');
  await pick('2026-03-23');
  assert.equal(await page.locator('#tcModHistoryTo').inputValue(), '2026-03-23');
  await pick('2026-03-23');
  assert.equal(await page.locator('#tcModHistoryFrom').inputValue(), '2026-03-23');
  assert.equal(await page.locator('#tcModHistoryTo').inputValue(), '');
  assert.match(await page.locator('#tcModHistoryStatus').innerText(), /No modifications match/);
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await mods.focus();
  await mods.press('ArrowRight');
  assert.equal(await executions.getAttribute('aria-selected'), 'true');
  assert.deepEqual(await border(), [transparent, blue]);
  assert.equal(await executions.locator('.tc-tab-tooltip').isVisible(), true);
  await page.locator('#tcHistoryRows').getByText('Failed').waitFor();
  assert.match(await page.locator('#tcHistoryRows').innerText(), /Mar 23, 2026, 6:59 PM/);
  await page.locator('#tcHistoryOutcome').selectOption('Failed');
  assert.equal(await page.locator('#tcHistoryRows tr').count(), 1);
  assert.match(await page.locator('#tcHistoryRows').innerText(), /Failed/);
  assert.equal(await page.locator('#tcHistoryFrom').inputValue(), '');
  await mods.click();
  assert.equal(calls.filter(([url]) => url.endsWith('/modification-history')).length, 1);
  assert.equal(await page.getByLabel('Modified by').inputValue(), 'joy');

  await page.getByRole('tab', { name: 'Details', exact: true }).click();
  assert.match(await page.locator('.tc-planning').innerText(), /Activated Date\s+Mar 23, 2026, 6:59 PM/);
  assert.match(await page.locator('.tc-planning').innerText(), /Target Date\s+Mar 23, 2026/);
  const chips = page.locator('.tc-tags');
  assert.deepEqual(await chips.getByRole('listitem').allTextContents(), [
    'fixed-created-date', 'PI20', 'TC Migration Batch 2', 'V15 New Feature',
  ]);
  assert.equal(await chips.evaluate((list) => getComputedStyle(list).flexWrap), 'wrap');
});

browserTest('modification history displays loading, retry and empty states', async ({ page, mocks }) => {
  let finish;
  mocks.modifications = (route) => new Promise((resolve) => {
    finish = () => resolve(route.fulfill({ status: 403, json: { error: 'ADO access denied.' } }));
  });
  await openCase(page);
  await page.getByRole('tab', { name: 'Modification History', exact: true }).click();
  await page.getByRole('progressbar', { name: 'Loading modification history' }).waitFor();
  await finish();
  await page.getByText('ADO access denied.').waitFor();
  mocks.modifications = (route) => route.fulfill({ json: { updates: [] } });
  await page.locator('#tcModHistoryRetry').click();
  await page.getByText('No modification history returned by ADO for this test case.').waitFor();
});
