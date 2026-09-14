(() => {
  'use strict';

  const DEFAULT_WIDTHS = [145, 560, 155, 230, 240];
  const MIN_WIDTHS = [110, 180, 120, 140, 160];

  const initialize = () => {
    const panel = document.querySelector('#testResultsPlannerPanel');
    const table = document.querySelector('#plannerTable');
    const colgroup = document.querySelector('#plannerColumns');
    const body = document.querySelector('#plannerRows');
    const resetButton = document.querySelector('#plannerResetSizesButton');
    if (!panel || !table || !colgroup || !body) return false;

    let widths = [...DEFAULT_WIDTHS];
    let applying = false;

    const selectionWidth = () => table.classList.contains('selection-mode') ? 46 : 0;

    const clampWidth = (index, value) => Math.max(MIN_WIDTHS[index] || 80, Math.round(value));

    const applyWidths = () => {
      if (applying) return;
      applying = true;
      const cols = [...colgroup.children];
      if (cols[0]) cols[0].style.width = `${selectionWidth()}px`;

      widths.forEach((width, index) => {
        const safeWidth = clampWidth(index, width);
        widths[index] = safeWidth;
        const col = cols[index + 1];
        if (col) col.style.width = `${safeWidth}px`;

        const header = table.querySelector(`.planner-header-row th[data-planner-column="${index}"]`);
        if (header) {
          header.style.width = `${safeWidth}px`;
          header.style.minWidth = `${safeWidth}px`;
          header.style.maxWidth = `${safeWidth}px`;
        }

        const filterCell = table.querySelector(`.planner-filter-row th:nth-child(${index + 2})`);
        if (filterCell) {
          filterCell.style.width = `${safeWidth}px`;
          filterCell.style.minWidth = `${safeWidth}px`;
          filterCell.style.maxWidth = `${safeWidth}px`;
        }
      });

      const total = widths.reduce((sum, width) => sum + width, 0) + selectionWidth();
      table.style.tableLayout = 'fixed';
      table.style.width = `${total}px`;
      table.style.minWidth = `${total}px`;
      table.style.maxWidth = 'none';
      applying = false;
    };

    const beginResize = (event, handle, index) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();

      const startX = event.clientX;
      const startWidth = widths[index];
      handle.classList.add('planner-resizing');
      try { handle.setPointerCapture(event.pointerId); } catch { /* Pointer capture is optional. */ }

      const move = (moveEvent) => {
        widths[index] = clampWidth(index, startWidth + (moveEvent.clientX - startX));
        applyWidths();
      };

      const stop = () => {
        handle.classList.remove('planner-resizing');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', stop);
        handle.removeEventListener('pointercancel', stop);
        handle.removeEventListener('lostpointercapture', stop);
      };

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
      handle.addEventListener('lostpointercapture', stop);
    };

    /* Capture before the legacy resize listener so dragging the rear edge controls
       the actual column/header width instead of only moving a visual separator. */
    table.addEventListener('pointerdown', (event) => {
      const handle = event.target.closest?.('.test-resize-handle.column');
      if (!handle || !table.contains(handle)) return;
      const header = handle.closest('th[data-planner-column]');
      if (!header) return;
      const index = Number(header.dataset.plannerColumn);
      if (!Number.isInteger(index) || index < 0 || index >= widths.length) return;
      beginResize(event, handle, index);
    }, true);

    table.addEventListener('keydown', (event) => {
      const handle = event.target.closest?.('.test-resize-handle.column');
      if (!handle) return;
      const header = handle.closest('th[data-planner-column]');
      if (!header) return;
      const index = Number(header.dataset.plannerColumn);
      if (!Number.isInteger(index)) return;
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      widths[index] = clampWidth(index, widths[index] + (event.key === 'ArrowRight' ? 10 : -10));
      applyWidths();
    }, true);

    resetButton?.addEventListener('click', () => {
      widths = [...DEFAULT_WIDTHS];
      requestAnimationFrame(applyWidths);
    });

    /* The original planner re-renders rows during filtering/selection and reapplies
       its own widths. Reassert the user-selected widths after those DOM updates. */
    const observer = new MutationObserver(() => requestAnimationFrame(applyWidths));
    observer.observe(body, { childList: true });
    observer.observe(table, { attributes: true, attributeFilter: ['class'] });

    applyWidths();
    return true;
  };

  let attempts = 0;
  const waitForPlanner = () => {
    if (initialize()) return;
    attempts += 1;
    if (attempts < 80) setTimeout(waitForPlanner, 100);
  };

  waitForPlanner();
  window.TestPlannerLayout = { DEFAULT_WIDTHS, MIN_WIDTHS };
})();
