const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { test, before, after } = require('node:test');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND' || !error.message.startsWith("Cannot find module 'playwright'")) throw error;
}
const skip = chromium ? false : 'Install Playwright and its Chromium runtime for browser integration tests.';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
let server, origin;

before(async () => {
  if (!chromium) return;
  server = http.createServer(async (req, res) => {
    const name = path.basename(new URL(req.url, 'http://localhost').pathname) || 'index.html';
    try {
      const file = await readFile(path.join(__dirname, '../frontend', name));
      res.writeHead(200, { 'Content-Type': types[path.extname(name)] });
      res.end(file);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = 'http://127.0.0.1:' + server.address().port;
});
after(() => server?.close());

const detailSteps = [
  { action: '<p>1. Load LNG Plant Simulation.hsc in HYSYS.</p>', expected: '<div>See procedure.</div>' },
  { action: '<p>Step 2: Open &lt;E-100&gt; and <Feed.name>.</p><p>Leave <P> as entered.<br>Check A | B &amp; X.</p>',
    expected: '<div>First line</div><div>Second line<br>Third line</div>' },
  { action: '<ol start="4"><li>Choose <b>X</b><ul><li>Nested</li></ul></li><li>Choose Y</li></ol><script>ignore()</script>',
    expected: '' },
  { action: 'Keep [name], ~, _, *, &lt;10°C, &amp;amp; and C:\\Cases\\|A.', expected: 'λ ≥ 10 °C' },
  { action: 'First\r\nsecond\nthird', expected: 'line\nline' },
];
const expectedHeader = '| Step | Action | Expected result |\n|---|---|---|';
const generatedAi = [
  { step: 1, action: 'Open HYSYS and load LNG Plant Simulation.hsc.', expected: 'See procedure.' },
  { step: 2, action: 'Open E-100.', expected: 'Identify the expected state.' },
  { step: 3, action: 'Choose X and Y.', expected: 'Not specified in the original test case; requires clarification.' },
  { step: 4, action: 'Check the values.', expected: 'λ ≥ 10 °C' },
  { step: 5, action: 'Follow steps.', expected: 'Check the results.' },
];

async function browserCase(t, { steps = detailSteps, connected = true, rewrite, viewport } = {}) {
  const browser = await chromium.launch({
    executablePath: process.env.ADO_TEST_CHROMIUM_EXECUTABLE,
    args: process.env.ADO_TEST_CHROMIUM_ARGS?.split(' ').filter(Boolean),
  });
  t.after(() => browser.close());
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(5500);
  const requests = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    requests.push({ pathname, method: request.method(), body: request.postDataJSON() });
    if (pathname === '/api/chat/test-steps/rewrite' && rewrite) return rewrite(route);
    const responses = {
      '/api/health': { status: 'ok' },
      '/api/setup/status': { connected: true },
      '/api/chat/status': { connected, models: connected ? [{ id: 'gpt-luna-test' }, { id: 'other-model' }] : [] },
      '/api/work-items/test-cases/search': { testCases: Array.from({ length: 12 }, (_, index) => ({
        id: index + 1, title: 'Case ' + (index + 1), state: 'Design',
      })) },
      '/api/work-items/test-cases/11': { id: 11, title: 'Case 11', fields: [], steps, url: 'https://example.test/11' },
    };
    await route.fulfill({ json: responses[pathname] || {} });
  });
  await page.goto(origin);
  await page.getByRole('tab', { name: 'Work Items' }).click();
  await page.locator('[data-work-tab="test-case"]').click();
  await page.locator('#tcQuery').fill('11');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.locator('#tcNext').click();
  await page.getByRole('radio', { name: 'Select test case 11: Case 11' }).check();
  const all = page.getByRole('button', { name: 'Copy All Steps' });
  await all.waitFor();
  return {
    page, context, all, dialog: page.getByRole('dialog', { name: 'Copy Test Steps' }),
    editor: page.getByRole('textbox', { name: 'Test steps Markdown' }),
    status: page.locator('#tcStepCopyStatus'), requests,
    clipboard: () => page.evaluate(() => navigator.clipboard.readText()),
  };
}

test('real browser shows and copies one SVG row by hover or keyboard', { skip }, async (t) => {
  const { page, all, clipboard } = await browserCase(t);
  await page.mouse.move(1, 1);
  const first = page.getByRole('button', { name: 'Copy step 1', exact: true });
  const second = page.getByRole('button', { name: 'Copy step 2', exact: true });
  const interaction = (button) => button.evaluate((node) => [getComputedStyle(node).opacity, getComputedStyle(node).pointerEvents]);
  assert.deepEqual(await interaction(first), ['0', 'none']);
  await second.locator('xpath=ancestor::tr').getByText('Second line', { exact: false }).hover();
  assert.deepEqual(await interaction(first), ['0', 'none']);
  assert.deepEqual(await interaction(second), ['1', 'auto']);
  assert.equal(await second.locator('svg').count(), 1);
  await second.click();
  await page.getByText('Step 2 copied.', { exact: true }).waitFor();
  const expectedSecond = expectedHeader + '\n| 2 | Open &lt;E-100&gt; and &lt;Feed.name&gt;.<br>Leave &lt;P&gt; as entered.<br>Check A \\| B &amp; X. | First line<br>Second line<br>Third line |';
  assert.equal(await clipboard(), expectedSecond);
  await page.mouse.move(1, 1);
  await all.focus();
  await page.keyboard.press('Tab');
  assert.equal(await first.evaluate((button) => button === document.activeElement && button.matches(':focus-visible')), true);
  assert.equal(await first.evaluate((button) => getComputedStyle(button).outlineStyle), 'solid');
  assert.deepEqual(await interaction(first), ['1', 'auto']);
  await page.keyboard.press('Enter');
  await page.getByText('Step 1 copied.', { exact: true }).waitFor();
  assert.equal(await clipboard(), expectedHeader + '\n| 1 | Load LNG Plant Simulation.hsc in HYSYS. | See procedure. |');

  await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', {
    value: async () => { throw new DOMException('Denied', 'NotAllowedError'); },
  }));
  await page.keyboard.press('Enter');
  await page.getByText(/Could not copy. Allow clipboard access/).waitFor();
  assert.match(await clipboard(), /Load LNG Plant/);
});

