(() => {
  'use strict';

  const panel = document.querySelector('.test-plan-panel');
  const trackerPanel = document.querySelector('#testResultsTrackerPanel');
  if (!panel || !trackerPanel || document.querySelector('#assignmentWorkbookSection')) return;

  let assignmentRows = [];
  let assignmentById = new Map();
  let importedResults = new Map();
  let latestAdoByCase = new Map();
  let previewRows = [];
  let previewFresh = false;
  let sessionMeta = { planId: null, suiteId: null, tester: '' };

  const section = document.createElement('section');
  section.id = 'assignmentWorkbookSection';
  section.className = 'assignment-workbook-section result-staging-section';
  section.innerHTML = `
    <div class="assignment-workbook-heading">
      <div>
        <h3>Test Result Tracker</h3>
        <p>Load the assigned ADO cases, bring in automation results, sync the latest ADO status, then review exactly what will be logged.</p>
      </div>
      <span class="mini-status">Result staging + publishing</span>
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

    <div class="staging-primary-actions">
      <button id="updateAssignmentFromAdo" type="button">Update from ADO</button>
      <button id="syncResultsWithAdo" type="button" class="secondary-button" disabled>Sync with ADO</button>
    </div>
    <p id="assignmentWorkbookStatus" class="mini-status" role="status" aria-live="polite">Load the current ADO assignment first.</p>

    <section class="staging-import-panel" aria-labelledby="stagingImportHeading">
      <div class="staging-panel-heading">
        <div>
          <h4 id="stagingImportHeading">Bring in results</h4>
          <p>Import a CSV/TXT file or paste TestResult output. Imported data is staged locally until you sync with ADO.</p>
        </div>
        <span id="stagingImportSummary" class="mini-status">0 imported</span>
      </div>
      <div class="staging-import-buttons">
        <button id="importResultCsv" type="button" class="secondary-button" disabled>Import CSV</button>
        <button id="importResultTxt" type="button" class="secondary-button" disabled>Import TXT</button>
        <button id="clearImportedResults" type="button" class="secondary-button" disabled>Clear imported results</button>
        <input id="resultCsvFile" type="file" accept=".csv,text/csv" hidden>
        <input id="resultTxtFile" type="file" accept=".txt,text/plain" hidden>
      </div>
      <label for="testResultPaste">Paste TestResult output</label>
      <textarea id="testResultPaste" rows="5" placeholder="VSTS24153 Passed&#10;VSTS24846 Failed"></textarea>
      <div class="staging-import-buttons">
        <button id="applyPastedResults" type="button" disabled>Apply Pasted Results</button>
        <button id="clearPastedResults" type="button" class="secondary-button">Clear paste</button>
      </div>
    </section>

    <section id="stagingPreviewPanel" class="staging-preview-panel" hidden aria-labelledby="stagingPreviewHeading">
      <div class="staging-panel-heading">
        <div>
          <h4 id="stagingPreviewHeading">Ready-to-log preview</h4>
          <p>This table is read-only. It shows the current imported result, latest ADO status, and the action that will be taken.</p>
        </div>
        <span id="stagingPreviewSummary" class="mini-status"></span>
      </div>
      <div id="stagingPreviewNotice" class="staging-preview-notice"></div>
      <div class="staging-preview-wrap">
        <table class="staging-preview-table">
          <thead>
            <tr>
              <th>Test Case ID</th>
              <th>Title</th>
              <th>Imported Result</th>
              <th>Latest ADO Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="stagingPreviewRows"></tbody>
        </table>
      </div>
    </section>

    <div class="staging-publish-row">
      <details id="resultLoggingMenu" class="result-tracker-action-menu result-tracker-logging-menu">
        <summary class="secondary-button">Result Logging <span aria-hidden="true">▾</span></summary>
        <div class="result-tracker-menu-panel">
          <button id="createAdoTestRun" type="button" disabled>Create ADO Test Run</button>
          <button id="transferAssignmentToOte" type="button" class="secondary-button" disabled>Transfer to OTE</button>
          <label class="result-tracker-menu-checkbox" title="When disabled, Passed results are logged only when the latest ADO status is Active.">
            <input id="allowDuplicateLogging" type="checkbox">
            <span><strong>Allow duplicated logging</strong><br><small>Off by default. Completed ADO cases are skipped.</small></span>
          </label>
        </div>
      </details>
      <span id="stagingPublishSummary" class="mini-status">Sync with ADO to enable publishing.</span>
      <input id="oteWorkbookFile" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
    </div>

    <dialog id="adoTestRunDialog" class="ado-run-dialog">
      <form method="dialog">
        <h3>Create Azure DevOps Test Run</h3>
        <p id="adoRunPreview" class="ado-run-preview"></p>
        <label for="adoRunName">Test run name</label>
        <input id="adoRunName" type="text" maxlength="256">
        <p id="adoRunDialogStatus" class="mini-status" role="status" aria-live="polite"></p>
        <div class="action-row">
          <button type="submit" value="cancel" class="secondary-button">Cancel</button>
          <button id="publishAdoTestRun" type="button">Create Test Run</button>
        </div>
      </form>
    </dialog>
  `;

  trackerPanel.appendChild(section);

  const urlInput = section.querySelector('#assignmentWorkbookUrl');
  const testerInput = section.querySelector('#assignmentWorkbookTester');
  const updateButton = section.querySelector('#updateAssignmentFromAdo');
  const syncButton = section.querySelector('#syncResultsWithAdo');
  const status = section.querySelector('#assignmentWorkbookStatus');
  const importSummary = section.querySelector('#stagingImportSummary');
  const importCsvButton = section.querySelector('#importResultCsv');
  const importTxtButton = section.querySelector('#importResultTxt');
  const clearImportedButton = section.querySelector('#clearImportedResults');
  const csvFileInput = section.querySelector('#resultCsvFile');
  const txtFileInput = section.querySelector('#resultTxtFile');
  const pasteInput = section.querySelector('#testResultPaste');
  const applyPasteButton = section.querySelector('#applyPastedResults');
  const clearPasteButton = section.querySelector('#clearPastedResults');
  const previewPanel = section.querySelector('#stagingPreviewPanel');
  const previewSummary = section.querySelector('#stagingPreviewSummary');
  const previewNotice = section.querySelector('#stagingPreviewNotice');
  const previewBody = section.querySelector('#stagingPreviewRows');
  const publishSummary = section.querySelector('#stagingPublishSummary');
  const createRunButton = section.querySelector('#createAdoTestRun');
  const transferOteButton = section.querySelector('#transferAssignmentToOte');
  const allowDuplicate = section.querySelector('#allowDuplicateLogging');
  const oteFileInput = section.querySelector('#oteWorkbookFile');
  const runDialog = section.querySelector('#adoTestRunDialog');
  const runPreview = section.querySelector('#adoRunPreview');
  const runName = section.querySelector('#adoRunName');
  const runDialogStatus = section.querySelector('#adoRunDialogStatus');
  const publishRunButton = section.querySelector('#publishAdoTestRun');

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
    status.classList.toggle('ok', !error && Boolean(message));
  }

  function normalizeResult(value) {
    const text = String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
    if (!text) return '';
    if (['pass', 'passed'].includes(text)) return 'Passed';
    if (['fail', 'failed', 'false'].includes(text)) return 'Failed';
    if (text === 'blocked') return 'Blocked';
    if (['not run', 'notrun', 'not executed', 'notexecuted'].includes(text)) return 'Not Run';
    if (['n/a', 'na', 'not applicable'].includes(text)) return 'N/A';
    return '';
  }

  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const source = String(text || '').replace(/^\uFEFF/, '');
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char === '"') {
        if (quoted && source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === ',' && !quoted) {
        row.push(cell);
        cell = '';
      } else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && source[index + 1] === '\n') index += 1;
        row.push(cell);
        if (row.some((value) => value !== '')) rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += char;
      }
    }
    row.push(cell);
    if (row.some((value) => value !== '')) rows.push(row);
    return rows;
  }

  function parseResultCsv(text) {
    const rows = parseCsvRows(text);
    if (!rows.length) return [];
    const normalizeHeader = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const headers = rows[0].map(normalizeHeader);
    const idIndex = ['testid', 'testcaseid', 'id', 'vstsid'].map((name) => headers.indexOf(name)).find((index) => index >= 0);
    const resultIndex = ['result', 'outcome', 'status'].map((name) => headers.indexOf(name)).find((index) => index >= 0);
    if (idIndex == null || resultIndex == null) {
      throw new Error('CSV must contain a Test ID/TestCaseId column and a Result/Outcome column.');
    }
    return rows.slice(1).map((cells) => {
      const rawId = String(cells[idIndex] || '');
      const match = rawId.match(/VSTS\s*(\d+)|\b(\d+)\b/i);
      return {
        testCaseId: match ? String(match[1] || match[2]) : '',
        result: normalizeResult(cells[resultIndex]),
      };
    }).filter((item) => item.testCaseId && item.result);
  }

  function parseTestResultTxt(text) {
    const resultPattern = '(Passed|Pass|Failed|Fail|Blocked|Not\\s*Run|NotExecuted|N\\/A)';
    return String(text || '').split(/\r?\n/).map((line) => {
      let match = line.match(new RegExp('\\bVSTS\\s*(\\d+)\\b[^\\r\\n]*?\\b' + resultPattern + '\\b', 'i'));
      if (!match) {
        match = line.match(new RegExp('^\\s*(\\d{3,})\\b[^\\r\\n]*?\\b' + resultPattern + '\\b', 'i'));
      }
      return match ? { testCaseId: String(match[1]), result: normalizeResult(match[2]) } : null;
    }).filter(Boolean);
  }

  window.ResultStagingUtils = { normalizeResult, parseResultCsv, parseTestResultTxt };

  async function readJsonResponse(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || `Request failed: ${response.status}`);
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

  function plannerStatus(outcome) {
    const raw = String(outcome || '').trim();
    const value = raw.toLowerCase().replace(/[\\s_-]+/g, '');
    if (value === 'passed') return 'Passed';
    if (value === 'failed') return 'Failed';
    if (!value || ['active', 'notrun', 'notexecuted', 'unspecified', 'none'].includes(value)) return 'Active';
    if (value === 'notapplicable' || value === 'na') return 'N/A';
    return raw;
  }

  function testerMatches(pointTester, query) {
    const tester = String(pointTester || '').trim().toLowerCase();
    const wanted = String(query || '').trim().toLowerCase();
    if (!wanted) return true;
    return tester === wanted || tester.includes(wanted) || (tester && wanted.includes(tester));
  }

  function aggregateAdoStatus(current, incoming) {
    if (!current) return incoming;
    if (current === 'Failed' || incoming === 'Failed') return 'Failed';
    if (current === 'Passed' || incoming === 'Passed') return 'Passed';
    if (current !== 'Active') return current;
    return incoming;
  }

  function actionFor(importedResult, adoStatus) {
    if (importedResult !== 'Passed') return 'Need Analysis';
    if (!adoStatus || adoStatus === 'Not found') return 'Need Analysis';
    if (allowDuplicate.checked) return 'Passed';
    return adoStatus === 'Active' ? 'Passed' : 'Skipped';
  }

  function refreshImportControls() {
    const loaded = assignmentRows.length > 0;
    importCsvButton.disabled = !loaded;
    importTxtButton.disabled = !loaded;
    applyPasteButton.disabled = !loaded || !pasteInput.value.trim();
    clearImportedButton.disabled = importedResults.size === 0;
    syncButton.disabled = !loaded || importedResults.size === 0;
    importSummary.textContent = `${importedResults.size} imported · ${assignmentRows.length} ADO case(s) loaded`;
  }

  function markPreviewStale(message = 'Results changed. Sync with ADO again before publishing.') {
    previewFresh = false;
    createRunButton.disabled = true;
    transferOteButton.disabled = true;
    publishSummary.textContent = message;
    if (previewRows.length) {
      previewNotice.textContent = message;
      previewNotice.classList.add('warning');
    }
  }

  function applyImported(entries, sourceLabel) {
    if (!assignmentRows.length) {
      setStatus('Update from ADO before importing results.', true);
      return;
    }
    let matched = 0;
    let unmatched = 0;
    let duplicates = 0;
    for (const entry of entries) {
      const id = String(entry.testCaseId || '').trim();
      const result = normalizeResult(entry.result);
      if (!id || !result) continue;
      if (!assignmentById.has(id)) {
        unmatched += 1;
        continue;
      }
      if (importedResults.has(id)) duplicates += 1;
      importedResults.set(id, { testCaseId: id, result, source: sourceLabel });
      matched += 1;
    }
    refreshImportControls();
    markPreviewStale();
    setStatus(
      matched
        ? `${sourceLabel}: ${matched} result row(s) staged${duplicates ? ` · ${duplicates} existing staged result(s) replaced` : ''}${unmatched ? ` · ${unmatched} ID(s) not in the current assignment` : ''}. Sync with ADO to build the logging preview.`
        : `No matching result rows were found in ${sourceLabel}.`,
      matched === 0,
    );
  }

  function renderAssignmentSummary(message) {
    setStatus(message || `Loaded ${assignmentRows.length} assigned test case(s) from ADO.`);
    refreshImportControls();
  }

  async function updateFromAdo() {
    if (!urlInput.value.trim() || !testerInput.value.trim()) {
      setStatus('Test Plan URL and Assigned tester are required.', true);
      return;
    }
    updateButton.disabled = true;
    setStatus('Updating assigned test cases from ADO…');
    try {
      const response = await fetch('/api/test-plans/assignment-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.value.trim(), tester: testerInput.value.trim() }),
      });
      const data = await readJsonResponse(response);
      assignmentRows = Array.isArray(data.rows) ? data.rows : [];
      assignmentById = new Map(assignmentRows.map((row) => [String(row.testCaseId), row]));
      sessionMeta = {
        planId: data.planId,
        suiteId: data.suiteId,
        tester: data.matchedTester || testerInput.value.trim(),
      };
      if (data.matchedTester) testerInput.value = data.matchedTester;
      const removedImports = [...importedResults.keys()].filter((id) => !assignmentById.has(id));
      removedImports.forEach((id) => importedResults.delete(id));
      previewRows = [];
      previewBody.replaceChildren();
      previewPanel.hidden = true;
      markPreviewStale('Import results, then sync with ADO to generate the logging preview.');
      renderAssignmentSummary(
        `${data.message || `Loaded ${assignmentRows.length} assigned case(s).`}${removedImports.length ? ` ${removedImports.length} staged result(s) were removed because the case is no longer assigned.` : ''}`
      );
    } catch (error) {
      setStatus(error.message || 'Unable to update from ADO.', true);
    } finally {
      updateButton.disabled = false;
      refreshImportControls();
    }
  }

  function buildPreviewRows() {
    previewRows = assignmentRows
      .filter((row) => importedResults.has(String(row.testCaseId)))
      .map((row) => {
        const id = String(row.testCaseId);
        const imported = importedResults.get(id);
        const adoStatus = latestAdoByCase.get(id) || 'Not found';
        return {
          testCaseId: id,
          title: String(row.title || ''),
          importedResult: imported.result,
          latestAdoStatus: adoStatus,
          action: actionFor(imported.result, adoStatus),
          assignment: row,
        };
      });
  }

  function actionBadge(action) {
    const span = document.createElement('span');
    span.className = `staging-action-badge ${action.toLowerCase().replace(/\s+/g, '-')}`;
    span.textContent = action;
    return span;
  }

  function renderPreview() {
    const fragment = document.createDocumentFragment();
    for (const row of previewRows) {
      const tr = document.createElement('tr');
      [row.testCaseId, row.title, row.importedResult, row.latestAdoStatus].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });
      const actionCell = document.createElement('td');
      actionCell.appendChild(actionBadge(row.action));
      tr.appendChild(actionCell);
      fragment.appendChild(tr);
    }
    previewBody.replaceChildren(fragment);

    const passed = previewRows.filter((row) => row.action === 'Passed').length;
    const skipped = previewRows.filter((row) => row.action === 'Skipped').length;
    const analysis = previewRows.filter((row) => row.action === 'Need Analysis').length;
    previewSummary.textContent = `${previewRows.length} imported · ${passed} Passed · ${skipped} Skipped · ${analysis} Need Analysis`;
    previewNotice.classList.remove('warning');
    previewNotice.textContent = passed
      ? `Only the ${passed} row(s) marked Passed will be sent to ADO/OTE. Failed or other non-passing imports are held for analysis.`
      : 'Nothing is currently eligible to log.';
    previewPanel.hidden = false;
    previewFresh = true;
    createRunButton.disabled = passed === 0;
    transferOteButton.disabled = passed === 0;
    publishSummary.textContent = passed
      ? `${passed} result(s) ready to log.`
      : 'No results are currently eligible to log.';
  }

  async function syncWithAdo() {
    if (!assignmentRows.length || !importedResults.size) return;
    syncButton.disabled = true;
    setStatus('Syncing imported results with the latest ADO status…');
    try {
      const response = await fetch('/api/test-plans/read-suite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.value.trim() }),
      });
      const data = await readJsonResponse(response);
      const points = Array.isArray(data.testPoints) ? data.testPoints : [];
      const testerQuery = testerInput.value.trim();
      latestAdoByCase = new Map();
      for (const point of points) {
        if (testerQuery && !testerMatches(point.tester, testerQuery)) continue;
        const id = String(point.testCaseId ?? '').trim();
        if (!id) continue;
        const next = plannerStatus(point.outcome);
        latestAdoByCase.set(id, aggregateAdoStatus(latestAdoByCase.get(id), next));
      }
      buildPreviewRows();
      renderPreview();
      setStatus('ADO sync complete. Review the read-only preview before publishing.');
    } catch (error) {
      markPreviewStale('ADO sync failed. Publishing remains disabled until a successful sync.');
      setStatus(error.message || 'Unable to sync with ADO.', true);
    } finally {
      refreshImportControls();
    }
  }

  function rowsReadyToLog() {
    if (!previewFresh) return [];
    return previewRows
      .filter((row) => row.action === 'Passed')
      .map((row) => ({
        ...row.assignment,
        round1Results: 'Passed',
        round2Results: '',
        singleRunResults: '',
        manualRun: '',
        comment: '',
        solution: '',
        defects: '',
      }));
  }

  function suggestedRunName() {
    const tester = sessionMeta.tester || testerInput.value.trim() || 'Tester';
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '');
    return `Plan ${sessionMeta.planId || ''} Suite ${sessionMeta.suiteId || ''} - Imported Results - ${tester} - ${stamp}`.trim();
  }

  updateButton.addEventListener('click', updateFromAdo);
  syncButton.addEventListener('click', syncWithAdo);

  pasteInput.addEventListener('input', refreshImportControls);
  applyPasteButton.addEventListener('click', () => {
    try {
      applyImported(parseTestResultTxt(pasteInput.value), 'Pasted TXT');
    } catch (error) {
      setStatus(error.message || 'Unable to parse pasted results.', true);
    }
  });
  clearPasteButton.addEventListener('click', () => {
    pasteInput.value = '';
    refreshImportControls();
  });

  importCsvButton.addEventListener('click', () => csvFileInput.click());
  importTxtButton.addEventListener('click', () => txtFileInput.click());

  csvFileInput.addEventListener('change', async () => {
    const file = csvFileInput.files?.[0];
    if (!file) return;
    try {
      applyImported(parseResultCsv(await file.text()), `CSV ${file.name}`);
    } catch (error) {
      setStatus(error.message || 'Unable to import CSV results.', true);
    } finally {
      csvFileInput.value = '';
    }
  });

  txtFileInput.addEventListener('change', async () => {
    const file = txtFileInput.files?.[0];
    if (!file) return;
    try {
      applyImported(parseTestResultTxt(await file.text()), `TXT ${file.name}`);
    } catch (error) {
      setStatus(error.message || 'Unable to import TXT results.', true);
    } finally {
      txtFileInput.value = '';
    }
  });

  clearImportedButton.addEventListener('click', () => {
    if (!importedResults.size) return;
    if (!window.confirm('Clear all staged imported results?')) return;
    importedResults.clear();
    latestAdoByCase.clear();
    previewRows = [];
    previewBody.replaceChildren();
    previewPanel.hidden = true;
    markPreviewStale('Import results, then sync with ADO to generate the logging preview.');
    refreshImportControls();
    setStatus('All staged imported results were cleared.');
  });

  allowDuplicate.addEventListener('change', () => {
    if (!previewFresh) return;
    buildPreviewRows();
    renderPreview();
  });

  createRunButton.addEventListener('click', () => {
    const rows = rowsReadyToLog();
    if (!rows.length) return;
    runName.value = suggestedRunName();
    runPreview.textContent = `${rows.length} Passed case(s) are ready to publish. Skipped and Need Analysis rows will not be included.`;
    runDialogStatus.textContent = '';
    runDialogStatus.classList.remove('error');
    publishRunButton.disabled = false;
    if (typeof runDialog.showModal === 'function') runDialog.showModal();
    else runDialog.setAttribute('open', '');
  });

  publishRunButton.addEventListener('click', async () => {
    const rows = rowsReadyToLog();
    if (!rows.length) return;
    publishRunButton.disabled = true;
    runDialogStatus.textContent = 'Creating ADO Test Run…';
    try {
      const response = await fetch('/api/test-plans/publish-test-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: urlInput.value.trim(),
          resultKey: 'round1Results',
          runName: runName.value.trim(),
          rows,
          allowDuplicateLogging: Boolean(allowDuplicate.checked),
        }),
      });
      const data = await readJsonResponse(response);
      if (typeof runDialog.close === 'function') runDialog.close();
      else runDialog.removeAttribute('open');
      markPreviewStale('ADO results were published. Sync with ADO again before any further logging.');
      setStatus(data.message || `Created ADO Test Run ${data.runId}.`);
    } catch (error) {
      runDialogStatus.textContent = error.message || 'Unable to create the ADO Test Run.';
      runDialogStatus.classList.add('error');
    } finally {
      publishRunButton.disabled = false;
    }
  });

  transferOteButton.addEventListener('click', () => {
    if (!rowsReadyToLog().length) return;
    oteFileInput.click();
  });

  oteFileInput.addEventListener('change', async () => {
    const file = oteFileInput.files?.[0];
    if (!file) return;
    const rows = rowsReadyToLog();
    if (!rows.length) {
      oteFileInput.value = '';
      return;
    }
    transferOteButton.disabled = true;
    setStatus(`Transferring ${rows.length} Passed result(s) to OTE…`);
    try {
      const formData = new FormData();
      formData.append('oteFile', file);
      formData.append('url', urlInput.value.trim());
      formData.append('resultKey', 'round1Results');
      formData.append('rows', JSON.stringify(rows));
      formData.append('allowDuplicateLogging', String(Boolean(allowDuplicate.checked)));
      const response = await fetch('/api/test-plans/transfer-to-ote', { method: 'POST', body: formData });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Request failed: ${response.status}`);
      }
      const stem = file.name.replace(/\.xlsx$/i, '');
      downloadBlob(await response.blob(), `${stem}_Completed.xlsx`);
      const skipped = Number(response.headers.get('X-OTE-Skipped-Cases') || 0);
      setStatus(`OTE workbook generated from ${rows.length} staged Passed result(s)${skipped ? ` · ${skipped} case(s) were skipped by the final ADO duplicate check` : ''}.`);
    } catch (error) {
      setStatus(error.message || 'Unable to generate the OTE workbook.', true);
    } finally {
      oteFileInput.value = '';
      transferOteButton.disabled = !previewFresh || rowsReadyToLog().length === 0;
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
    if (primaryUrl.value.trim()) {
      inputs.forEach((input) => { if (input !== primaryUrl) input.value = primaryUrl.value.trim(); });
    }
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

  refreshImportControls();
  if (subTabs.length) activateResultSubtab(0);
})();
