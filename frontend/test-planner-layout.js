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

    const applyWidths = () => {
      const cols = [...colgroup.children];
      const selectWidth = selectionWidth();

      if (cols[0]) {
        cols[0].style.width = `${selectWidth}px`;
        cols[0].style.minWidth = `${selectWidth}px`;
        cols[0].style.maxWidth = `${selectWidth}px`;
      }

      widths.forEach((value, index) => {
        const width = clampWidth(index, value);
        widths[index] = width;
        const cssWidth = `${width}px`;
        const col = cols[index + 1];
        if (col) {
          col.style.width = cssWidth;
          col.style.minWidth = cssWidth;
          col.style.maxWidth = cssWidth;
        }

        // Apply the width to every real cell as well as the <col>. This avoids
        // browsers collapsing the Test Case ID column when the selection column
        // is hidden and makes the header edge match the body edge exactly.
        const position = index + 2;
        table.querySelectorAll(`tr > :nth-child(${position})`).forEach((cell) => {
          cell.style.width = cssWidth;
          cell.style.minWidth = cssWidth;
          cell.style.maxWidth = cssWidth;
        });
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

        // Capture on the handle itself. The planner's older resize listener is a
        // bubble listener on this same element; stopping it here prevents two
        // resize implementations from fighting each other, while pointer capture
        // remains valid because the handle is the actual pointer target.
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
