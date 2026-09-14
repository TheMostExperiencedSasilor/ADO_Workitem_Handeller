(() => {
  'use strict';

  const PRODUCT_CLASS = 'ProductTestCase';
  const SAMPLE_CLASS = 'ClassSampleTest';
  const SAMPLE_PRODUCT_AREA = 'Sample Files_HYSYS';
  const PROJECT = 'AspenHYSYS';
  const NAMESPACE = 'TestCases';

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

  const isSampleProductArea = (productArea) =>
    String(productArea || '').trim().toLowerCase() === SAMPLE_PRODUCT_AREA.toLowerCase();

  const buildTestRule = (methodName, className, indent) => {
    const fqn = `${NAMESPACE}.${className}.${methodName}`;
    return [
      `${indent}<Rule Match="All">`,
      `${indent}  <Property Name="TestWithNormalizedFullyQualifiedName" Value="${escapeXmlValue(fqn)}" />`,
      `${indent}  <Rule Match="Any">`,
      `${indent}    <Property Name="DisplayName" Value="${escapeXmlValue(methodName)}" />`,
      `${indent}  </Rule>`,
      `${indent}</Rule>`,
    ];
  };

  const buildPlaylistXml = (rows, className) => {
    const unique = new Map();
    rows.forEach((row) => {
      const methodName = testMethodName(row.testCaseId);
      if (!methodName || methodName === 'VSTS') return;
      const key = methodName.toLowerCase();
      if (!unique.has(key)) unique.set(key, { ...row, methodName });
    });

    const items = [...unique.values()];
    const lines = [
      '<Playlist Version="2.0">',
      '  <Rule Name="Includes" Match="Any">',
      '    <Rule Match="All">',
      '      <Property Name="Solution" />',
      '      <Rule Match="Any">',
      '        <Rule Match="All">',
      `          <Property Name="Project" Value="${escapeXmlValue(PROJECT)}" />`,
      '          <Rule Match="Any">',
      '            <Rule Match="All">',
      `              <Property Name="Namespace" Value="${escapeXmlValue(NAMESPACE)}" />`,
      '              <Rule Match="Any">',
      '                <Rule Match="All">',
      `                  <Property Name="Class" Value="${escapeXmlValue(className)}" />`,
      '                  <Rule Match="Any">',
    ];

    items.forEach((item) => lines.push(...buildTestRule(item.methodName, className, '                    ')));
    lines.push(
      '                  </Rule>',
      '                </Rule>',
      '              </Rule>',
      '            </Rule>',
      '          </Rule>',
      '        </Rule>',
      '      </Rule>',
      '    </Rule>',
      '  </Rule>',
      '</Playlist>',
    );

    return { xml: lines.join('\r\n') + '\r\n', total: items.length };
  };

  const buildPlaylistSet = (rows) => {
    const unique = new Map();
    rows.forEach((row) => {
      const methodName = testMethodName(row.testCaseId);
      if (!methodName || methodName === 'VSTS') return;
      const key = methodName.toLowerCase();
      if (!unique.has(key)) unique.set(key, { ...row, methodName });
    });

    const items = [...unique.values()];
    const sampleRows = items.filter((row) => isSampleProductArea(row.productArea));
    const normalRows = items.filter((row) => !isSampleProductArea(row.productArea));
    const mixed = sampleRows.length > 0 && normalRows.length > 0;
    const playlists = [];

    if (normalRows.length) {
      const generated = buildPlaylistXml(normalRows, PRODUCT_CLASS);
      playlists.push({
        kind: 'normal',
        label: 'Non-sample',
        className: PRODUCT_CLASS,
        fileName: mixed ? 'Playlist_NonSample.playlist' : 'Playlist.playlist',
        ...generated,
      });
    }
    if (sampleRows.length) {
      const generated = buildPlaylistXml(sampleRows, SAMPLE_CLASS);
      playlists.push({
        kind: 'sample',
        label: 'Sample',
        className: SAMPLE_CLASS,
        fileName: mixed ? 'Playlist_Sample.playlist' : 'Playlist.playlist',
        ...generated,
      });
    }

    return playlists;
  };

  window.TestPlannerEnhancements = { isSampleProductArea, buildPlaylistSet, buildPlaylistXml, testMethodName };

  const initialize = () => {
    const panel = document.querySelector('#testResultsPlannerPanel');
    const tableBody = document.querySelector('#plannerRows');
    const generateButton = document.querySelector('#plannerGeneratePlaylistButton');
    const openPreviewButton = document.querySelector('#openPlaylistPreviewButton');
    const exportButton = document.querySelector('#exportPlaylistButton');
    const previewDialog = document.querySelector('#playlistPreviewDialog');
    const previewText = document.querySelector('#playlistPreviewText');
    const previewMeta = document.querySelector('#playlistPreviewMeta');
    const readyPanel = document.querySelector('#playlistReadyPanel');
    const readyMessage = document.querySelector('#playlistReadyMessage');
    const progressPanel = document.querySelector('#playlistProgressPanel');
    const progress = document.querySelector('#playlistProgress');
    const progressText = document.querySelector('#playlistProgressText');
    const plannerStatus = document.querySelector('#plannerSuiteStatus');
    const plannerForm = document.querySelector('#plannerSuiteForm');
    const productInput = document.querySelector('#plannerFilterProductArea');
    const testerInput = document.querySelector('#plannerFilterTester');
    if (!panel || !tableBody || !generateButton || !openPreviewButton || !exportButton || !productInput || !testerInput) return false;

    const rowCatalog = new Map();
    const selectedIds = new Set();
    let generatedPlaylists = [];
    let currentPreviewIndex = 0;

    const productSelect = document.createElement('select');
    productSelect.id = 'plannerFilterProductAreaDropdown';
    productSelect.setAttribute('aria-label', 'Filter Product Area');
    productInput.hidden = true;
    productInput.insertAdjacentElement('afterend', productSelect);

    const testerSelect = document.createElement('select');
    testerSelect.id = 'plannerFilterTesterDropdown';
    testerSelect.setAttribute('aria-label', 'Filter Current Tester');
    testerInput.hidden = true;
    testerInput.insertAdjacentElement('afterend', testerSelect);

    const variantSelect = document.createElement('select');
    variantSelect.id = 'playlistPreviewVariant';
    variantSelect.className = 'playlist-preview-variant';
    variantSelect.setAttribute('aria-label', 'Playlist preview');
    variantSelect.hidden = true;
    previewMeta?.insertAdjacentElement('beforebegin', variantSelect);

    const setPlannerStatus = (message, error = false) => {
      if (!plannerStatus) return;
      plannerStatus.textContent = message;
      plannerStatus.classList.toggle('error', error);
      plannerStatus.classList.toggle('ok', !error && Boolean(message));
    };

    const populateSelect = (select, firstLabel, values, currentValue = '') => {
      const previous = currentValue || select.value;
      select.replaceChildren();
      const all = document.createElement('option');
      all.value = '';
      all.textContent = firstLabel;
      select.appendChild(all);
      values.forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      });
      select.value = values.includes(previous) ? previous : '';
    };

    const syncDropdownOptions = () => {
      const productAreas = [...new Set([...rowCatalog.values()].map((row) => row.productArea).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
      const testers = [...new Set([...rowCatalog.values()].map((row) => row.tester || 'Unassigned'))]
        .sort((a, b) => a.localeCompare(b));
      populateSelect(productSelect, 'All product areas', productAreas, productInput.value);
      populateSelect(testerSelect, 'All testers', testers, testerInput.value);
    };

    const scanRenderedRows = () => {
      [...tableBody.rows].forEach((tr) => {
        const cells = [...tr.cells];
        if (cells.length < 6) return;
        const id = cells[1].textContent.trim();
        if (!id) return;
        const checkbox = cells[0].querySelector('input[type="checkbox"]');
        rowCatalog.set(id, {
          testCaseId: id,
          title: cells[2].textContent.trim(),
          status: cells[3].textContent.trim(),
          productArea: cells[4].textContent.trim(),
          tester: cells[5].textContent.trim() === 'Unassigned' ? '' : cells[5].textContent.trim(),
        });
        if (checkbox?.checked) selectedIds.add(id);
        else selectedIds.delete(id);
      });
      syncDropdownOptions();
    };

    const observer = new MutationObserver(scanRenderedRows);
    observer.observe(tableBody, { childList: true });
    scanRenderedRows();

    productSelect.addEventListener('change', () => {
      productInput.value = productSelect.value;
      productInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    testerSelect.addEventListener('change', () => {
      testerInput.value = testerSelect.value;
      testerInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    tableBody.addEventListener('change', (event) => {
      const checkbox = event.target.closest?.('.planner-case-checkbox');
      if (!checkbox) return;
      const row = checkbox.closest('tr');
      const id = row?.cells?.[1]?.textContent?.trim();
      if (!id) return;
      if (checkbox.checked) selectedIds.add(id);
      else selectedIds.delete(id);
    }, true);

    plannerForm?.addEventListener('submit', () => {
      rowCatalog.clear();
      selectedIds.clear();
      generatedPlaylists = [];
      currentPreviewIndex = 0;
      productSelect.value = '';
      testerSelect.value = '';
    }, true);

    const renderPreview = () => {
      const playlist = generatedPlaylists[currentPreviewIndex];
      if (!playlist) return;
      previewText.textContent = playlist.xml;
      previewMeta.textContent = `${playlist.fileName} · ${playlist.total} test(s) · ${playlist.className}`;
      exportButton.textContent = generatedPlaylists.length > 1 ? `Export ${generatedPlaylists.length} Playlists` : 'Export Playlist';
    };

    variantSelect.addEventListener('change', () => {
      currentPreviewIndex = Number(variantSelect.value) || 0;
      renderPreview();
    });

    generateButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      scanRenderedRows();
      const selectedRows = [...selectedIds].map((id) => rowCatalog.get(id)).filter(Boolean);
      if (!selectedRows.length) return;

      generateButton.disabled = true;
      readyPanel.hidden = true;
      progressPanel.hidden = false;
      progress.value = 15;
      progressText.textContent = '15%';
      setPlannerStatus(`Generating playlist${selectedRows.length === 1 ? '' : 's'} for ${selectedRows.length} selected test case(s)…`);
      await new Promise((resolve) => requestAnimationFrame(resolve));

      generatedPlaylists = buildPlaylistSet(selectedRows);
      currentPreviewIndex = 0;
      progress.value = 100;
      progressText.textContent = '100%';
      await new Promise((resolve) => requestAnimationFrame(resolve));

      variantSelect.replaceChildren();
      generatedPlaylists.forEach((playlist, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `${playlist.label} — ${playlist.total} test(s)`;
        variantSelect.appendChild(option);
      });
      variantSelect.hidden = generatedPlaylists.length <= 1;

      const normal = generatedPlaylists.find((playlist) => playlist.kind === 'normal');
      const sample = generatedPlaylists.find((playlist) => playlist.kind === 'sample');
      readyMessage.textContent = generatedPlaylists.length === 2
        ? `2 playlists generated — ${normal?.total || 0} non-sample test(s) and ${sample?.total || 0} sample test(s).`
        : `${generatedPlaylists[0]?.label || 'UFT'} playlist generated — ${generatedPlaylists[0]?.total || 0} test(s).`;
      readyPanel.hidden = false;
      setPlannerStatus(generatedPlaylists.length === 2 ? 'Two UFT playlists generated successfully.' : 'UFT playlist generated successfully.');
      generateButton.disabled = false;
    }, true);

    openPreviewButton.addEventListener('click', (event) => {
      if (!generatedPlaylists.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      currentPreviewIndex = 0;
      variantSelect.value = '0';
      renderPreview();
      const exportStatus = document.querySelector('#playlistExportStatus');
      if (exportStatus) exportStatus.textContent = '';
      if (typeof previewDialog.showModal === 'function') previewDialog.showModal();
      else previewDialog.setAttribute('open', '');
    }, true);

    const downloadPlaylist = (playlist) => {
      const blob = new Blob([`\uFEFF${playlist.xml}`], { type: 'application/xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = playlist.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    };

    exportButton.addEventListener('click', async (event) => {
      if (!generatedPlaylists.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const exportStatus = document.querySelector('#playlistExportStatus');
      try {
        if (generatedPlaylists.length > 1 && typeof window.showDirectoryPicker === 'function') {
          if (exportStatus) exportStatus.textContent = 'Choose a folder for both playlists…';
          const directory = await window.showDirectoryPicker();
          for (const playlist of generatedPlaylists) {
            const handle = await directory.getFileHandle(playlist.fileName, { create: true });
            const writable = await handle.createWritable();
            await writable.write(new Blob([`\uFEFF${playlist.xml}`], { type: 'application/xml;charset=utf-8' }));
            await writable.close();
          }
          if (exportStatus) exportStatus.textContent = `Exported ${generatedPlaylists.length} playlists.`;
          return;
        }

        if (generatedPlaylists.length === 1 && typeof window.showSaveFilePicker === 'function') {
          const playlist = generatedPlaylists[0];
          if (exportStatus) exportStatus.textContent = 'Choose where to save the playlist…';
          const handle = await window.showSaveFilePicker({
            suggestedName: playlist.fileName,
            types: [{ description: 'Visual Studio Playlist', accept: { 'application/xml': ['.playlist'] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(new Blob([`\uFEFF${playlist.xml}`], { type: 'application/xml;charset=utf-8' }));
          await writable.close();
          if (exportStatus) exportStatus.textContent = `Exported ${handle.name || playlist.fileName}.`;
          return;
        }

        generatedPlaylists.forEach((playlist, index) => setTimeout(() => downloadPlaylist(playlist), index * 180));
        if (exportStatus) exportStatus.textContent = generatedPlaylists.length > 1
          ? 'Started both playlist downloads.'
          : 'Playlist download started.';
      } catch (error) {
        if (exportStatus) exportStatus.textContent = error?.name === 'AbortError' ? 'Export cancelled.' : (error?.message || 'Export failed.');
      }
    }, true);

    return true;
  };

  let attempts = 0;
  const waitForPlanner = () => {
    if (initialize()) return;
    attempts += 1;
    if (attempts < 60) setTimeout(waitForPlanner, 100);
  };
  waitForPlanner();
})();
