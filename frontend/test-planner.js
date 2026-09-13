(() => {
  'use strict';

  if (window.__testPlannerInitialized) return;
  window.__testPlannerInitialized = true;

  const CONFIG = {
    project: 'AspenHYSYS',
    namespace: 'TestCases',
    productClass: 'ProductTestCase',
    sampleClass: 'ClassSampleTest',
    solutionValue: null,
    outputFileName: 'Playlist.playlist',
  };

  const state = {
    planId: null,
    suiteId: null,
    rows: [],
    visibleRows: [],
    selectedIds: new Set(),
    selectionMode: false,
    generatedPlaylist: '',
    generatedMeta: null,
    rowHeights: new Map(),
    columnWidths: [145, 560, 155, 230, 240],
  };

  const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

  const requestJson = async (path, options = {}) => {
    const response = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || data.message || `Request failed: ${response.status}`);
    }
    return data;
  };

  const escapeXmlValue = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const testMethodName = (id) => {
    const text = String(id ?? '').trim();
    return /^VSTS[A-Za-z0-9]+$/i.test(text) ? text : `VSTS${text.replace(/\D/g, '')}`;
  };

  const isSampleTitle = (title) => /samples/i.test(String(title || ''));

  const plannerStatus = (outcome) => {
    const value = String(outcome || '').trim().toLowerCase();
    if (value === 'passed') return 'Passed';
    if (value === 'failed') return 'Failed';
    return 'Active';
  };

  const productAreaFromFields = (fields) => {
    const aliases = new Set(['productarea']);
    for (const [referenceName, value] of Object.entries(fields || {})) {
      const tail = referenceName.split('.').pop() || referenceName;
      const normalizedTail = normalize(tail);
      const normalizedFull = normalize(referenceName);
      if (!aliases.has(normalizedTail) && ![...aliases].some((alias) => normalizedFull.includes(alias))) continue;
      if (value == null) return '';
      if (typeof value === 'object') return String(value.displayName || value.name || value.value || '');
      return String(value);
    }
    return '';
  };

  const buildTestRule = (methodName, className, indent) => {
    const fqn = `${CONFIG.namespace}.${className}.${methodName}`;
    return [
      `${indent}<Rule Match="All">`,
      `${indent}  <Property Name="TestWithNormalizedFullyQualifiedName" Value="${escapeXmlValue(fqn)}" />`,
      `${indent}  <Rule Match="Any">`,
      `${indent}    <Property Name="DisplayName" Value="${escapeXmlValue(methodName)}" />`,
      `${indent}  </Rule>`,
      `${indent}</Rule>`,
    ];
  };

  const buildClassRule = (items, className, indent) => {
    const lines = [
      `${indent}<Rule Match="All">`,
      `${indent}  <Property Name="Class" Value="${escapeXmlValue(className)}" />`,
      `${indent}  <Rule Match="Any">`,
    ];
    items.forEach((item) => lines.push(...buildTestRule(item.methodName, className, `${indent}    `)));
    lines.push(`${indent}  </Rule>`, `${indent}</Rule>`);
    return lines;
  };

  const buildUftPlaylistXml = (rows) => {
    const unique = new Map();
    rows.forEach((row) => {
      const methodName = testMethodName(row.testCaseId);
      if (!methodName || methodName === 'VSTS') return;
      if (!unique.has(methodName.toLowerCase())) {
        unique.set(methodName.toLowerCase(), {
          ...row,
          methodName,
          sample: isSampleTitle(row.title),
        });
      }
    });

    const items = [...unique.values()];
    const normal = items.filter((item) => !item.sample);
    const samples = items.filter((item) => item.sample);
    const lines = [
      '<Playlist Version="2.0">',
      '  <Rule Name="Includes" Match="Any">',
      '    <Rule Match="All">',
    ];

    if (CONFIG.solutionValue) {
      lines.push(`      <Property Name="Solution" Value="${escapeXmlValue(CONFIG.solutionValue)}" />`);
    } else {
      lines.push('      <Property Name="Solution" />');
    }

    lines.push(
      '      <Rule Match="Any">',
      '        <Rule Match="All">',
      `          <Property Name="Project" Value="${escapeXmlValue(CONFIG.project)}" />`,
      '          <Rule Match="Any">',
      '            <Rule Match="All">',
      `              <Property Name="Namespace" Value="${escapeXmlValue(CONFIG.namespace)}" />`,
      '              <Rule Match="Any">',
    );

    if (normal.length) lines.push(...buildClassRule(normal, CONFIG.productClass, '                '));
    if (samples.length) lines.push(...buildClassRule(samples, CONFIG.sampleClass, '                '));

    lines.push(
      '              </Rule>',
      '            </Rule>',
      '          </Rule>',
      '        </Rule>',
      '      </Rule>',
      '    </Rule>',
      '  </Rule>',
      '</Playlist>',
    );

    return {
      xml: lines.join('\r\n') + '\r\n',
      total: items.length,
      normal: normal.length,
      samples: samples.length,
    };
  };

  const buildPanel = () => {
    const tab = document.querySelector('#testResultsSummaryTab');
    const panel = document.querySelector('#testResultsSummaryPanel');
    if (!tab || !panel) return false;

    tab.textContent = 'Test Planner';
    panel.innerHTML = `
      <div class="test-planner-heading">
        <div>
          <h2>Test Planner</h2>
          <p>Load an Azure DevOps test suite, review the Execute-page data, select test cases, and generate a UFT playlist.</p>
        </div>
        <span class="mini-status">Planning workspace</span>
      </div>

      <form id="plannerSuiteForm" class="planner-suite-form">
        <label for="plannerTestPlanUrl">Azure DevOps Test Plan URL</label>
        <input id="plannerTestPlanUrl" type="text"
               placeholder="https://dev.azure.com/.../_testPlans/execute?planId=83602&amp;suiteId=106867 (Define, Execute or Charts)" required>
        <button id="plannerLoadSuiteButton" type="submit">Load Test Suite</button>
      </form>
      <p id="plannerSuiteStatus" class="mini-status" role="status" aria-live="polite">Paste a suite URL to load planning data from ADO.</p>

      <div id="plannerResults" hidden>
        <div id="plannerSummary" class="test-suite-summary"></div>

        <div class="planner-action-row">
          <button id="plannerSelectModeButton" type="button" class="secondary-button" aria-pressed="false">Select Test Cases</button>
          <button id="plannerSelectAllButton" type="button" class="secondary-button" disabled>Select All</button>
          <button id="plannerUnselectAllButton" type="button" class="secondary-button" disabled>Unselect All</button>
          <button id="plannerGeneratePlaylistButton" type="button" disabled>Generate UFT Playlist</button>
          <span id="plannerSelectedCount" class="planner-selected-count">0 selected</span>
        </div>

        <div id="playlistProgressPanel" class="playlist-progress-panel" hidden>
          <div class="playlist-progress-heading">
            <strong>Generating UFT playlist</strong>
            <span id="playlistProgressText">0%</span>
          </div>
          <progress id="playlistProgress" max="100" value="0"></progress>
        </div>

        <div id="playlistReadyPanel" class="playlist-ready-panel" hidden>
          <span id="playlistReadyMessage"></span>
          <button id="openPlaylistPreviewButton" type="button" class="secondary-button">Open Preview</button>
        </div>

        <div class="planner-table-tools">
          <span id="plannerFilterStatus" class="mini-status" role="status"></span>
          <div>
            <button id="plannerClearFiltersButton" type="button" class="secondary-button">Clear Filters</button>
            <button id="plannerResetSizesButton" type="button" class="secondary-button">Reset Table Size</button>
          </div>
        </div>

        <p class="mini-status planner-hint">Filters are directly beneath each header. Drag header edges to resize columns and row bottoms to resize rows. Select All / Unselect All apply to the currently filtered rows.</p>

        <div class="test-suite-table-wrap planner-table-wrap" tabindex="0" role="region" aria-label="Test planner table">
          <table id="plannerTable" class="test-suite-table planner-table">
            <caption>Current Execute-page test planning data</caption>
            <colgroup id="plannerColumns">
              <col class="planner-selection-col"><col><col><col><col><col>
            </colgroup>
            <thead>
              <tr class="planner-header-row">
                <th class="planner-selection-cell" scope="col" aria-label="Select"></th>
                <th scope="col" data-planner-column="0" data-label="Test Case ID">Test Case ID</th>
                <th scope="col" data-planner-column="1" data-label="Title">Title</th>
                <th scope="col" data-planner-column="2" data-label="Status">Status</th>
                <th scope="col" data-planner-column="3" data-label="Product Area">Product Area</th>
                <th scope="col" data-planner-column="4" data-label="Current Tester">Current Tester</th>
              </tr>
              <tr class="planner-filter-row">
                <th class="planner-selection-cell"></th>
                <th><input id="plannerFilterId" type="search" aria-label="Filter Test Case ID" placeholder="Filter ID"></th>
                <th><input id="plannerFilterTitle" type="search" aria-label="Filter Title" placeholder="Filter title"></th>
                <th><select id="plannerFilterStatus" aria-label="Filter Status"><option value="">All statuses</option><option>Passed</option><option>Active</option><option>Failed</option></select></th>
                <th><input id="plannerFilterProductArea" type="search" aria-label="Filter Product Area" placeholder="Filter product area"></th>
                <th><input id="plannerFilterTester" type="search" aria-label="Filter Current Tester" placeholder="Filter tester"></th>
              </tr>
            </thead>
            <tbody id="plannerRows"></tbody>
          </table>
        </div>
      </div>

      <dialog id="playlistPreviewDialog" class="playlist-preview-dialog">
        <form method="dialog" class="playlist-preview-card">
          <div class="playlist-preview-heading">
            <div>
              <h3>UFT Playlist Preview</h3>
              <p id="playlistPreviewMeta" class="mini-status"></p>
            </div>
            <button id="closePlaylistPreviewButton" type="submit" value="cancel" class="secondary-button">Close</button>
          </div>
          <pre id="playlistPreviewText" class="playlist-preview-text" tabindex="0"></pre>
          <div class="playlist-preview-actions">
            <button id="exportPlaylistButton" type="button">Export Playlist</button>
            <span id="playlistExportStatus" class="mini-status" role="status" aria-live="polite"></span>
          </div>
        </form>
      </dialog>
    `;
    return true;
  };

  if (!buildPanel()) return;

  const elements = {
    form: document.querySelector('#plannerSuiteForm'),
    url: document.querySelector('#plannerTestPlanUrl'),
    load: document.querySelector('#plannerLoadSuiteButton'),
    status: document.querySelector('#plannerSuiteStatus'),
    results: document.querySelector('#plannerResults'),
    summary: document.querySelector('#plannerSummary'),
    table: document.querySelector('#plannerTable'),
    columns: document.querySelector('#plannerColumns'),
    body: document.querySelector('#plannerRows'),
    filterStatus: document.querySelector('#plannerFilterStatus'),
    selectedCount: document.querySelector('#plannerSelectedCount'),
    selectMode: document.querySelector('#plannerSelectModeButton'),
    selectAll: document.querySelector('#plannerSelectAllButton'),
    unselectAll: document.querySelector('#plannerUnselectAllButton'),
    generate: document.querySelector('#plannerGeneratePlaylistButton'),
    progressPanel: document.querySelector('#playlistProgressPanel'),
    progress: document.querySelector('#playlistProgress'),
    progressText: document.querySelector('#playlistProgressText'),
    readyPanel: document.querySelector('#playlistReadyPanel'),
    readyMessage: document.querySelector('#playlistReadyMessage'),
    openPreview: document.querySelector('#openPlaylistPreviewButton'),
    preview: document.querySelector('#playlistPreviewDialog'),
    previewText: document.querySelector('#playlistPreviewText'),
    previewMeta: document.querySelector('#playlistPreviewMeta'),
    exportButton: document.querySelector('#exportPlaylistButton'),
    exportStatus: document.querySelector('#playlistExportStatus'),
  };

  const filters = {
    id: document.querySelector('#plannerFilterId'),
    title: document.querySelector('#plannerFilterTitle'),
    status: document.querySelector('#plannerFilterStatus'),
    productArea: document.querySelector('#plannerFilterProductArea'),
    tester: document.querySelector('#plannerFilterTester'),
  };

  const setStatus = (message, error = false) => {
    elements.status.textContent = message;
    elements.status.classList.toggle('error', error);
  };

  const applyColumnWidths = () => {
    const cols = [...elements.columns.children];
    cols[0].style.width = state.selectionMode ? '46px' : '0px';
    state.columnWidths.forEach((width, index) => { cols[index + 1].style.width = `${width}px`; });
    elements.table.style.width = `${state.columnWidths.reduce((sum, width) => sum + width, 0) + (state.selectionMode ? 46 : 0)}px`;
  };

  const makeResizeHandle = (axis, label, getSize, setSize, minimum) => {
    const handle = document.createElement('span');
    handle.className = `test-resize-handle ${axis}`;
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-label', label);
    handle.setAttribute('aria-orientation', axis === 'column' ? 'vertical' : 'horizontal');
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const start = axis === 'column' ? event.clientX : event.clientY;
      const initial = getSize();
      handle.setPointerCapture(event.pointerId);
      const move = (next) => setSize(Math.max(minimum, initial + (axis === 'column' ? next.clientX : next.clientY) - start));
      const stop = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', stop);
        handle.removeEventListener('pointercancel', stop);
        handle.removeEventListener('lostpointercapture', stop);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
      handle.addEventListener('lostpointercapture', stop);
    });
    handle.addEventListener('keydown', (event) => {
      const decrease = axis === 'column' ? 'ArrowLeft' : 'ArrowUp';
      const increase = axis === 'column' ? 'ArrowRight' : 'ArrowDown';
      if (![decrease, increase].includes(event.key)) return;
      event.preventDefault();
      setSize(Math.max(minimum, getSize() + (event.key === increase ? 10 : -10)));
    });
    return handle;
  };

  document.querySelectorAll('[data-planner-column]').forEach((header) => {
    const index = Number(header.dataset.plannerColumn);
    header.appendChild(makeResizeHandle(
      'column',
      `Resize ${header.dataset.label} column`,
      () => state.columnWidths[index],
      (size) => { state.columnWidths[index] = size; applyColumnWidths(); },
      80,
    ));
  });

  const updateSelectionControls = () => {
    elements.table.classList.toggle('selection-mode', state.selectionMode);
    elements.selectMode.setAttribute('aria-pressed', String(state.selectionMode));
    elements.selectMode.classList.toggle('planner-selection-active', state.selectionMode);
    elements.selectAll.disabled = !state.selectionMode || state.visibleRows.length === 0;
    elements.unselectAll.disabled = !state.selectionMode || state.selectedIds.size === 0;
    elements.generate.disabled = state.selectedIds.size === 0;
    elements.selectedCount.textContent = `${state.selectedIds.size} selected`;
    applyColumnWidths();
  };

  const rowMatchesFilters = (row) => {
    const includes = (value, query) => String(value ?? '').toLowerCase().includes(String(query || '').trim().toLowerCase());
    return includes(row.testCaseId, filters.id.value)
      && includes(row.title, filters.title.value)
      && (!filters.status.value || row.status === filters.status.value)
      && includes(row.productArea, filters.productArea.value)
      && includes(row.tester || 'Unassigned', filters.tester.value);
  };

  const syncDuplicateCheckboxes = (testCaseId, checked) => {
    elements.body.querySelectorAll(`input[data-test-case-id="${String(testCaseId).replace(/"/g, '')}"]`).forEach((box) => {
      box.checked = checked;
    });
  };

  const renderRows = () => {
    state.visibleRows = state.rows.filter(rowMatchesFilters);
    const fragment = document.createDocumentFragment();

    state.visibleRows.forEach((row, visibleIndex) => {
      const tr = document.createElement('tr');
      const rowKey = `${row.testCaseId}:${row.pointIndex}`;

      const selectionCell = document.createElement('td');
      selectionCell.className = 'planner-selection-cell';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'planner-case-checkbox';
      checkbox.dataset.testCaseId = row.testCaseId;
      checkbox.setAttribute('aria-label', `Select test case ${row.testCaseId}`);
      checkbox.checked = state.selectedIds.has(String(row.testCaseId));
      checkbox.addEventListener('change', () => {
        const id = String(row.testCaseId);
        if (checkbox.checked) state.selectedIds.add(id); else state.selectedIds.delete(id);
        syncDuplicateCheckboxes(id, checkbox.checked);
        updateSelectionControls();
      });
      selectionCell.appendChild(checkbox);
      tr.appendChild(selectionCell);

      const values = [row.testCaseId, row.title, row.status, row.productArea || '', row.tester || 'Unassigned'];
      values.forEach((value, index) => {
        const td = document.createElement('td');
        if (index === 2) {
          const badge = document.createElement('span');
          badge.className = `planner-status ${row.status.toLowerCase()}`;
          badge.textContent = row.status;
          td.appendChild(badge);
        } else {
          td.textContent = value;
        }
        tr.appendChild(td);
      });

      if (state.rowHeights.has(rowKey)) tr.style.height = `${state.rowHeights.get(rowKey)}px`;
      const firstDataCell = tr.children[1];
      firstDataCell.appendChild(makeResizeHandle(
        'row',
        `Resize test case ${row.testCaseId} row`,
        () => tr.getBoundingClientRect().height,
        (size) => { tr.style.height = `${size}px`; state.rowHeights.set(rowKey, size); },
        40,
      ));

      tr.dataset.visibleIndex = visibleIndex;
      fragment.appendChild(tr);
    });

    elements.body.replaceChildren(fragment);
    elements.filterStatus.textContent = state.visibleRows.length
      ? `Showing ${state.visibleRows.length} of ${state.rows.length} rows.`
      : 'No test cases match the filters.';
    updateSelectionControls();
  };

  const clearFilters = () => {
    Object.values(filters).forEach((control) => { control.value = ''; });
    renderRows();
  };

  const loadWorkItemMetadata = async (points) => {
    const ids = [...new Set(points.map((point) => Number(point.testCaseId)).filter(Number.isFinite))];
    const byId = new Map();
    for (let start = 0; start < ids.length; start += 200) {
      const batch = ids.slice(start, start + 200);
      const data = await requestJson('/api/work-items/read', {
        method: 'POST',
        body: JSON.stringify({ ids: batch }),
      });
      (data.workItems || []).forEach((item) => {
        const fields = item.fields || {};
        byId.set(String(item.id), {
          title: String(fields['System.Title'] || ''),
          productArea: productAreaFromFields(fields),
        });
      });
    }
    return byId;
  };

  const renderSummary = () => {
    const uniqueIds = new Set(state.rows.map((row) => String(row.testCaseId)));
    const uniqueStatus = new Map();
    state.rows.forEach((row) => {
      const key = String(row.testCaseId);
      const existing = uniqueStatus.get(key);
      if (!existing || row.status === 'Failed' || (row.status === 'Passed' && existing === 'Active')) {
        uniqueStatus.set(key, row.status);
      }
    });
    const values = [
      ['Test Plan', state.planId],
      ['Suite', state.suiteId],
      ['Test Cases', uniqueIds.size],
      ['Passed', [...uniqueStatus.values()].filter((value) => value === 'Passed').length],
      ['Active', [...uniqueStatus.values()].filter((value) => value === 'Active').length],
      ['Failed', [...uniqueStatus.values()].filter((value) => value === 'Failed').length],
    ];
    const fragment = document.createDocumentFragment();
    values.forEach(([label, value]) => {
      const span = document.createElement('span');
      span.textContent = `${label}: ${value}`;
      fragment.appendChild(span);
    });
    elements.summary.replaceChildren(fragment);
  };

  elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (elements.load.disabled) return;

    elements.load.disabled = true;
    elements.results.hidden = true;
    elements.readyPanel.hidden = true;
    elements.progressPanel.hidden = true;
    state.rows = [];
    state.visibleRows = [];
    state.selectedIds.clear();
    state.selectionMode = false;
    state.generatedPlaylist = '';
    state.generatedMeta = null;
    state.rowHeights.clear();
    setStatus('Loading test suite and planning fields…');

    try {
      const suite = await requestJson('/api/test-plans/read-suite', {
        method: 'POST',
        body: JSON.stringify({ url: elements.url.value.trim() }),
      });
      if (!Array.isArray(suite.testPoints)) throw new Error('Invalid response from the backend.');

      const metadata = await loadWorkItemMetadata(suite.testPoints);
      state.planId = suite.planId;
      state.suiteId = suite.suiteId;
      state.rows = suite.testPoints.map((point, index) => {
        const item = metadata.get(String(point.testCaseId)) || {};
        return {
          testCaseId: point.testCaseId,
          title: item.title || point.title || 'Title unavailable',
          status: plannerStatus(point.outcome),
          productArea: item.productArea || '',
          tester: point.tester || '',
          pointIndex: index,
        };
      });

      clearFilters();
      renderSummary();
      elements.results.hidden = false;
      setStatus(suite.message || 'Test suite loaded.');
    } catch (error) {
      setStatus(error.message || 'Unable to load the test suite.', true);
    } finally {
      elements.load.disabled = false;
    }
  });

  Object.values(filters).forEach((control) => {
    control.addEventListener(control.tagName === 'SELECT' ? 'change' : 'input', renderRows);
  });

  document.querySelector('#plannerClearFiltersButton').addEventListener('click', clearFilters);
  document.querySelector('#plannerResetSizesButton').addEventListener('click', () => {
    state.columnWidths = [145, 560, 155, 230, 240];
    state.rowHeights.clear();
    applyColumnWidths();
    renderRows();
  });

  elements.selectMode.addEventListener('click', () => {
    state.selectionMode = !state.selectionMode;
    updateSelectionControls();
  });

  elements.selectAll.addEventListener('click', () => {
    state.visibleRows.forEach((row) => state.selectedIds.add(String(row.testCaseId)));
    renderRows();
  });

  elements.unselectAll.addEventListener('click', () => {
    state.visibleRows.forEach((row) => state.selectedIds.delete(String(row.testCaseId)));
    renderRows();
  });

  const sleepFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

  elements.generate.addEventListener('click', async () => {
    const selectedRows = [];
    const added = new Set();
    state.rows.forEach((row) => {
      const id = String(row.testCaseId);
      if (!state.selectedIds.has(id) || added.has(id)) return;
      added.add(id);
      selectedRows.push(row);
    });
    if (!selectedRows.length) return;

    elements.generate.disabled = true;
    elements.readyPanel.hidden = true;
    elements.progressPanel.hidden = false;
    elements.progress.value = 0;
    elements.progressText.textContent = '0%';
    setStatus(`Generating playlist for ${selectedRows.length} selected test case(s)…`);

    try {
      for (let index = 0; index < selectedRows.length; index += 1) {
        const percent = Math.max(5, Math.round(((index + 1) / selectedRows.length) * 90));
        elements.progress.value = percent;
        elements.progressText.textContent = `${percent}%`;
        if (index % 20 === 0) await sleepFrame();
      }

      const generated = buildUftPlaylistXml(selectedRows);
      state.generatedPlaylist = generated.xml;
      state.generatedMeta = generated;
      elements.progress.value = 100;
      elements.progressText.textContent = '100%';
      await sleepFrame();

      elements.readyMessage.textContent = `Playlist generated: ${generated.total} test(s) — ${generated.normal} normal, ${generated.samples} sample mode. Open Preview to review before export.`;
      elements.readyPanel.hidden = false;
      setStatus('UFT playlist generated successfully.');
    } catch (error) {
      setStatus(error.message || 'Could not generate the UFT playlist.', true);
    } finally {
      elements.generate.disabled = state.selectedIds.size === 0;
    }
  });

  const openPreview = () => {
    if (!state.generatedPlaylist || !state.generatedMeta) return;
    elements.previewText.textContent = state.generatedPlaylist;
    elements.previewMeta.textContent = `${state.generatedMeta.total} test(s) · ${state.generatedMeta.normal} ProductTestCase · ${state.generatedMeta.samples} ClassSampleTest`;
    elements.exportStatus.textContent = '';
    if (typeof elements.preview.showModal === 'function') {
      elements.preview.showModal();
    } else {
      elements.preview.setAttribute('open', '');
    }
  };

  elements.openPreview.addEventListener('click', openPreview);

  elements.exportButton.addEventListener('click', async () => {
    if (!state.generatedPlaylist) return;
    const blob = new Blob([`\uFEFF${state.generatedPlaylist}`], { type: 'application/xml;charset=utf-8' });
    elements.exportStatus.textContent = 'Choose where to save the playlist…';

    try {
      if (typeof window.showSaveFilePicker === 'function') {
        const handle = await window.showSaveFilePicker({
          suggestedName: CONFIG.outputFileName,
          types: [{ description: 'Visual Studio Playlist', accept: { 'application/xml': ['.playlist'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        elements.exportStatus.textContent = `Exported ${handle.name || CONFIG.outputFileName}.`;
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = CONFIG.outputFileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        elements.exportStatus.textContent = 'Export started. Your browser will use its normal download/save location prompt.';
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        elements.exportStatus.textContent = 'Export cancelled.';
      } else {
        elements.exportStatus.textContent = error?.message || 'Export failed.';
      }
    }
  });

  updateSelectionControls();
  applyColumnWidths();

  window.TestPlannerPlaylist = {
    buildUftPlaylistXml,
    plannerStatus,
    isSampleTitle,
    testMethodName,
  };
})();
