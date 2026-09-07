(() => {
  const exportColumns = [
    { key: 'testCaseId', label: 'Test Case ID', index: 0 },
    { key: 'title', label: 'Title', index: 1 },
    { key: 'outcome', label: 'Outcome', index: 2 },
    { key: 'tester', label: 'Tester', index: 3 },
    { key: 'order', label: 'Order', index: 4 },
  ];

  const actionRow = document.querySelector('#testSuiteResults .action-row');
  const legacyCopyButtons = [
    document.querySelector('#copyTestSuiteButton'),
    document.querySelector('#copyFailedTestsButton'),
  ].filter(Boolean);

  if (!actionRow) return;

  legacyCopyButtons.forEach((button) => {
    button.hidden = true;
    button.setAttribute('aria-hidden', 'true');
    button.tabIndex = -1;
  });

  const exportButton = document.createElement('button');
  exportButton.id = 'exportTestResultsButton';
  exportButton.type = 'button';
  exportButton.className = 'secondary-button';
  exportButton.textContent = 'Export Results';
  exportButton.disabled = true;
  actionRow.appendChild(exportButton);

  const dialog = document.createElement('dialog');
  dialog.id = 'exportResultsDialog';
  dialog.className = 'export-results-dialog';
  dialog.setAttribute('aria-labelledby', 'exportResultsTitle');
  dialog.innerHTML = `
    <form method="dialog" class="export-results-shell">
      <div class="export-results-header">
        <div>
          <h3 id="exportResultsTitle">Export Results</h3>
          <p>Choose the columns and output format. The exported content uses the currently filtered rows.</p>
        </div>
        <button type="submit" class="export-close-button" value="cancel" aria-label="Close export dialog">×</button>
      </div>

      <fieldset class="export-fieldset">
        <legend>Columns</legend>
        <div id="exportColumnOptions" class="export-column-options"></div>
      </fieldset>

      <fieldset class="export-fieldset">
        <legend>Format</legend>
        <div class="export-format-options">
          <label><input type="checkbox" id="exportFormatTxt" checked> TXT</label>
          <label><input type="checkbox" id="exportFormatMarkdown"> Markdown</label>
        </div>
        <p id="exportFormatHint" class="export-hint">Select one format.</p>
      </fieldset>

      <div class="export-preview-heading">
        <strong>Preview</strong>
        <span id="exportPreviewCount"></span>
      </div>
      <pre id="exportResultsPreview" class="export-results-preview"></pre>

      <div class="export-dialog-actions">
        <button type="submit" class="secondary-button" value="cancel">Cancel</button>
        <button id="confirmExportResults" type="button">Export</button>
      </div>
    </form>`;
  document.body.appendChild(dialog);

  const columnOptions = dialog.querySelector('#exportColumnOptions');
  exportColumns.forEach((column) => {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${column.key}" checked> ${column.label}`;
    columnOptions.appendChild(label);
  });

  const txtCheckbox = dialog.querySelector('#exportFormatTxt');
  const markdownCheckbox = dialog.querySelector('#exportFormatMarkdown');
  const formatHint = dialog.querySelector('#exportFormatHint');
  const preview = dialog.querySelector('#exportResultsPreview');
  const previewCount = dialog.querySelector('#exportPreviewCount');
  const confirmButton = dialog.querySelector('#confirmExportResults');

  function readVisibleRows() {
    return [...document.querySelectorAll('#testSuiteRows tr')].map((row) => {
      const cells = row.querySelectorAll('td');
      return {
        testCaseId: cells[0]?.textContent.trim() ?? '',
        title: cells[1]?.textContent.trim() ?? '',
        outcome: cells[2]?.textContent.trim() ?? '',
        tester: cells[3]?.textContent.trim() ?? '',
        order: cells[4]?.textContent.trim() ?? '',
      };
    });
  }

  function selectedColumns() {
    const keys = [...columnOptions.querySelectorAll('input:checked')].map((input) => input.value);
    return exportColumns.filter((column) => keys.includes(column.key));
  }

  function selectedFormat() {
    if (txtCheckbox.checked && !markdownCheckbox.checked) return 'txt';
    if (markdownCheckbox.checked && !txtCheckbox.checked) return 'markdown';
    return null;
  }

  function escapeMarkdown(value) {
    return String(value ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|')
      .replace(/[\r\n]+/g, ' ');
  }

  function textExport(rows, columns) {
    if (!columns.length) return '';
    const widths = columns.map((column) => Math.max(
      column.label.length,
      ...rows.map((row) => String(row[column.key] ?? '').replace(/[\r\n]+/g, ' ').length),
    ));
    const line = (values) => values.map((value, index) => String(value ?? '').replace(/[\r\n]+/g, ' ').padEnd(widths[index])).join('  ').trimEnd();
    return [line(columns.map((column) => column.label)), line(widths.map((width) => '-'.repeat(width))), ...rows.map((row) => line(columns.map((column) => row[column.key])))].join('\n');
  }

  function markdownExport(rows, columns) {
    if (!columns.length) return '';
    const header = `| ${columns.map((column) => column.label).join(' | ')} |`;
    const separator = `| ${columns.map(() => '---').join(' | ')} |`;
    const body = rows.map((row) => `| ${columns.map((column) => escapeMarkdown(row[column.key])).join(' | ')} |`);
    return [header, separator, ...body].join('\n');
  }

  function exportContent() {
    const rows = readVisibleRows();
    const columns = selectedColumns();
    const format = selectedFormat();
    if (!format || !columns.length || !rows.length) return '';
    return format === 'markdown' ? markdownExport(rows, columns) : textExport(rows, columns);
  }

  function refreshPreview() {
    const rows = readVisibleRows();
    const columns = selectedColumns();
    const format = selectedFormat();
    const valid = rows.length > 0 && columns.length > 0 && Boolean(format);

    if (txtCheckbox.checked && markdownCheckbox.checked) {
      formatHint.textContent = 'Choose either TXT or Markdown.';
    } else if (!txtCheckbox.checked && !markdownCheckbox.checked) {
      formatHint.textContent = 'Select TXT or Markdown.';
    } else {
      formatHint.textContent = format === 'markdown' ? 'Markdown table output.' : 'Plain-text aligned table output.';
    }

    preview.textContent = valid ? exportContent() : '';
    previewCount.textContent = `${rows.length} row${rows.length === 1 ? '' : 's'} · ${columns.length} column${columns.length === 1 ? '' : 's'}`;
    confirmButton.disabled = !valid;
  }

  function syncExportButton() {
    exportButton.disabled = document.querySelectorAll('#testSuiteRows tr').length === 0;
  }

  const observer = new MutationObserver(syncExportButton);
  observer.observe(document.querySelector('#testSuiteRows'), { childList: true });
  syncExportButton();

  exportButton.addEventListener('click', () => {
    refreshPreview();
    dialog.showModal();
  });

  columnOptions.addEventListener('change', refreshPreview);
  txtCheckbox.addEventListener('change', () => {
    if (txtCheckbox.checked) markdownCheckbox.checked = false;
    refreshPreview();
  });
  markdownCheckbox.addEventListener('change', () => {
    if (markdownCheckbox.checked) txtCheckbox.checked = false;
    refreshPreview();
  });

  async function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const field = document.createElement('textarea');
    field.value = text;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    const previousFocus = document.activeElement;
    document.body.appendChild(field);
    try {
      field.select();
      if (!document.execCommand('copy')) throw new Error('Copy unavailable');
    } finally {
      field.remove();
      previousFocus?.focus();
    }
  }

  confirmButton.addEventListener('click', async () => {
    const content = exportContent();
    if (!content) return;
    try {
      await copyToClipboard(content);
      dialog.close();
      const status = document.querySelector('#testSuiteStatus');
      if (status) {
        status.textContent = `Exported ${readVisibleRows().length} filtered result${readVisibleRows().length === 1 ? '' : 's'} to the clipboard.`;
        status.classList.remove('error');
      }
    } catch {
      const status = document.querySelector('#testSuiteStatus');
      if (status) {
        status.textContent = 'Could not export to the clipboard. Allow clipboard access or use localhost/HTTPS and try again.';
        status.classList.add('error');
      }
    }
  });
})();
