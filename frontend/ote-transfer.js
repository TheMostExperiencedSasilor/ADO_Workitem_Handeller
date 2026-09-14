(() => {
  'use strict';

  if (window.__oteTransferInitialized) return;

  const RESULT_COLUMNS = {
    round1Results: { label: 'Round 1 results', cellIndex: 4 },
    round2Results: { label: 'Round 2 results', cellIndex: 5 },
    singleRunResults: { label: 'Single run results', cellIndex: 6 },
    manualRun: { label: 'Manual run', cellIndex: 7 },
  };

  function initialize() {
    const section = document.querySelector('#assignmentWorkbookSection');
    const rowsBody = document.querySelector('#assignmentWorkbookRows');
    const status = document.querySelector('#assignmentWorkbookStatus');
    const createRunButton = document.querySelector('#createAdoTestRun');
    const clearAllButton = document.querySelector('#clearAllAssignmentResults');
    if (!section || !rowsBody || !status || !createRunButton) return false;
    if (document.querySelector('#transferAssignmentToOte')) return true;

    window.__oteTransferInitialized = true;

    const transferButton = document.createElement('button');
    transferButton.id = 'transferAssignmentToOte';
    transferButton.type = 'button';
    transferButton.className = 'secondary-button';
    transferButton.textContent = 'Transfer to OTE';
    transferButton.disabled = true;
    if (clearAllButton) clearAllButton.insertAdjacentElement('beforebegin', transferButton);
    else createRunButton.insertAdjacentElement('afterend', transferButton);

    const fileInput = document.createElement('input');
    fileInput.id = 'assignmentOteFile';
    fileInput.type = 'file';
    fileInput.accept = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx';
    fileInput.hidden = true;
    section.appendChild(fileInput);

    const dialog = document.createElement('dialog');
    dialog.id = 'oteTransferDialog';
    dialog.className = 'ado-run-dialog';
    dialog.innerHTML = `
      <form method="dialog">
        <h3>Transfer to OTE</h3>
        <p>Compatibility option: choose a logged result column and an existing OTE workbook. A new <strong>_Completed.xlsx</strong> file is generated; the original file is not overwritten.</p>
        <label for="oteResultKey">Result source</label>
        <select id="oteResultKey">
          <option value="round1Results">Round 1 results</option>
          <option value="round2Results">Round 2 results</option>
          <option value="singleRunResults">Single run results</option>
          <option value="manualRun">Manual run</option>
        </select>
        <div id="oteTransferPreview" class="ado-run-preview"></div>
        <p id="oteTransferGuardPreview" class="mini-status" role="status" aria-live="polite"></p>
        <p id="oteTransferDialogStatus" class="mini-status" role="status" aria-live="polite"></p>
        <div class="action-row">
          <button type="submit" value="cancel" class="secondary-button">Cancel</button>
          <button id="chooseOteFile" type="button">Choose OTE File</button>
        </div>
      </form>`;
    section.appendChild(dialog);

    const resultKey = dialog.querySelector('#oteResultKey');
    const preview = dialog.querySelector('#oteTransferPreview');
    const dialogStatus = dialog.querySelector('#oteTransferDialogStatus');
    const chooseFileButton = dialog.querySelector('#chooseOteFile');

    function setStatus(message, error = false) {
      status.textContent = message;
      status.classList.toggle('error', error);
      status.classList.toggle('ok', !error && Boolean(message));
    }

    function collectRows(key) {
      const column = RESULT_COLUMNS[key];
      if (!column) return [];
      return [...rowsBody.rows].map((row) => {
        const testCaseId = Number(String(row.cells[0]?.textContent || '').trim());
        const control = row.cells[column.cellIndex]?.querySelector('select');
        return {
          testCaseId,
          [key]: String(control?.value || '').trim(),
        };
      }).filter((row) => Number.isInteger(row.testCaseId) && row.testCaseId > 0);
    }

    function updatePreview() {
      const key = resultKey.value;
      const rows = collectRows(key);
      const logged = rows.filter((row) => row[key]).length;
      preview.textContent = logged
        ? `${logged} Test Case(s) with ${RESULT_COLUMNS[key].label} will be written to matching OTE TestCaseId blocks.`
        : `No ${RESULT_COLUMNS[key].label} are currently logged.`;
      chooseFileButton.disabled = logged === 0;
      dialogStatus.textContent = '';
      dialogStatus.classList.remove('error');
    }

    function syncEnabled() {
      transferButton.disabled = rowsBody.rows.length === 0;
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

    transferButton.addEventListener('click', () => {
      updatePreview();
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    });

    resultKey.addEventListener('change', updatePreview);
    chooseFileButton.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      const key = resultKey.value;
      const rows = collectRows(key);
      const logged = rows.filter((row) => row[key]).length;
      if (!logged) {
        dialogStatus.textContent = `No ${RESULT_COLUMNS[key].label} are logged.`;
        dialogStatus.classList.add('error');
        fileInput.value = '';
        return;
      }

      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      transferButton.disabled = true;
      setStatus(`Transferring ${RESULT_COLUMNS[key].label} to OTE…`);

      try {
        const formData = new FormData();
        formData.append('oteFile', file);
        formData.append('resultKey', key);
        formData.append('rows', JSON.stringify(rows));
        formData.append('url', document.querySelector('#assignmentWorkbookUrl')?.value.trim() || '');
        formData.append(
          'allowDuplicateLogging',
          document.querySelector('#allowDuplicateLogging')?.checked ? 'true' : 'false'
        );
        const response = await fetch('/api/test-plans/transfer-to-ote', {
          method: 'POST',
          body: formData,
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `Request failed: ${response.status}`);
        }

        const updated = response.headers.get('X-OTE-Updated-Cases') || '?';
        const skipped = Number(response.headers.get('X-OTE-Skipped-Cases') || 0);
        const stem = file.name.replace(/\.xlsx$/i, '');
        const filename = `${stem}_Completed.xlsx`;
        downloadBlob(await response.blob(), filename);
        setStatus(
          `OTE completed: ${updated} Test Case(s) updated in ${filename}.`
          + (skipped ? ` ${skipped} case(s) skipped because their latest ADO status was not Active.` : '')
        );
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
        fileInput.value = '';
        syncEnabled();
      }
    });

    new MutationObserver(syncEnabled).observe(rowsBody, { childList: true });
    syncEnabled();
    return true;
  }

  let attempts = 0;
  const waitForTracker = () => {
    if (initialize()) return;
    attempts += 1;
    if (attempts < 100) setTimeout(waitForTracker, 100);
  };

  waitForTracker();
})();

