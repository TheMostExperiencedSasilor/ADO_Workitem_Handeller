(() => {
  'use strict';

  const DEFAULT_WIDTHS = [145, 560, 155, 230, 240];
  const MIN_WIDTHS = [120, 220, 120, 160, 180];

  const initialize = () => {
    const table = document.querySelector('#plannerTable');
    const colgroup = document.querySelector('#plannerColumns');
    const body = document.querySelector('#plannerRows');
    const resetButton = document.querySelector('#plannerResetSizesButton');
    if (!table || !colgroup || !body) return false;

    let widths = [...DEFAULT_WIDTHS];

    const selectionWidth = () => table.classList.contains('selection-mode') ? 46 : 0;
    const clampWidth = (index, value) => Math.max(MIN_WIDTHS[index] || 80, Math.round(value));

    const setExactWidth = (element, width) => {
      if (!element) return;
      const cssWidth = `${width}px`;
      element.style.width = cssWidth;
      element.style.minWidth = cssWidth;
      element.style.maxWidth = cssWidth;
    };

    const applyWidths = () => {
      const cols = [...colgroup.children];
      const selectWidth = selectionWidth();

      setExactWidth(cols[0], selectWidth);
      table.querySelectorAll('.planner-selection-cell').forEach((cell) => setExactWidth(cell, selectWidth));

      widths.forEach((value, index) => {
        const width = clampWidth(index, value);
        widths[index] = width;
        setExactWidth(cols[index + 1], width);

        // Selection is always kept as a real first table column, even when its
        // contents are hidden. Therefore planner column N is always nth-child N+2.
        const position = index + 2;
        table.querySelectorAll(`tr > :nth-child(${position})`).forEach((cell) => setExactWidth(cell, width));
      });

      const total = widths.reduce((sum, width) => sum + width, 0) + selectWidth;
      table.style.tableLayout = 'fixed';
      table.style.width = `${total}px`;
      table.style.minWidth = `${total}px`;
      table.style.maxWidth = `${total}px`;
    };

    const bindResizeHandles = () => {
      table.querySelectorAll('.planner-header-row th[data-planner-column]').forEach((header) => {
        const handle = header.querySelector('.test-resize-handle.column');
        if (!handle || handle.dataset.plannerLayoutBound === '1') return;
        handle.dataset.plannerLayoutBound = '1';

        const index = Number(header.dataset.plannerColumn);
        if (!Number.isInteger(index) || index < 0 || index >= widths.length) return;

        handle.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopImmediatePropagation();

          const startX = event.clientX;
          const startWidth = widths[index];
          handle.classList.add('planner-resizing');
          handle.setPointerCapture(event.pointerId);

          const move = (moveEvent) => {
            widths[index] = clampWidth(index, startWidth + (moveEvent.clientX - startX));
            applyWidths();
          };
          const stop = (stopEvent) => {
            handle.classList.remove('planner-resizing');
            if (stopEvent?.pointerId != null && handle.hasPointerCapture?.(stopEvent.pointerId)) {
              try { handle.releasePointerCapture(stopEvent.pointerId); } catch { /* no-op */ }
            }
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', stop);
            handle.removeEventListener('pointercancel', stop);
            handle.removeEventListener('lostpointercapture', stop);
          };

          handle.addEventListener('pointermove', move);
          handle.addEventListener('pointerup', stop);
          handle.addEventListener('pointercancel', stop);
          handle.addEventListener('lostpointercapture', stop);
        }, true);

        handle.addEventListener('keydown', (event) => {
          if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          widths[index] = clampWidth(index, widths[index] + (event.key === 'ArrowRight' ? 10 : -10));
          applyWidths();
        }, true);
      });
    };

    resetButton?.addEventListener('click', () => {
      widths = [...DEFAULT_WIDTHS];
      requestAnimationFrame(() => {
        applyWidths();
        bindResizeHandles();
      });
    });

    const observer = new MutationObserver(() => {
      requestAnimationFrame(() => {
        applyWidths();
        bindResizeHandles();
      });
    });
    observer.observe(body, { childList: true });
    observer.observe(table, { attributes: true, attributeFilter: ['class'] });

    bindResizeHandles();
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
