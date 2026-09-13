(() => {
  const panel = document.querySelector('.test-plan-panel');
  const trackerPanel = document.querySelector('#testResultsTrackerPanel');
  if (!panel || !trackerPanel || document.querySelector('#assignmentWorkbookSection')) return;

  const resultOptions = ['', 'Passed', 'Failed', 'Blocked', 'Not Run', 'N/A'];
  const resultLabels = {
    round1Results: 'Round 1',
    round2Results: 'Round 2',
    singleRunResults: 'Single Run',
    manualRun: 'Manual Run',
  };
  const editableKeys = [
    'round1Results', 'round2Results', 'singleRunResults', 'manualRun',
    'comment', 'solution', 'defects',
  ];
  let trackedRows = [];
  let sessionMeta = { publishedRuns: [] };

  const section = document.createElement('section');
  section.id = 'assignmentWorkbookSection';
  section.className = 'assignment-workbook-section';
  section.innerHTML = `
    <div class="assignment-workbook-heading">
      <div>
        <h3>Test Result Tracker</h3>
        <p>Read Define + Execute, log results in the web table, save work locally, then publish a selected result column as a proper Azure DevOps Test Run.</p>
      </div>
      <span class="mini-status">ADO-native result publishing</span>
    </div>

    <div class="assignment-workbook-grid">
      <div class="assignment-url-field">
        <label for="assignmentWorkbookUrl">Azure DevOps Test Plan URL</label>
        <input id="assignmentWorkbookUrl" type="text" placeholder="https://dev.azure.com/.../_testPlans/execute?planId=83602&suiteId=141923">
      </div>
      <div>
        <label for="assignmentWorkbookTester">Assigned tester</label>
        <input id="assignmentWorkbookTester" type="text" placeholder="Display name or email">
      </div>
    </div>

    <div class="action-row">
      <button id="previewAssignmentWorkbook" type="button">Read Define + Execute</button>
      <button id="saveAssignmentJson" type="button" class="secondary-button" disabled>Save Work</button>
      <button id="openAssignmentJson" type="button" class="secondary-button">Open Work</button>
      <button id="exportAssignmentWorkbook" type="button" class="secondary-button" disabled>Export Excel</button>
      <button id="createAdoTestRun" type="button" disabled>Create ADO Test Run</button>
      <button id="clearAllAssignmentResults" type="button" class="danger-button" disabled>Clear all results</button>
      <input id="assignmentJsonFile" type="file" accept="application/json,.json" hidden>
    </div>
    <p id="assignmentWorkbookStatus" class="mini-status" role="status" aria-live="polite">Load an assignment or open a saved JSON session.</p>
    <div id="publishedRunsPanel" class="published-runs-panel" hidden></div>

    <div id="assignmentWorkbookPreview" hidden>
      <div id="assignmentWorkbookSummary" class="test-suite-summary"></div>
      <div class="assignment-preview-wrap">
        <table class="assignment-preview-table">
          <thead>
            <tr>
              <th>ID</th><th>Title</th><th>Product Area</th><th>Automation Script Name</th>
              <th><div class="result-header">Round 1 results<button type="button" class="clear-result-column" data-result-key="round1Results" data-result-label="Round 1 results" disabled>Clear</button></div></th>
              <th><div class="result-header">Round 2 results<button type="button" class="clear-result-column" data-result-key="round2Results" data-result-label="Round 2 results" disabled>Clear</button></div></th>
              <th><div class="result-header">Single run results<button type="button" class="clear-result-column" data-result-key="singleRunResults" data-result-label="Single run results" disabled>Clear</button></div></th>
              <th><div class="result-header">Manual run<button type="button" class="clear-result-column" data-result-key="manualRun" data-result-label="Manual run" disabled>Clear</button></div></th>
              <th>Comment</th><th>Solution</th><th>Defects</th>
            </tr>
          </thead>
          <tbody id="assignmentWorkbookRows"></tbody>
        </table>
      </div>
    </div>

    <dialog id="adoTestRunDialog" class="ado-run-dialog">
      <form method="dialog">
        <h3>Create Azure DevOps Test Run</h3>
        <p>Choose one tracker result column. Only rows containing a result will be included; Azure DevOps test-point IDs are validated again before anything is written.</p>
        <label for="adoRunResultKey">Result source</label>
        <select id="adoRunResultKey">
          <option value="round1Results">Round 1 results</option>
          <option value="round2Results">Round 2 results</option>
          <option value="singleRunResults">Single run results</option>
          <option value="manualRun">Manual run</option>
        </select>
        <label for="adoRunName">Test run name</label>
        <input id="adoRunName" type="text" maxlength="256">
        <div id="adoRunPreview" class="ado-run-preview"></div>
        <p id="adoRunDialogStatus" class="mini-status" role="status" aria-live="polite"></p>
        <div class="action-row">
          <button type="submit" value="cancel" class="secondary-button">Cancel</button>
          <button id="publishAdoTestRun" type="button">Create Test Run</button>
        </div>
      </form>
    </dialog>`;

  trackerPanel.appendChild(section);

  const urlInput = section.querySelector('#assignmentWorkbookUrl');
  const testerInput = section.querySelector('#assignmentWorkbookTester');
  const previewButton = section.querySelector('#previewAssignmentWorkbook');
  const saveButton = section.querySelector('#saveAssignmentJson');
  const openButton = section.querySelector('#openAssignmentJson');
  const exportButton = section.querySelector('#exportAssignmentWorkbook');
  const createRunButton = section.querySelector('#createAdoTestRun');
  const clearAllResultsButton = section.querySelector('#clearAllAssignmentResults');
  const clearResultButtons = [...section.querySelectorAll('.clear-result-column')];
  const jsonFileInput = section.querySelector('#assignmentJsonFile');
  const runDialog = section.querySelector('#adoTestRunDialog');
  const runResultKey = section.querySelector('#adoRunResultKey');
  const runName = section.querySelector('#adoRunName');
  const runPreview = section.querySelector('#adoRunPreview');
  const runDialogStatus = section.querySelector('#adoRunDialogStatus');
  const publishRunButton = section.querySelector('#publishAdoTestRun');
  const publishedRunsPanel = section.querySelector('#publishedRunsPanel');
  const status = section.querySelector('#assignmentWorkbookStatus');
  const preview = section.querySelector('#assignmentWorkbookPreview');
  const summary = section.querySelector('#assignmentWorkbookSummary');
  const rowsBody = section.querySelector('#assignmentWorkbookRows');

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
    status.classList.toggle('ok', !error && Boolean(message));
  }

  function enableWorkActions() {
    const enabled = trackedRows.length > 0;
    saveButton.disabled = !enabled;
    exportButton.disabled = !enabled;
    createRunButton.disabled = !enabled;
    clearAllResultsButton.disabled = !enabled;
    clearResultButtons.forEach((button) => { button.disabled = !enabled; });
  }

  function makeResultSelect(row, key) {
    const select = document.createElement('select');
    select.className = 'tracking-result-select';
    for (const optionValue of resultOptions) {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = optionValue || '—';
      if ((row[key] || '') === optionValue) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      row[key] = select.value;
      setStatus('Unsaved changes.');
    });
    return select;
  }

  function makeTextInput(row, key) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tracking-text-input';
    input.value = row[key] || '';
    input.addEventListener('input', () => {
      row[key] = input.value;
      setStatus('Unsaved changes.');
    });
    return input;
  }

  function renderRows() {
    const fragment = document.createDocumentFragment();
    for (const row of trackedRows) {
      const tr = document.createElement('tr');
      const readOnlyValues = [row.testCaseId, row.title, row.productArea, row.automationScriptName];
      for (const value of readOnlyValues) {
        const td = document.createElement('td');
        td.textContent = value ?? '';
        tr.appendChild(td);
      }
      for (const key of ['round1Results', 'round2Results', 'singleRunResults', 'manualRun']) {
        const td = document.createElement('td');
        td.appendChild(makeResultSelect(row, key));
        tr.appendChild(td);
      }
      for (const key of ['comment', 'solution', 'defects']) {
        const td = document.createElement('td');
        td.appendChild(makeTextInput(row, key));
        tr.appendChild(td);
      }
      fragment.appendChild(tr);
    }
    rowsBody.replaceChildren(fragment);
    preview.hidden = false;
    enableWorkActions();
  }

  function renderSummary() {
    summary.replaceChildren();
    const pointCount = trackedRows.reduce((sum, row) => sum + row.testPointIds.length, 0);
    const values = [
      ['Test Plan', sessionMeta.planId ?? ''],
      ['Suite', sessionMeta.suiteId ?? ''],
      ['Cases', trackedRows.length],
      ['Test Points', pointCount],
      ['Tester', sessionMeta.tester || testerInput.value.trim()],
    ];
    for (const [label, value] of values) {
      const item = document.createElement('span');
      item.textContent = `${label}: ${value}`;
      summary.appendChild(item);
    }
  }

  function renderPublishedRuns() {
    const runs = Array.isArray(sessionMeta.publishedRuns) ? sessionMeta.publishedRuns : [];
    publishedRunsPanel.replaceChildren();
    if (!runs.length) {
      publishedRunsPanel.hidden = true;
      return;
    }
    const heading = document.createElement('strong');
    heading.textContent = 'Published ADO Test Runs';
    publishedRunsPanel.appendChild(heading);
    for (const run of runs) {
      const item = document.createElement('div');
      item.className = 'published-run-item';
      const text = document.createElement('span');
      text.textContent = `${run.resultLabel || 'Results'} · Run ${run.runId} · ${run.publishedPoints || 0} point(s)`;
      item.appendChild(text);
      const target = run.webAccessUrl || run.apiUrl;
      if (target) {
        const link = document.createElement('a');
        link.href = target;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Open in ADO';
        item.appendChild(link);
      }
      publishedRunsPanel.appendChild(item);
    }
    publishedRunsPanel.hidden = false;
  }

  function normalizeTrackedRow(row) {
    const normalized = {
      testCaseId: Number(row.testCaseId ?? row.id),
      title: String(row.title || ''),
      productArea: String(row.productArea || ''),
      automationScriptName: String(row.automationScriptName || ''),
      order: row.order ?? null,
      tester: String(row.tester || ''),
      testPointIds: Array.isArray(row.testPointIds)
        ? [...new Set(row.testPointIds.map(Number).filter((value) => Number.isInteger(value) && value > 0))]
        : [],
      configurations: Array.isArray(row.configurations) ? row.configurations.map(String) : [],
    };
    for (const key of editableKeys) normalized[key] = String(row[key] || '');
    return normalized;
  }

  async function readJsonResponse(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
    return data;
  }

  function downloadBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }

  function sessionDocument() {
    return {
      version: 2,
      planId: sessionMeta.planId ?? null,
      suiteId: sessionMeta.suiteId ?? null,
      tester: sessionMeta.tester || testerInput.value.trim(),
      sourceUrl: urlInput.value.trim(),
      savedAt: new Date().toISOString(),
      publishedRuns: Array.isArray(sessionMeta.publishedRuns) ? sessionMeta.publishedRuns : [],
      rows: trackedRows,
    };
  }

  previewButton.addEventListener('click', async () => {
    if (!urlInput.value.trim() || !testerInput.value.trim()) {
      setStatus('Test Plan URL and Assigned tester are required.', true);
      return;
    }
    previewButton.disabled = true;
    setStatus('Reading Define and Execute…');
    try {
      const response = await fetch('/api/test-plans/assignment-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.value.trim(), tester: testerInput.value.trim() }),
      });
      const data = await readJsonResponse(response);
      trackedRows = (data.rows || []).map(normalizeTrackedRow);
      sessionMeta = {
        planId: data.planId,
        suiteId: data.suiteId,
        tester: data.matchedTester || testerInput.value.trim(),
        publishedRuns: [],
      };
      renderSummary();
      renderRows();
      renderPublishedRuns();
      setStatus(data.message || 'Assignment loaded. Fill results directly in the table.');
    } catch (error) {
      setStatus(error.message || 'Unable to read the assignment.', true);
    } finally {
      previewButton.disabled = false;
    }
  });

  clearResultButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (!trackedRows.length) return;
      const key = button.dataset.resultKey;
      const label = button.dataset.resultLabel || 'this result column';
      if (!key) return;
      if (!window.confirm(`Clear all values in "${label}"?`)) return;
      for (const row of trackedRows) row[key] = '';
      renderRows();
      setStatus(`${label} cleared for all loaded test cases.`);
    });
  });

  clearAllResultsButton.addEventListener('click', () => {
    if (!trackedRows.length) return;
    if (!window.confirm('Clear Round 1, Round 2, Single run and Manual run results for all loaded test cases?')) return;
    const keys = ['round1Results', 'round2Results', 'singleRunResults', 'manualRun'];
    trackedRows.forEach((row) => keys.forEach((key) => { row[key] = ''; }));
    renderRows();
    setStatus('All result columns cleared. Comments, solutions and defects were kept.');
  });

  saveButton.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(sessionDocument(), null, 2)], { type: 'application/json' });
    const tester = (sessionMeta.tester || 'tester').replace(/[^A-Za-z0-9._-]+/g, '_');
    const filename = `TestPlan_${sessionMeta.planId || 'work'}_Suite_${sessionMeta.suiteId || 'session'}_${tester}.json`;
    downloadBlob(blob, filename);
    setStatus(`Work saved: ${filename}`);
  });

  openButton.addEventListener('click', () => jsonFileInput.click());
  jsonFileInput.addEventListener('change', async () => {
    const file = jsonFileInput.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.rows)) throw new Error('Invalid saved work file.');
      trackedRows = data.rows.map(normalizeTrackedRow);
      sessionMeta = {
        planId: data.planId,
        suiteId: data.suiteId,
        tester: data.tester || '',
        publishedRuns: Array.isArray(data.publishedRuns) ? data.publishedRuns : [],
      };
      if (data.sourceUrl) urlInput.value = data.sourceUrl;
      if (data.tester) testerInput.value = data.tester;
      renderSummary();
      renderRows();
      renderPublishedRuns();
      const missingMappings = trackedRows.filter((row) => !row.testPointIds.length).length;
      setStatus(missingMappings
        ? `Opened ${file.name}. ${missingMappings} row(s) are from an older session without Test Point IDs; reload from ADO before publishing.`
        : `Opened saved work: ${file.name}`,
        false);
    } catch (error) {
      setStatus(error.message || 'Could not open the JSON work file.', true);
    } finally {
      jsonFileInput.value = '';
    }
  });

  exportButton.addEventListener('click', async () => {
    exportButton.disabled = true;
    setStatus('Building Excel workbook…');
    try {
      const response = await fetch('/api/test-plans/assignment-workbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: trackedRows,
          filename: `TestPlan_${sessionMeta.planId || 'Results'}_Suite_${sessionMeta.suiteId || 'Main'}.xlsx`,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Request failed: ${response.status}`);
      }
      downloadBlob(await response.blob(), `TestPlan_${sessionMeta.planId || 'Results'}_Suite_${sessionMeta.suiteId || 'Main'}.xlsx`);
      setStatus('Excel workbook exported from the current web table.');
    } catch (error) {
      setStatus(error.message || 'Unable to export the Excel workbook.', true);
    } finally {
      enableWorkActions();
    }
  });

  function suggestedRunName() {
    const source = resultLabels[runResultKey.value] || 'Results';
    const tester = sessionMeta.tester || testerInput.value.trim() || 'Tester';
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '');
    return `Plan ${sessionMeta.planId || ''} Suite ${sessionMeta.suiteId || ''} - ${source} - ${tester} - ${stamp}`.trim();
  }

  function updateRunPreview(resetName = false) {
    if (resetName) runName.value = suggestedRunName();
    const key = runResultKey.value;
    const rows = trackedRows.filter((row) => String(row[key] || '').trim());
    const missingMapping = rows.filter((row) => !row.testPointIds.length).length;
    const pointIds = new Set(rows.flatMap((row) => row.testPointIds));
    const counts = new Map();
    rows.forEach((row) => counts.set(row[key], (counts.get(row[key]) || 0) + row.testPointIds.length));
    const parts = [...counts.entries()].map(([name, count]) => `${name}: ${count}`).join(' · ');
    runPreview.textContent = rows.length
      ? `${rows.length} case(s) · ${pointIds.size} test point(s)${parts ? ` · ${parts}` : ''}${missingMapping ? ` · ${missingMapping} row(s) need reload` : ''}`
      : `No ${resultLabels[key] || 'selected'} results are currently logged.`;
    publishRunButton.disabled = rows.length === 0 || missingMapping > 0;
  }

  createRunButton.addEventListener('click', () => {
    runDialogStatus.textContent = '';
    updateRunPreview(true);
    if (typeof runDialog.showModal === 'function') runDialog.showModal();
    else runDialog.setAttribute('open', '');
  });

  runResultKey.addEventListener('change', () => updateRunPreview(true));

  publishRunButton.addEventListener('click', async () => {
    if (publishRunButton.disabled) return;
    publishRunButton.disabled = true;
    runDialogStatus.textContent = 'Creating test run and publishing results…';
    try {
      const response = await fetch('/api/test-plans/publish-test-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: urlInput.value.trim(),
          resultKey: runResultKey.value,
          runName: runName.value.trim(),
          rows: trackedRows,
        }),
      });
      const data = await readJsonResponse(response);
      sessionMeta.publishedRuns = Array.isArray(sessionMeta.publishedRuns) ? sessionMeta.publishedRuns : [];
      sessionMeta.publishedRuns.push({
        runId: data.runId,
        runName: data.runName,
        resultSource: data.resultSource,
        resultLabel: data.resultLabel,
        publishedPoints: data.publishedPoints,
        publishedCases: data.publishedCases,
        webAccessUrl: data.webAccessUrl || '',
        apiUrl: data.apiUrl || '',
        publishedAt: new Date().toISOString(),
      });
      renderPublishedRuns();
      if (typeof runDialog.close === 'function') runDialog.close();
      else runDialog.removeAttribute('open');
      setStatus(`${data.message || `Created ADO Test Run ${data.runId}.`} Save Work to keep the run reference in this session.`);
    } catch (error) {
      runDialogStatus.textContent = error.message || 'Unable to create the ADO Test Run.';
      runDialogStatus.classList.add('error');
    } finally {
      updateRunPreview(false);
    }
  });

  const primaryUrl = document.querySelector('#testPlanUrl');
  const plannerUrl = document.querySelector('#plannerTestPlanUrl');
  const chartsUrl = document.querySelector('#testChartsUrl');
  if (primaryUrl) {
    let syncingUrl = false;
    const inputs = [primaryUrl, plannerUrl, urlInput, chartsUrl].filter(Boolean);
    const syncFrom = (source) => {
      if (syncingUrl) return;
      syncingUrl = true;
      inputs.forEach((input) => { if (input !== source) input.value = source.value; });
      syncingUrl = false;
    };
    inputs.forEach((input) => input.addEventListener('input', () => syncFrom(input)));
    if (primaryUrl.value.trim()) inputs.forEach((input) => { if (input !== primaryUrl) input.value = primaryUrl.value.trim(); });
  }

  const subTabs = [
    { tab: document.querySelector('#testResultsSummaryTab'), panel: document.querySelector('#testResultsSummaryPanel') },
    { tab: document.querySelector('#testResultsPlannerTab'), panel: document.querySelector('#testResultsPlannerPanel') },
    { tab: document.querySelector('#testResultsTrackerTab'), panel: document.querySelector('#testResultsTrackerPanel') },
    { tab: document.querySelector('#testResultsChartsTab'), panel: document.querySelector('#testResultsChartsPanel') },
  ].filter((item) => item.tab && item.panel);

  function activateResultSubtab(index, focus = false) {
    subTabs.forEach((item, itemIndex) => {
      const active = itemIndex === index;
      item.tab.classList.toggle('active', active);
      item.tab.setAttribute('aria-selected', String(active));
      item.tab.tabIndex = active ? 0 : -1;
      item.panel.hidden = !active;
      item.panel.classList.toggle('active', active);
    });
    if (focus) subTabs[index]?.tab.focus();
  }

  subTabs.forEach((item, index) => {
    item.tab.addEventListener('click', () => activateResultSubtab(index));
    item.tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + subTabs.length) % subTabs.length;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % subTabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = subTabs.length - 1;
      activateResultSubtab(nextIndex, true);
    });
  });

  if (subTabs.length) activateResultSubtab(0);
})();
