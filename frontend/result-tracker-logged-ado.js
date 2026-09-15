(() => {
  'use strict';

  if (window.__resultTrackerLoggedAdoInitialized) return;

  function initialize() {
    const section = document.querySelector('#assignmentWorkbookSection');
    const rowsBody = document.querySelector('#assignmentWorkbookRows');
    const urlInput = document.querySelector('#assignmentWorkbookUrl');
    const testerInput = document.querySelector('#assignmentWorkbookTester');
    const status = document.querySelector('#assignmentWorkbookStatus');
    const fillControls = [...document.querySelectorAll('.fill-result-column')];
    if (!section || !rowsBody || !urlInput || !testerInput || !status || !fillControls.length) return false;

    window.__resultTrackerLoggedAdoInitialized = true;

    fillControls.forEach((fill) => {
      if (fill.querySelector('option[value="__LOGGED_ADO__"]')) return;
      fill.appendChild(new Option('Logged ADO results', '__LOGGED_ADO__'));
    });

    const normalizeError = async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
      return data;
    };

    const fillFromLoggedAdo = async (fill) => {
      const header = fill.closest('th');
      const columnIndex = header?.cellIndex;
      if (!Number.isInteger(columnIndex) || columnIndex < 4 || columnIndex > 7) return;

      const label = header.querySelector('.result-header')?.childNodes?.[0]?.textContent?.trim()
        || `result column ${columnIndex - 3}`;

      const editableBlankRows = [...rowsBody.rows].filter((row) => {
        const select = row.cells[columnIndex]?.querySelector('select');
        return select && !select.value && !select.disabled;
      });
      const lockedBlankCount = [...rowsBody.rows].filter((row) => {
        const select = row.cells[columnIndex]?.querySelector('select');
        return select && !select.value && select.dataset.lockedByResultChecker === '1';
      }).length;

      if (!editableBlankRows.length) {
        status.textContent = `No editable blank ${label} cells to fill${lockedBlankCount ? ` · ${lockedBlankCount} locked blank cell(s) skipped` : ''}.`;
        return;
      }

      const testCaseIds = editableBlankRows
        .map((row) => Number(String(row.cells[0]?.textContent || '').trim()))
        .filter((value) => Number.isInteger(value) && value > 0);

      if (!urlInput.value.trim() || !testerInput.value.trim()) {
        status.textContent = 'Test Plan URL and Assigned tester are required before filling from logged ADO results.';
        status.classList.add('error');
        return;
      }

      fill.disabled = true;
      status.classList.remove('error');
      status.textContent = `Reading current logged ADO results for ${testCaseIds.length} case(s)…`;

      try {
        const response = await fetch('/api/test-plans/logged-results', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: urlInput.value.trim(),
            tester: testerInput.value.trim(),
            testCaseIds,
          }),
        });
        const data = await normalizeError(response);
        const byId = new Map((data.results || []).map((item) => [String(item.testCaseId), item]));

        const candidates = [];
        let noLoggedResult = 0;
        let ambiguous = 0;
        editableBlankRows.forEach((row) => {
          const id = String(row.cells[0]?.textContent || '').trim();
          const item = byId.get(id);
          if (item?.ambiguous) {
            ambiguous += 1;
            return;
          }
          if (!item?.result) {
            noLoggedResult += 1;
            return;
          }
          const select = row.cells[columnIndex]?.querySelector('select');
          if (!select || select.disabled || select.value) return;
          const supported = [...select.options].some((option) => option.value === item.result);
          if (!supported) {
            noLoggedResult += 1;
            return;
          }
          candidates.push({ select, result: item.result });
        });

        if (!candidates.length) {
          status.textContent = `No completed logged ADO results are available for editable blank ${label} cells.`
            + (ambiguous ? ` ${ambiguous} case(s) have conflicting Test Point results.` : '')
            + (lockedBlankCount ? ` ${lockedBlankCount} locked blank cell(s) were skipped.` : '');
          return;
        }

        const detail = [
          noLoggedResult ? `${noLoggedResult} without a completed ADO result` : '',
          ambiguous ? `${ambiguous} with conflicting Test Point results` : '',
          lockedBlankCount ? `${lockedBlankCount} locked` : '',
        ].filter(Boolean).join(' · ');
        const confirmed = window.confirm(
          `Fill ${candidates.length} blank ${label} cell(s) with their current logged ADO results?`
          + (detail ? `\n\nSkipped: ${detail}.` : '')
          + '\n\nExisting results will not be changed.'
        );
        if (!confirmed) return;

        candidates.forEach(({ select, result }) => {
          select.value = result;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        });

        status.textContent = `Filled ${candidates.length} blank ${label} cell(s) from logged ADO results.`
          + (detail ? ` Skipped: ${detail}.` : '')
          + ' Unsaved changes.';
      } catch (error) {
        status.classList.add('error');
        status.textContent = error.message || 'Unable to read logged ADO results.';
      } finally {
        fill.disabled = false;
        fill.value = '';
      }
    };

    section.addEventListener('change', (event) => {
      const fill = event.target.closest?.('.fill-result-column');
      if (!fill || fill.value !== '__LOGGED_ADO__') return;

      // The existing Fill handler lives directly on the select. Capture this special
      // value first so it is not treated as a literal result value.
      event.preventDefault();
      event.stopImmediatePropagation();
      fillFromLoggedAdo(fill);
    }, true);

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
