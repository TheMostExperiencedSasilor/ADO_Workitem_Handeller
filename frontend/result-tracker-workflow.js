(() => {
  'use strict';

  if (window.__resultTrackerWorkflowInitialized) return;

  const RESULT_COLUMNS = [
    { key: 'round1Results', label: 'Round 1 results', cellIndex: 4 },
    { key: 'round2Results', label: 'Round 2 results', cellIndex: 5 },
    { key: 'singleRunResults', label: 'Single run results', cellIndex: 6 },
    { key: 'manualRun', label: 'Manual run', cellIndex: 7 },
  ];

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function initialize() {
    const section = document.querySelector('#assignmentWorkbookSection');
    const rowsBody = document.querySelector('#assignmentWorkbookRows');
    const table = document.querySelector('.assignment-preview-table');
    const originalReadButton = document.querySelector('#previewAssignmentWorkbook');
    const updateButton = document.querySelector('#updateAssignmentFromAdo');
    const saveButton = document.querySelector('#saveAssignmentJson');
    const openButton = document.querySelector('#openAssignmentJson');
    const exportButton = document.querySelector('#exportAssignmentWorkbook');
    const createRunButton = document.querySelector('#createAdoTestRun');
    const transferButton = document.querySelector('#transferAssignmentToOte');
    const allowDuplicate = document.querySelector('#allowDuplicateLogging');
    const clearAllButton = document.querySelector('#clearAllAssignmentResults');
    const status = document.querySelector('#assignmentWorkbookStatus');
    const importHost = document.querySelector('.assignment-import-row');

    if (!section || !rowsBody || !table || !originalReadButton || !updateButton || !saveButton ||
        !openButton || !exportButton || !createRunButton || !transferButton || !allowDuplicate ||
        !clearAllButton || !status || !importHost) return false;
    if (document.querySelector('#resultTrackerWorkflowToolbar')) return true;

    window.__resultTrackerWorkflowInitialized = true;

    const oldActionRow = originalReadButton.closest('.action-row');
    if (!oldActionRow) return false;

    const toolbar = document.createElement('div');
    toolbar.id = 'resultTrackerWorkflowToolbar';
    toolbar.className = 'result-tracker-workflow-toolbar';

    const visibleUpdateButton = document.createElement('button');
    visibleUpdateButton.id = 'resultTrackerUpdateFromAdo';
    visibleUpdateButton.type = 'button';
    visibleUpdateButton.textContent = 'Update from ADO';
    toolbar.appendChild(visibleUpdateButton);

    const workMenu = document.createElement('details');
    workMenu.className = 'result-tracker-action-menu';
    workMenu.innerHTML = '<summary class="secondary-button">Work <span aria-hidden="true">▾</span></summary><div class="result-tracker-menu-panel"></div>';
    const workMenuPanel = workMenu.querySelector('.result-tracker-menu-panel');
    const saveProxy = document.createElement('button');
    saveProxy.type = 'button';
    saveProxy.className = 'secondary-button';
    saveProxy.textContent = 'Save Work';
    const openProxy = document.createElement('button');
    openProxy.type = 'button';
    openProxy.className = 'secondary-button';
    openProxy.textContent = 'Open Work';
    workMenuPanel.append(saveProxy, openProxy);
    toolbar.appendChild(workMenu);

    toolbar.appendChild(exportButton);

    const loggingMenu = document.createElement('details');
    loggingMenu.className = 'result-tracker-action-menu result-tracker-logging-menu';
    loggingMenu.innerHTML = '<summary class="secondary-button">Result Logging <span aria-hidden="true">▾</span></summary><div class="result-tracker-menu-panel"></div>';
    const loggingPanel = loggingMenu.querySelector('.result-tracker-menu-panel');
    loggingPanel.append(createRunButton, transferButton);
    const duplicateLabel = allowDuplicate.closest('label');
    if (duplicateLabel) {
      duplicateLabel.classList.add('result-tracker-menu-checkbox');
      loggingPanel.appendChild(duplicateLabel);
    }
    toolbar.appendChild(loggingMenu);

    oldActionRow.insertAdjacentElement('beforebegin', toolbar);
    originalReadButton.hidden = true;
    updateButton.hidden = true;
    saveButton.hidden = true;
    openButton.hidden = true;
    oldActionRow.hidden = true;

    const importFooter = document.createElement('div');
    importFooter.className = 'result-tracker-import-footer';
    const lockLabel = document.createElement('label');
    lockLabel.className = 'result-lock-control';
    lockLabel.innerHTML = '<input id="lockResultsAfterPassed" type="checkbox" checked> <span>Lock results after Passed</span>';
    const lockToggle = lockLabel.querySelector('#lockResultsAfterPassed');
    const lockSummary = document.createElement('span');
    lockSummary.id = 'resultLockSummary';
    lockSummary.className = 'mini-status';
    importFooter.append(lockLabel, lockSummary, clearAllButton);
    importHost.appendChild(importFooter);

    const closeMenus = (except) => {
      [workMenu, loggingMenu].forEach((menu) => {
        if (menu !== except) menu.open = false;
      });
    };
    workMenu.addEventListener('toggle', () => { if (workMenu.open) closeMenus(workMenu); });
    loggingMenu.addEventListener('toggle', () => { if (loggingMenu.open) closeMenus(loggingMenu); });
    document.addEventListener('click', (event) => {
      if (!toolbar.contains(event.target)) closeMenus(null);
    });

    saveProxy.addEventListener('click', () => { workMenu.open = false; saveButton.click(); });
    openProxy.addEventListener('click', () => { workMenu.open = false; openButton.click(); });

    // Only observe the original controls. Observing the whole section caused the
    // observer to see its own proxy-button `disabled` writes and continuously
    // retrigger itself, starving the browser event loop and freezing the page.
    const setDisabledIfChanged = (control, disabled) => {
      const next = Boolean(disabled);
      if (control.disabled !== next) control.disabled = next;
    };
    const syncProxyStates = () => {
      setDisabledIfChanged(saveProxy, saveButton.disabled);
      setDisabledIfChanged(openProxy, openButton.disabled);
      setDisabledIfChanged(
        visibleUpdateButton,
        rowsBody.rows.length
          ? (originalReadButton.disabled || updateButton.disabled)
          : originalReadButton.disabled,
      );
    };
    const proxyStateObserver = new MutationObserver(syncProxyStates);
    [originalReadButton, updateButton, saveButton, openButton].forEach((control) => {
      proxyStateObserver.observe(control, {
        attributes: true,
        attributeFilter: ['disabled'],
      });
    });
    syncProxyStates();

    async function runUpdateFromAdo() {
      visibleUpdateButton.disabled = true;
      try {
        if (rowsBody.rows.length === 0) {
          originalReadButton.click();
        } else {
          updateButton.click();
        }
        const started = Date.now();
        while (Date.now() - started < 45000) {
          await wait(80);
          if (!originalReadButton.disabled && !updateButton.disabled) break;
        }
      } finally {
        syncProxyStates();
      }
    }
    visibleUpdateButton.addEventListener('click', runUpdateFromAdo);

    function getResultSelects(row) {
      return RESULT_COLUMNS.map(({ cellIndex }) => row.cells[cellIndex]?.querySelector('select'));
    }

    function setLocked(select, locked, firstPassedLabel = '') {
      if (!select) return;
      if (locked) {
        if (select.dataset.lockedByResultChecker !== '1') {
          select.dataset.lockedValue = select.value;
        }
        select.dataset.lockedByResultChecker = '1';
        if (!select.disabled) select.disabled = true;
        select.closest('td')?.classList.add('result-cell-locked');
        select.title = `Locked because ${firstPassedLabel} is Passed.`;
      } else if (select.dataset.lockedByResultChecker === '1') {
        delete select.dataset.lockedByResultChecker;
        delete select.dataset.lockedValue;
        if (select.disabled) select.disabled = false;
        select.closest('td')?.classList.remove('result-cell-locked');
        select.removeAttribute('title');
      }
    }

    function refreshLocks() {
      let lockedCount = 0;
      let passedRows = 0;
      [...rowsBody.rows].forEach((row) => {
        const selects = getResultSelects(row);
        const firstPassedIndex = selects.findIndex((select) => select?.value === 'Passed');
        if (firstPassedIndex >= 0) passedRows += 1;
        selects.forEach((select, index) => {
          const locked = Boolean(lockToggle.checked && firstPassedIndex >= 0 && index > firstPassedIndex);
          setLocked(select, locked, firstPassedIndex >= 0 ? RESULT_COLUMNS[firstPassedIndex].label : '');
          if (locked) lockedCount += 1;
        });
      });
      lockSummary.textContent = lockToggle.checked
        ? `${passedRows} case(s) have Passed · ${lockedCount} later result cell(s) locked`
        : 'Result locking is disabled.';
    }

    section.addEventListener('change', (event) => {
      const select = event.target.closest?.('#assignmentWorkbookRows .tracking-result-select');
      if (!select) return;
      if (select.dataset.lockedByResultChecker === '1') {
        const previous = select.dataset.lockedValue ?? '';
        if (select.value !== previous) select.value = previous;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      requestAnimationFrame(refreshLocks);
    }, true);

    lockToggle.addEventListener('change', refreshLocks);
    new MutationObserver(() => requestAnimationFrame(refreshLocks)).observe(rowsBody, { childList: true });

    const headers = [...table.tHead.rows[0].cells];
    RESULT_COLUMNS.forEach((column) => {
      const header = headers[column.cellIndex];
      const resultHeader = header?.querySelector('.result-header');
      if (!resultHeader || resultHeader.querySelector('.fill-result-column')) return;
      const fill = document.createElement('select');
      fill.className = 'fill-result-column';
      fill.setAttribute('aria-label', `Fill blank ${column.label}`);
      fill.innerHTML = '<option value="">Fill ▾</option><option value="Passed">Passed</option><option value="Failed">Failed</option>';
      resultHeader.appendChild(fill);
      fill.addEventListener('change', () => {
        const value = fill.value;
        fill.value = '';
        if (!value) return;
        const candidates = [...rowsBody.rows]
          .map((row) => row.cells[column.cellIndex]?.querySelector('select'))
          .filter((select) => select && !select.value && !select.disabled);
        const lockedBlanks = [...rowsBody.rows]
          .map((row) => row.cells[column.cellIndex]?.querySelector('select'))
          .filter((select) => select && !select.value && select.dataset.lockedByResultChecker === '1').length;
        if (!candidates.length) {
          status.textContent = `No editable blank ${column.label} cells to fill${lockedBlanks ? ` · ${lockedBlanks} locked blank cell(s) skipped` : ''}.`;
          return;
        }
        if (!window.confirm(`Fill ${candidates.length} blank ${column.label} cell(s) with ${value}? Existing and locked results will not be changed.`)) return;
        candidates.forEach((select) => {
          select.value = value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        refreshLocks();
        status.textContent = `Filled ${candidates.length} blank ${column.label} cell(s) with ${value}${lockedBlanks ? ` · ${lockedBlanks} locked blank cell(s) skipped` : ''}. Unsaved changes.`;
      });
    });

    const protectedImportButtons = [
      document.querySelector('#applyPastedResults'),
      document.querySelector('#resultCsvFile'),
    ].filter(Boolean);

    function lockedSnapshot() {
      return [...rowsBody.querySelectorAll('select[data-locked-by-result-checker="1"]')]
        .map((select) => ({ select, value: select.value }));
    }

    function restoreLockedSnapshot(snapshot) {
      let restored = 0;
      snapshot.forEach(({ select, value }) => {
        if (select.value !== value) {
          select.value = value;
          restored += 1;
        }
      });
      refreshLocks();
      if (restored) {
        setTimeout(() => {
          status.textContent = `${status.textContent} · ${restored} locked cell(s) skipped.`;
        }, 0);
      }
    }

    protectedImportButtons.forEach((control) => {
      const eventName = control.tagName === 'INPUT' && control.type === 'file' ? 'change' : 'click';
      control.addEventListener(eventName, () => {
        const snapshot = lockedSnapshot();
        setTimeout(() => restoreLockedSnapshot(snapshot), 50);
      }, true);
    });

    const gridPasteGuard = (event) => {
      if (!lockToggle.checked || !event.clipboardData) return;
      const active = document.activeElement?.closest?.('#assignmentWorkbookRows td');
      if (!active) return;
      const row = active.parentElement;
      const startColumn = active.cellIndex;
      if (startColumn < 4 || startColumn > 7) return;
      const text = event.clipboardData.getData('text/plain');
      if (!text) return;
      const matrix = text.replace(/\r/g, '').split('\n').map((line) => line.split('\t'));
      let lockedTargets = 0;
      matrix.forEach((values, rowOffset) => {
        const targetRow = rowsBody.rows[row.rowIndex - 1 + rowOffset];
        values.forEach((_, columnOffset) => {
          const select = targetRow?.cells[startColumn + columnOffset]?.querySelector('select');
          if (select?.dataset.lockedByResultChecker === '1') lockedTargets += 1;
        });
      });
      if (lockedTargets) {
        setTimeout(() => {
          status.textContent = `${status.textContent} · ${lockedTargets} locked cell(s) skipped.`;
        }, 0);
      }
    };
    section.addEventListener('paste', gridPasteGuard, true);

    requestAnimationFrame(refreshLocks);
    return true;
  }

  let attempts = 0;
  const start = () => {
    if (initialize()) return;
    attempts += 1;
    if (attempts < 150) setTimeout(start, 100);
  };
  start();
})();
