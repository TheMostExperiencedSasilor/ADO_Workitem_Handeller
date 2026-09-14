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
        const response = await fetch('/api/test-plans/transfer-to-ote', {
          method: 'POST',
          body: formData,
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `Request failed: ${response.status}`);
        }

        const updated = response.headers.get('X-OTE-Updated-Cases') || '?';
        const stem = file.name.replace(/\.xlsx$/i, '');
        const filename = `${stem}_Completed.xlsx`;
        downloadBlob(await response.blob(), filename);
        setStatus(`OTE completed: ${updated} Test Case(s) updated in ${filename}.`);
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