test('real browser exports all ordered rows and keeps a scrollable modal open until Close', { skip }, async (t) => {
  const steps = [...detailSteps, ...Array.from({ length: 545 }, (_, index) => ({ action: 'Run check ' + (index + 6), expected: '' }))];
  const { page, all, dialog, editor, clipboard, requests, status } = await browserCase(t, {
    steps, viewport: { width: 360, height: 640 },
  });
  await all.click();
  await dialog.waitFor();
  const count = await page.locator('#tcStepCopyCount').textContent();
  assert.equal(count, '550 steps');
  assert.equal(await editor.evaluate((element) => element === document.activeElement), true);
  assert.ok(await editor.evaluate((element) => element.scrollHeight > element.clientHeight));
  assert.ok((await dialog.boundingBox()).width <= 360 - 24);
  const original = await editor.inputValue();
  const lines = original.split('\n');
  assert.equal(lines.length, 552);
  assert.equal(lines[3], '| 2 | Open &lt;E-100&gt; and &lt;Feed.name&gt;.<br>Leave &lt;P&gt; as entered.<br>Check A \\| B &amp; X. | First line<br>Second line<br>Third line |');
  assert.equal(lines[4], '| 3 | 4. Choose X<br>   - Nested<br>5. Choose Y |  |');
  assert.match(lines[5], /\\\[name\\\], \\~, \\_, \\\*, &lt;10°C, &amp;amp; and C:\\\\Cases\\\\\\\|A\. \| λ ≥ 10 °C/);
  assert.equal(lines[6], '| 5 | First<br>second<br>third | line<br>line |');
  assert.equal(lines.at(-1), '| 550 | Run check 550 |  |');
  await page.mouse.click(1, 1);
  assert.equal(await dialog.isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), true);
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  const copy = dialog.getByRole('button', { name: 'Copy', exact: true });
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await copy.evaluate((button) => button === document.activeElement), true);
  await page.keyboard.press('Tab');
  assert.equal(await close.evaluate((button) => button === document.activeElement), true);
  await editor.fill('User-edited Markdown');
  await copy.click();
  await status.getByText('Copied to the clipboard.').waitFor();
  assert.equal(await clipboard(), 'User-edited Markdown');
  assert.equal(await dialog.isVisible(), true);
  assert.equal(requests.filter((item) => item.pathname.startsWith('/api/work-items/')).length, 2);

  page.once('dialog', (confirm) => confirm.dismiss());
  await dialog.getByRole('button', { name: 'Reset' }).click();
  assert.equal(await editor.inputValue(), 'User-edited Markdown');
  page.once('dialog', (confirm) => confirm.accept());
  await dialog.getByRole('button', { name: 'Reset' }).click();
  assert.equal(await editor.inputValue(), original);
  await close.click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await all.evaluate((button) => button === document.activeElement), true);
});

