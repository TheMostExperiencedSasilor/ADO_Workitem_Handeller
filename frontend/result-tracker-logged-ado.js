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

    const readJson = async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || `Request failed: ${response.status}`);
      return data;
    };

    const plannerStatus = (outcome) => {
      const value = String(outcome || '').trim().toLowerCase();
      if (value === 'passed') return 'Passed';
      if (value === 'failed') return 'Failed';
      return 'Active';
    };

    const testerMatches = (pointTester, query) => {
      const tester = String(pointTester || '').trim().toLowerCase();
      const wanted = String(query || '').trim().toLowerCase();
      if (!wanted) return true;
      return tester === wanted || tester.includes(wanted) || wanted.includes(tester);
    };

    const aggregateStatus = (current, incoming) => {
      if (!current) return incoming;
      if (incoming === 'Failed') return 'Failed';
      if (incoming === 'Passed' && current === 'Active') return 'Passed';
      return current;
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

      if (!urlInput.value.trim()) {
        status.textContent = 'Test Plan URL is required before filling from logged ADO results.';
        status.classList.add('error');
        return;
      }

      fill.disabled = true;
      status.classList.remove('error');
      status.textContent = 'Reading the same current ADO statuses used by Test Planner…';

      try {
        // Reuse the exact endpoint already used by Test Planner. This avoids a second
        // status-reading implementation and keeps Result Tracker aligned with Planner.
        const response = await fetch('/api/test-plans/read-suite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: urlInput.value.trim() }),
        });
        const data = await readJson(response);
        const points = Array.isArray(data.testPoints) ? data.testPoints : [];
        const testerQuery = testerInput.value.trim();

        const statusByCase = new Map();
        points.forEach((point) => {
          if (testerQuery && !testerMatches(point.tester, testerQuery)) return;
          const id = String(point.testCaseId ?? '').trim();
          if (!id) return;
          const next = plannerStatus(point.outcome);
          statusByCase.set(id, aggregateStatus(statusByCase.get(id), next));
        });

        const candidates = [];
        let activeCount = 0;
        let notFoundCount = 0;
        editableBlankRows.forEach((row) => {
          const id = String(row.cells[0]?.textContent || '').trim();
          const adoStatus = statusByCase.get(id);
          if (!adoStatus) {
            notFoundCount += 1;
            return;
          }
          // Match Test Planner semantics exactly: Active means there is no completed
          // Passed/Failed outcome to copy into a result column.
          if (adoStatus === 'Active') {
            activeCount += 1;
            return;
          }
          const select = row.cells[columnIndex]?.querySelector('select');
          if (!select || select.disabled || select.value) return;
          candidates.push({ select, result: adoStatus });
        });

        if (!candidates.length) {
          status.textContent = `No Passed/Failed ADO statuses are available for editable blank ${label} cells.`
            + (activeCount ? ` ${activeCount} case(s) are Active.` : '')
            + (notFoundCount ? ` ${notFoundCount} case(s) were not found for the selected tester.` : '')
            + (lockedBlankCount ? ` ${lockedBlankCount} locked blank cell(s) were skipped.` : '');
          return;
        }

        const detail = [
          activeCount ? `${activeCount} Active` : '',
          notFoundCount ? `${notFoundCount} not found for tester` : '',
          lockedBlankCount ? `${lockedBlankCount} locked` : '',
        ].filter(Boolean).join(' · ');

        const confirmed = window.confirm(
          `Fill ${candidates.length} blank ${label} cell(s) from the current ADO statuses shown by Test Planner?`
          + (detail ? `\n\nSkipped: ${detail}.` : '')
          + '\n\nOnly Passed/Failed are copied. Existing results will not be changed.'
        );
        if (!confirmed) return;

        candidates.forEach(({ select, result }) => {
          select.value = result;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        });

        status.textContent = `Filled ${candidates.length} blank ${label} cell(s) from current ADO statuses.`
          + (detail ? ` Skipped: ${detail}.` : '')
          + ' Unsaved changes.';
      } catch (error) {
        status.classList.add('error');
        status.textContent = error.message || 'Unable to read current ADO results.';
      } finally {
        fill.disabled = false;
        fill.value = '';
      }
    };

    section.addEventListener('change', (event) => {
      const fill = event.target.closest?.('.fill-result-column');
      if (!fill || fill.value !== '__LOGGED_ADO__') return;

      // Intercept this special option before the ordinary Passed/Failed Fill handler.
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
