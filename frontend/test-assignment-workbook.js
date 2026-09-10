(() => {
  const panel = document.querySelector('.test-plan-panel');
  if (!panel || document.querySelector('#assignmentWorkbookSection')) return;

  const section = document.createElement('section');
  section.id = 'assignmentWorkbookSection';
  section.className = 'assignment-workbook-section';
  section.innerHTML = `
    <div class="assignment-workbook-heading">
      <div>
        <h3>Assignment Workbook</h3>
        <p>Read Define for included test-case metadata, then match Execute assignments for one tester and export a one-sheet Excel workbook.</p>
      </div>
      <span class="mini-status">Define + Execute</span>
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
      <div>
        <label for="assignmentWorkbookResultColumn">Put current Execute outcome in</label>
        <select id="assignmentWorkbookResultColumn">
          <option value="round1">Round 1 results</option>
          <option value="round2">Round 2 results</option>
          <option value="single">Single run results</option>
          <option value="manual">Manual run</option>
        </select>
      </div>
    </div>

    <div class="action-row">
      <button id="previewAssignmentWorkbook" type="button">Read Define + Execute</button>
      <button id="exportAssignmentWorkbook" type="button" class="secondary-button" disabled>Export Excel</button>
    </div>
    <p id="assignmentWorkbookStatus" class="mini-status" role="status" aria-live="polite">Enter a suite URL and tester, then preview the matched cases.</p>

    <div id="assignmentWorkbookPreview" hidden>
      <div id="assignmentWorkbookSummary" class="test-suite-summary"></div>
      <div class="assignment-preview-wrap">
        <table class="assignment-preview-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Title</th>
              <th>Product Area</th>
              <th>Automation Script Name</th>
              <th>Execute Outcome</th>
            </tr>
          </thead>
          <tbody id="assignmentWorkbookRows"></tbody>
        </table>
      </div>
    </div>`;

  panel.appendChild(section);

  const urlInput = section.querySelector('#assignmentWorkbookUrl');
  const testerInput = section.querySelector('#assignmentWorkbookTester');
  const resultColumn = section.querySelector('#assignmentWorkbookResultColumn');
  const previewButton = section.querySelector('#previewAssignmentWorkbook');
  const exportButton = section.querySelector('#exportAssignmentWorkbook');
  const status = section.querySelector('#assignmentWorkbookStatus');
  const preview = section.querySelector('#assignmentWorkbookPreview');
  const summary = section.querySelector('#assignmentWorkbookSummary');
  const rowsBody = section.querySelector('#assignmentWorkbookRows');

  function payload(includeResultColumn = false) {
    const value = {
      url: urlInput.value.trim(),
      tester: testerInput.value.trim(),
    };
    if (includeResultColumn) value.resultColumn = resultColumn.value;
    return value;
  }

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
    status.classList.toggle('ok', !error && Boolean(message));
  }

  function renderPreview(data) {
    summary.replaceChildren();
    for (const [label, value] of [
      ['Test Plan', data.planId],
      ['Suite', data.suiteId],
      ['Define cases', data.defineCount],
      ['Assigned cases', data.assignedCount],
      ['Tester', data.matchedTester || testerInput.value.trim()],
    ]) {
      const item = document.createElement('span');
      item.textContent = `${label}: ${value}`;
      summary.appendChild(item);
    }

    const fragment = document.createDocumentFragment();
    for (const row of data.rows || []) {
      const tr = document.createElement('tr');
      for (const value of [row.testCaseId, row.title, row.productArea, row.automationScriptName, row.outcome]) {
        const td = document.createElement('td');
        td.textContent = value ?? '';
        tr.appendChild(td);
      }
      fragment.appendChild(tr);
    }
    rowsBody.replaceChildren(fragment);
    preview.hidden = false;
    exportButton.disabled = !data.assignedCount;
  }

  async function readJson(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
    return data;
  }

  previewButton.addEventListener('click', async () => {
    if (!urlInput.value.trim() || !testerInput.value.trim()) {
      setStatus('Test Plan URL and Assigned tester are required.', true);
      return;
    }

    previewButton.disabled = true;
    exportButton.disabled = true;
    preview.hidden = true;
    setStatus('Reading Define and Execute…');
    try {
      const response = await fetch('/api/test-plans/assignment-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      const data = await readJson(response);
      renderPreview(data);
      setStatus(data.message || 'Assignment preview loaded.');
    } catch (error) {
      setStatus(error.message || 'Unable to read the assignment.', true);
    } finally {
      previewButton.disabled = false;
    }
  });

  exportButton.addEventListener('click', async () => {
    exportButton.disabled = true;
    setStatus('Building Excel workbook…');
    try {
      const response = await fetch('/api/test-plans/assignment-workbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(true)),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Request failed: ${response.status}`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const filenameMatch = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)|filename=["']?([^"';]+)/i);
      const filename = decodeURIComponent(filenameMatch?.[1] || filenameMatch?.[2] || 'Test_Assignment.xlsx');
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setStatus(`Excel workbook ready: ${filename}`);
    } catch (error) {
      setStatus(error.message || 'Unable to export the Excel workbook.', true);
    } finally {
      exportButton.disabled = rowsBody.children.length === 0;
    }
  });

  const primaryUrl = document.querySelector('#testPlanUrl');
  if (primaryUrl) {
    const syncUrl = () => {
      if (!urlInput.value.trim()) urlInput.value = primaryUrl.value.trim();
    };
    primaryUrl.addEventListener('change', syncUrl);
    syncUrl();
  }
})();