test('real browser retries AI failures and keeps independent copies of both versions', { skip }, async (t) => {
  let respond;
  const { page, all, dialog, editor, status, requests, clipboard } = await browserCase(t, {
    rewrite: (route) => new Promise((resolve, reject) => {
      respond = (json, status = 200) => route.fulfill({ json, status }).then(resolve, reject);
    }),
  });
  await page.locator('#chatModel').evaluate((select) => { select.value = 'other-model'; });
  await all.click();
  await editor.fill('Edited original');
  const generate = dialog.getByRole('button', { name: 'AI-modification' });
  const source = dialog.getByRole('button', { name: 'Original', exact: true });
  const ai = dialog.getByRole('button', { name: 'AI-modified', exact: true });
  const rewrites = () => requests.filter((item) => item.pathname === '/api/chat/test-steps/rewrite');

  for (const [result, httpStatus, expected] of [
    [{ error: 'Copilot timed out. Try again.' }, 504, /timed out/],
    [{ steps: generatedAi.slice(1) }, 200, /invalid test steps/],
    [{ steps: generatedAi }, 200, /ready for review/],
  ]) {
    const request = page.waitForRequest('**/api/chat/test-steps/rewrite');
    await generate.click();
    await request;
    await dialog.getByRole('progressbar').waitFor();
    await generate.evaluate((button) => button.click());
    await respond(result, httpStatus);
    await status.getByText(expected).waitFor();
    if (httpStatus !== 200 || result.steps.length !== generatedAi.length) {
      assert.equal(await editor.inputValue(), 'Edited original');
      assert.equal(await ai.isDisabled(), true);
    }
    assert.equal(await dialog.isVisible(), true);
  }
  assert.equal(rewrites().length, 3);
  for (const request of rewrites()) {
    assert.deepEqual(Object.keys(request.body), ['model', 'steps']);
    assert.equal(request.body.model, 'other-model');
    assert.deepEqual(request.body.steps.map((row) => row.step), [1, 2, 3, 4, 5]);
    assert.match(request.body.steps[1].action, /<E-100> and <Feed.name>/);
  }
  assert.equal(await ai.getAttribute('aria-pressed'), 'true');
  const aiBaseline = await editor.inputValue();
  assert.match(aiBaseline, /requires clarification/);
  await editor.fill('Edited AI');
  await source.click();
  assert.equal(await editor.inputValue(), 'Edited original');
  await ai.click();
  assert.equal(await editor.inputValue(), 'Edited AI');
  await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
  await status.getByText('Copied to the clipboard.').waitFor();
  assert.equal(await clipboard(), 'Edited AI');
  assert.equal(rewrites().length, 3);
  page.once('dialog', (confirm) => confirm.accept());
  await dialog.getByRole('button', { name: 'Reset' }).click();
  assert.equal(await editor.inputValue(), aiBaseline);
  await source.click();
  assert.equal(await editor.inputValue(), 'Edited original');

  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  await close.click();
  await all.click();
  const nextRequest = page.waitForRequest('**/api/chat/test-steps/rewrite');
  await generate.click();
  await nextRequest;
  await close.click();
  await all.click();
  await status.getByText(/previous Copilot request is still finishing/).waitFor();
  assert.equal(await generate.isDisabled(), true);
  await respond({ steps: generatedAi });
  await dialog.getByRole('progressbar').waitFor({ state: 'hidden' });
  assert.equal(await generate.isEnabled(), true);
  assert.equal(await ai.isDisabled(), true);
  assert.match(await editor.inputValue(), /Load LNG Plant Simulation.hsc in HYSYS/);
  assert.equal(rewrites().length, 4);
});

test('real browser offers original copy when Copilot or shared steps are unavailable', { skip }, async (t) => {
  const disconnected = await browserCase(t, { connected: false });
  await disconnected.all.click();
  const original = await disconnected.editor.inputValue();
  await disconnected.dialog.getByRole('button', { name: 'AI-modification' }).click();
  await disconnected.status.getByText(/Connect to Copilot in Setup/).waitFor();
  assert.equal(await disconnected.editor.inputValue(), original);
  assert.ok(!disconnected.requests.some((item) => item.pathname.endsWith('/rewrite')));

  const missing = await browserCase(t, {
    steps: [...detailSteps, { action: 'Shared steps #99 could not be loaded.', expected: '', unavailable: true }],
  });
  await missing.all.click();
  assert.equal(await missing.dialog.getByText(/Some ADO steps are unavailable/).isVisible(), true);
  assert.equal(await missing.dialog.getByRole('button', { name: 'AI-modification' }).isDisabled(), true);
  assert.match(await missing.editor.inputValue(), /Shared steps #99 could not be loaded/);
  assert.equal(await missing.page.getByRole('button', { name: 'Copy step 6', exact: true }).count(), 0);
});
