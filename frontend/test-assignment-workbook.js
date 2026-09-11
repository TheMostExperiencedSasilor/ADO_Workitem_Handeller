(() => {
  const panel = document.querySelector('.test-plan-panel');
  const trackerPanel = document.querySelector('#testResultsTrackerPanel');
  if (!panel || !trackerPanel || document.querySelector('#assignmentWorkbookSection')) return;

  const resultOptions = ['', 'Passed', 'Failed', 'Blocked', 'Not Run', 'N/A'];
  const editableKeys = [
    'round1Results', 'round2Results', 'singleRunResults', 'manualRun',
    'comment', 'solution', 'defects',
  ];
  let trackedRows = [];
  let sessionMeta = {};

  const section = document.createElement('section');
  section.id = 'assignmentWorkbookSection';
  section.className = 'assignment-workbook-section';
  section.innerHTML = `
    <div class="assignment-workbook-heading">
      <div>
        <h3>Test Result Tracker</h3>
        <p>Read Define for metadata, use Execute to find one tester's assigned cases, log results here, save work as JSON, then export or transfer results to OTE.</p>
      </div>
      <span class="mini-status">Define + Execute + OTE</span>
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
      <button id="transferAssignmentToOte" type="button" class="secondary-button" disabled>Transfer to OTE</button>
      <input id="assignmentJsonFile" type="file" accept="application/json,.json" hidden>
      <input id="assignmentOteFile" type="file" accept="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx" hidden>
    </div>
    <p id="assignmentWorkbookStatus" class="mini-status" role="status" aria-live="polite">Load an assignment or open a saved JSON session.</p>

    <div id="assignmentWorkbookPreview" hidden>
      <div id="assignmentWorkbookSummary" class="test-suite-summary"></div>
      <div class="assignment-preview-wrap">
        <table class="assignment-preview-table">
          <thead>
            <tr>
              <th>ID</th><th>Title</th><th>Product Area</th><th>Automation Script Name</th>
              <th>Round 1 results</th><th>Round 2 results</th><th>Single run results</th><th>Manual run</th>
              <th>Comment</th><th>Solution</th><th>Defects</th>
            </tr>
          </thead>
          <tbody id="assignmentWorkbookRows"></tbody>
        </table>
      </div>
    </div>

    <dialog id="oteTransferDialog" class="ote-transfer-dialog">
      <form method="dialog">
        <h3>Transfer to OTE</h3>
        <p>Select which logged result column should be written into the OTE <strong>Outcome</strong> column.</p>
        <label for="oteResultKey">Result source</label>
        <select id="oteResultKey">
          <option value="round1Results">Round 1 results</option>
          <option value="round2Results">Round 2 results</option>
          <option value="singleRunResults">Single run results</option>
          <option value="manualRun">Manual run</option>
        </select>
        <div class="action-row">
          <button type="submit" value="cancel" class="secondary-button">Cancel</button>
          <button id="chooseOteFile" type="button">Choose OTE File</button>
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
  const transferButton = section.querySelector('#transferAssignmentToOte');
  const jsonFileInput = section.querySelector('#assignmentJsonFile');
  const oteFileInput = section.querySelector('#assignmentOteFile');
  const transferDialog = section.querySelector('#oteTransferDialog');
  const oteResultKey = section.querySelector('#oteResultKey');
  const chooseOteFile = section.querySelector('#chooseOteFile');
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
    transferButton.disabled = !enabled;
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
    const values = [
      ['Test Plan', sessionMeta.planId ?? ''],
      ['Suite', sessionMeta.suiteId ?? ''],
      ['Cases', trackedRows.length],
      ['Tester', sessionMeta.tester || testerInput.value.trim()],
    ];
    for (const [label, value] of values) {
      const item = document.createElement('span');
      item.textContent = `${label}: ${value}`;
      summary.appendChild(item);
    }
  }

  function normalizeTrackedRow(row) {
    const normalized = {
      testCaseId: Number(row.testCaseId ?? row.id),
      title: String(row.title || ''),
      productArea: String(row.productArea || ''),
      automationScriptName: String(row.automationScriptName || ''),
      order: row.order ?? null,
      tester: String(row.tester || ''),
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
      version: 1,
      planId: sessionMeta.planId ?? null,
      suiteId: sessionMeta.suiteId ?? null,
      tester: sessionMeta.tester || testerInput.value.trim(),
      sourceUrl: urlInput.value.trim(),
      savedAt: new Date().toISOString(),
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
      sessionMeta = { planId: data.planId, suiteId: data.suiteId, tester: data.matchedTester || testerInput.value.trim() };
      renderSummary();
      renderRows();
      setStatus(data.message || 'Assignment loaded. Fill results directly in the table.');
    } catch (error) {
      setStatus(error.message || 'Unable to read the assignment.', true);
    } finally {
      previewButton.disabled = false;
    }
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
      sessionMeta = { planId: data.planId, suiteId: data.suiteId, tester: data.tester || '' };
      if (data.sourceUrl) urlInput.value = data.sourceUrl;
      if (data.tester) testerInput.value = data.tester;
      renderSummary();
      renderRows();
      setStatus(`Opened saved work: ${file.name}`);
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

  transferButton.addEventListener('click', () => transferDialog.showModal());
  chooseOteFile.addEventListener('click', () => oteFileInput.click());
  oteFileInput.addEventListener('change', async () => {
    const file = oteFileInput.files?.[0];
    if (!file) return;
    transferDialog.close();
    transferButton.disabled = true;
    setStatus(`Transferring ${oteResultKey.options[oteResultKey.selectedIndex].text} to OTE…`);
    try {
      const formData = new FormData();
      formData.append('oteFile', file);
      formData.append('resultKey', oteResultKey.value);
      formData.append('rows', JSON.stringify(trackedRows));
      const response = await fetch('/api/test-plans/transfer-to-ote', { method: 'POST', body: formData });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Request failed: ${response.status}`);
      }
      const updated = response.headers.get('X-OTE-Updated-Cases') || '?';
      const stem = file.name.replace(/\.xlsx$/i, '');
      const filename = `${stem}_Completed.xlsx`;
      downloadBlob(await response.blob(), filename);
      setStatus(`Transferred outcomes for ${updated} Test Case(s) into OTE: ${filename}`);
    } catch (error) {
      if (error instanceof TypeError && /fetch/i.test(error.message || '')) {
        let backendAvailable = false;
        try {
          const health = await fetch('/api/health', { cache: 'no-store' });
          backendAvailable = health.ok;
        } catch {
          backendAvailable = false;
        }
        setStatus(
          backendAvailable
            ? 'OTE transfer connection was interrupted while processing the workbook. Please try again.'
            : 'Backend connection was lost during OTE transfer. Keep the launcher window open, restart the app if needed, then try again.',
          true
        );
      } else {
        setStatus(error.message || 'Unable to transfer results to OTE.', true);
      }
    } finally {
      oteFileInput.value = '';
      enableWorkActions();
    }
  });

  const primaryUrl = document.querySelector('#testPlanUrl');
  const chartsUrl = document.querySelector('#testChartsUrl');
  if (primaryUrl) {
    let syncingUrl = false;
    const inputs = [primaryUrl, urlInput, chartsUrl].filter(Boolean);
    const syncFrom = (source) => {
      if (syncingUrl) return;
      syncingUrl = true;
      for (const input of inputs) {
        if (input !== source) input.value = source.value;
      }
      syncingUrl = false;
    };
    inputs.forEach((input) => input.addEventListener('input', () => syncFrom(input)));
    if (primaryUrl.value.trim()) {
      for (const input of inputs) {
        if (input !== primaryUrl) input.value = primaryUrl.value.trim();
      }
    }
  }

  const subTabs = [
    {
      tab: document.querySelector('#testResultsSummaryTab'),
      panel: document.querySelector('#testResultsSummaryPanel'),
    },
    {
      tab: document.querySelector('#testResultsTrackerTab'),
      panel: document.querySelector('#testResultsTrackerPanel'),
    },
    {
      tab: document.querySelector('#testResultsChartsTab'),
      panel: document.querySelector('#testResultsChartsPanel'),
    },
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