(() => {
  'use strict';

  if (window.__duplicateLoggingGuardInitialized) return;

  function initializeGuard() {
    const section = document.querySelector('#assignmentWorkbookSection');
    const rowsBody = document.querySelector('#assignmentWorkbookRows');
    const readButton = document.querySelector('#previewAssignmentWorkbook');
    const status = document.querySelector('#assignmentWorkbookStatus');
    const urlInput = document.querySelector('#assignmentWorkbookUrl');
    const testerInput = document.querySelector('#assignmentWorkbookTester');
    const createRunButton = document.querySelector('#createAdoTestRun');
    const clearAllButton = document.querySelector('#clearAllAssignmentResults');
    if (!section || !rowsBody || !readButton || !status || !urlInput || !testerInput || !createRunButton) return false;
    if (document.querySelector('#allowDuplicateLogging')) return true;

    window.__duplicateLoggingGuardInitialized = true;

    const style = document.createElement('style');
    style.textContent = `
      .duplicate-logging-control { display:inline-flex; align-items:center; gap:7px; padding:0 4px; white-space:nowrap; }
      .duplicate-logging-control input { width:auto; margin:0; }
      .duplicate-logging-warning { color:#9a6700; }
    `;
    document.head.appendChild(style);

    const updateButton = document.createElement('button');
    updateButton.id = 'updateAssignmentFromAdo';
    updateButton.type = 'button';
    updateButton.className = 'secondary-button';
    updateButton.textContent = 'Update from ADO';
    updateButton.disabled = rowsBody.rows.length === 0;
    readButton.insertAdjacentElement('afterend', updateButton);

    const duplicateControl = document.createElement('label');
    duplicateControl.className = 'duplicate-logging-control';
    duplicateControl.title = 'When disabled, only results whose latest ADO status is Active are logged.';
    duplicateControl.innerHTML = '<input id="allowDuplicateLogging" type="checkbox"> <span>Allow duplicated logging</span>';
    const allowDuplicate = duplicateControl.querySelector('#allowDuplicateLogging');
    if (clearAllButton) clearAllButton.insertAdjacentElement('beforebegin', duplicateControl);
    else createRunButton.insertAdjacentElement('afterend', duplicateControl);

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.endsWith('/api/test-plans/publish-test-run') && typeof init.body === 'string') {
        try {
          const payload = JSON.parse(init.body);
          payload.allowDuplicateLogging = Boolean(allowDuplicate.checked);
          init = { ...init, body: JSON.stringify(payload) };
        } catch {
          // Keep the original request untouched if its body is not the expected JSON.
        }
      }
      return originalFetch(input, init);
    };

    const editableCellSnapshot = () => {
      const snapshot = new Map();
      [...rowsBody.rows].forEach((row) => {
        const id = String(row.cells[0]?.textContent || '').trim();
        if (!id) return;
        snapshot.set(id, [...row.cells].slice(4).map((cell) => cell.querySelector('select,input')?.value ?? ''));
      });
      return snapshot;
    };

    const waitForReadToFinish = async () => {
      const started = Date.now();
      while (!readButton.disabled && Date.now() - started < 1200) {
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      while (readButton.disabled && Date.now() - started < 45000) {
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    };

    const restoreSnapshot = (snapshot) => {
      let restored = 0;
      [...rowsBody.rows].forEach((row) => {
        const id = String(row.cells[0]?.textContent || '').trim();
        const values = snapshot.get(id);
        if (!values) return;
        [...row.cells].slice(4).forEach((cell, index) => {
          const control = cell.querySelector('select,input');
          if (!control || values[index] == null) return;
          control.value = values[index];
          control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
        });
        restored += 1;
      });
      return restored;
    };

    updateButton.addEventListener('click', async () => {
      if (!urlInput.value.trim() || !testerInput.value.trim()) {
        status.textContent = 'Test Plan URL and Assigned tester are required before Update from ADO.';
        status.classList.add('error');
        return;
      }
      const snapshot = editableCellSnapshot();
      const beforeIds = new Set(snapshot.keys());
      updateButton.disabled = true;
      status.textContent = 'Updating suite membership, case details and current ADO state…';
      readButton.click();
      await waitForReadToFinish();
      const afterIds = new Set([...rowsBody.rows].map((row) => String(row.cells[0]?.textContent || '').trim()).filter(Boolean));
      const added = [...afterIds].filter((id) => !beforeIds.has(id)).length;
      const removed = [...beforeIds].filter((id) => !afterIds.has(id)).length;
      const restored = restoreSnapshot(snapshot);
      status.classList.remove('error');
      status.classList.add('ok');
      status.textContent = `Updated from ADO: ${afterIds.size} current case(s), ${added} added, ${removed} removed, local results restored for ${restored} matching case(s).`;
      updateButton.disabled = rowsBody.rows.length === 0;
    });

    const collectLoggedRows = (resultKey, cellIndex) => [...rowsBody.rows].map((row) => ({
      testCaseId: Number(String(row.cells[0]?.textContent || '').trim()),
      [resultKey]: String(row.cells[cellIndex]?.querySelector('select')?.value || '').trim(),
    })).filter((row) => Number.isInteger(row.testCaseId) && row.testCaseId > 0 && row[resultKey]);

    const refreshEligibility = async (mode) => {
      const isAdo = mode === 'ado';
      const resultSelect = document.querySelector(isAdo ? '#adoRunResultKey' : '#oteResultKey');
      const preview = document.querySelector(isAdo ? '#adoRunPreview' : '#oteTransferGuardPreview');
      if (!resultSelect || !preview) return;
      if (allowDuplicate.checked) {
        preview.textContent = 'Duplicate protection is disabled: completed ADO cases may be logged again.';
        preview.classList.add('duplicate-logging-warning');
        return;
      }
      preview.classList.remove('duplicate-logging-warning');
      const key = resultSelect.value;
      const cellIndex = { round1Results: 4, round2Results: 5, singleRunResults: 6, manualRun: 7 }[key];
      const rows = collectLoggedRows(key, cellIndex);
      if (!rows.length) return;
      const existingText = isAdo ? preview.textContent : '';
      if (!isAdo) preview.textContent = 'Checking latest ADO status…';
      try {
        const response = await originalFetch('/api/test-plans/logging-eligibility', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: urlInput.value.trim(),
            rows,
            resultKey: key,
            mode,
            allowDuplicateLogging: false,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
        const eligible = Array.isArray(data.eligibleCaseIds) ? data.eligibleCaseIds.length : 0;
        const skipped = Number(data.skippedCases || 0);
        const guardText = `Latest ADO check: ${eligible} case(s) eligible${skipped ? ` · ${skipped} case(s) fully/partly skipped because status is not Active` : ' · no duplicates detected'}.`;
        preview.textContent = isAdo && existingText ? `${existingText} ${guardText}` : guardText;
      } catch (error) {
        const message = `Could not refresh duplicate check: ${error.message || 'ADO unavailable'}`;
        preview.textContent = isAdo && existingText ? `${existingText} ${message}` : message;
        preview.classList.add('error');
      }
    };

    createRunButton.addEventListener('click', () => setTimeout(() => refreshEligibility('ado'), 0));
    document.querySelector('#adoRunResultKey')?.addEventListener('change', () => setTimeout(() => refreshEligibility('ado'), 0));

    const attachOteListeners = () => {
      const transferButton = document.querySelector('#transferAssignmentToOte');
      const resultSelect = document.querySelector('#oteResultKey');
      if (!transferButton || !resultSelect || transferButton.dataset.guardReady) return false;
      transferButton.dataset.guardReady = '1';
      transferButton.addEventListener('click', () => setTimeout(() => refreshEligibility('ote'), 0));
      resultSelect.addEventListener('change', () => setTimeout(() => refreshEligibility('ote'), 0));
      return true;
    };
    if (!attachOteListeners()) {
      const timer = setInterval(() => { if (attachOteListeners()) clearInterval(timer); }, 100);
      setTimeout(() => clearInterval(timer), 10000);
    }

    allowDuplicate.addEventListener('change', () => {
      if (document.querySelector('#adoTestRunDialog')?.open) refreshEligibility('ado');
      if (document.querySelector('#oteTransferDialog')?.open) refreshEligibility('ote');
    });

    const syncUpdateEnabled = () => { updateButton.disabled = rowsBody.rows.length === 0; };
    new MutationObserver(syncUpdateEnabled).observe(rowsBody, { childList: true });
    syncUpdateEnabled();
    return true;
  }

  let guardAttempts = 0;
  const waitForGuard = () => {
    if (initializeGuard()) return;
    guardAttempts += 1;
    if (guardAttempts < 100) setTimeout(waitForGuard, 100);
  };
  waitForGuard();
})();
