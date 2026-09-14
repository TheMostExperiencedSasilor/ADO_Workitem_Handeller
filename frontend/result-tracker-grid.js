(() => {
  const normalizeResult = (value) => {
    const text = String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
    if (!text) return '';
    if (['pass','passed'].includes(text)) return 'Passed';
    if (['fail','failed','false'].includes(text)) return 'Failed';
    if (text === 'blocked') return 'Blocked';
    if (['not run','notrun','not executed','notexecuted'].includes(text)) return 'Not Run';
    if (['n/a','na','not applicable'].includes(text)) return 'N/A';
    return '';
  };

  const mergeResult = (existing, incoming) => {
    const current = normalizeResult(existing);
    const next = normalizeResult(incoming);
    if (!next) return current;
    if (current === 'Passed' || next === 'Passed') return 'Passed';
    if (current === 'Failed' || next === 'Failed') return 'Failed';
    return next || current;
  };

  const parseCsvRows = (text) => {
    const rows = []; let row = []; let cell = ''; let quoted = false;
    const source = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '"') {
        if (quoted && source[i + 1] === '"') { cell += '"'; i += 1; } else quoted = !quoted;
      } else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
      else if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && source[i + 1] === '\n') i += 1;
        row.push(cell); if (row.some((v) => v !== '')) rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    row.push(cell); if (row.some((v) => v !== '')) rows.push(row);
    return rows;
  };

  const parseResultCsv = (text) => {
    const rows = parseCsvRows(text); if (!rows.length) return [];
    const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const headers = rows[0].map(norm), id = headers.indexOf('testid'), result = headers.indexOf('result');
    if (id < 0 || result < 0) throw new Error('CSV must contain Test ID and Result headers.');
    return rows.slice(1).map((r) => {
      const match = String(r[id] || '').match(/VSTS\s*(\d+)|\b(\d+)\b/i);
      return { testCaseId: match ? (match[1] || match[2]) : '', result: normalizeResult(r[result]) };
    }).filter((x) => x.testCaseId && x.result);
  };

  const parseTestResultTxt = (text) => String(text || '').split(/\r?\n/).map((line) => {
    const m = line.match(/\bVSTS\s*(\d+)\b[^\r\n]*?\b(Passed|Pass|Failed|Fail|Blocked|Not\s*Run|NotExecuted|N\/A)\b/i);
    return m ? { testCaseId: m[1], result: normalizeResult(m[2]) } : null;
  }).filter(Boolean);

  window.ResultTrackerGridUtils = { normalizeResult, mergeResult, parseResultCsv, parseTestResultTxt };

  const section = document.querySelector('#assignmentWorkbookSection');
  const table = document.querySelector('.assignment-preview-table');
  const body = document.querySelector('#assignmentWorkbookRows');
  if (!section || !table || !body) return;

  const editableOffset = 4;
  const resultCount = 4;
  let anchor = null, focus = null;
  const widths = [100, 440, 190, 240, 165, 165, 175, 160, 230, 230, 180];

  const colgroup = document.createElement('colgroup');
  colgroup.id = 'assignmentGridColumns';
  widths.forEach(() => colgroup.appendChild(document.createElement('col')));
  table.insertBefore(colgroup, table.firstChild);
  const syncStickyMetrics = () => {
    table.style.setProperty('--assignment-col1-width', widths[0] + 'px');
    const firstHeaderRow = table.tHead?.rows?.[0];
    if (firstHeaderRow) {
      table.style.setProperty('--assignment-header-row-height', firstHeaderRow.offsetHeight + 'px');
    }
  };
  const applyWidths = () => {
    [...colgroup.children].forEach((col, i) => { col.style.width = widths[i] + 'px'; });
    table.style.width = widths.reduce((a,b) => a+b, 0) + 'px';
    syncStickyMetrics();
  };
  table.querySelectorAll('th').forEach((th, i) => {
    const handle = document.createElement('span'); handle.className = 'assignment-col-resize';
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; e.preventDefault(); e.stopPropagation();
      const start = e.clientX, initial = widths[i]; handle.setPointerCapture(e.pointerId);
      const move = (ev) => { widths[i] = Math.max(80, initial + ev.clientX - start); applyWidths(); };
      const stop = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', stop); handle.removeEventListener('pointercancel', stop); };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', stop); handle.addEventListener('pointercancel', stop);
    });
    th.appendChild(handle);
  });
  applyWidths();

  const filterRow = document.createElement('tr');
  filterRow.className = 'assignment-filter-row';
  const filterControls = new Map();
  const addSearchFilter = (columnIndex, placeholder) => {
    const th = document.createElement('th');
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'assignment-column-filter';
    input.placeholder = placeholder;
    input.setAttribute('aria-label', placeholder);
    th.appendChild(input);
    filterControls.set(columnIndex, input);
    return th;
  };
  const addSelectFilter = (columnIndex, label, resultFilter = false) => {
    const th = document.createElement('th');
    const select = document.createElement('select');
    select.className = 'assignment-column-filter';
    select.setAttribute('aria-label', label);
    select.innerHTML = resultFilter
      ? '<option value="">All</option><option value="__EMPTY__">Blank</option><option value="Passed">Passed</option><option value="Failed">Failed</option><option value="Blocked">Blocked</option><option value="Not Run">Not Run</option><option value="N/A">N/A</option>'
      : '<option value="">All</option>';
    th.appendChild(select);
    filterControls.set(columnIndex, select);
    return th;
  };
  filterRow.appendChild(addSearchFilter(0, 'Search ID'));
  filterRow.appendChild(addSearchFilter(1, 'Search title'));
  filterRow.appendChild(addSelectFilter(2, 'Filter Product Area'));
  filterRow.appendChild(addSearchFilter(3, 'Search automation script'));
  [4, 5, 6, 7].forEach((columnIndex) => filterRow.appendChild(addSelectFilter(columnIndex, 'Filter results', true)));
  [8, 9, 10].forEach(() => filterRow.appendChild(document.createElement('th')));
  table.tHead.appendChild(filterRow);

  const productAreaFilter = filterControls.get(2);
  const refreshProductAreaOptions = () => {
    const current = productAreaFilter.value;
    const values = [...new Set([...body.rows]
      .map((tr) => String(tr.cells[2]?.textContent || '').trim())
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    productAreaFilter.replaceChildren(new Option('All', ''), ...values.map((value) => new Option(value, value)));
    productAreaFilter.value = values.includes(current) ? current : '';
  };
  const applyFilters = () => {
    const idQuery = filterControls.get(0).value.trim().toLowerCase();
    const titleQuery = filterControls.get(1).value.trim().toLowerCase();
    const productArea = filterControls.get(2).value;
    const automationQuery = filterControls.get(3).value.trim().toLowerCase();
    [...body.rows].forEach((tr) => {
      const textAt = (index) => String(tr.cells[index]?.textContent || '').trim();
      const resultAt = (index) => tr.cells[index]?.querySelector('select')?.value || '';
      const matchesText =
        textAt(0).toLowerCase().includes(idQuery) &&
        textAt(1).toLowerCase().includes(titleQuery) &&
        textAt(3).toLowerCase().includes(automationQuery);
      const matchesProduct = !productArea || textAt(2) === productArea;
      const matchesResults = [4, 5, 6, 7].every((columnIndex) => {
        const selected = filterControls.get(columnIndex).value;
        if (!selected) return true;
        const value = resultAt(columnIndex);
        return selected === '__EMPTY__' ? !value : value === selected;
      });
      tr.hidden = !(matchesText && matchesProduct && matchesResults);
    });
  };
  filterControls.forEach((control) => {
    control.addEventListener(control.tagName === 'INPUT' ? 'input' : 'change', applyFilters);
  });
  section.addEventListener('change', (event) => {
    if (event.target.closest('#assignmentWorkbookRows')) applyFilters();
  });
  const filterObserver = new MutationObserver(() => {
    refreshProductAreaOptions();
    applyFilters();
    requestAnimationFrame(syncStickyMetrics);
  });
  filterObserver.observe(body, { childList: true });
  refreshProductAreaOptions();
  applyFilters();
  requestAnimationFrame(syncStickyMetrics);

  const getEditableCells = () => [...body.rows].map((tr) => [...tr.cells].slice(editableOffset));
  const bounds = () => !anchor || !focus ? null : ({r1:Math.min(anchor.r,focus.r),r2:Math.max(anchor.r,focus.r),c1:Math.min(anchor.c,focus.c),c2:Math.max(anchor.c,focus.c)});
  const paint = () => {
    const b = bounds();
    getEditableCells().forEach((row,r) => row.forEach((cell,c) => {
      cell.classList.toggle('grid-selected', !!b && r>=b.r1 && r<=b.r2 && c>=b.c1 && c<=b.c2);
      cell.classList.toggle('grid-active', !!focus && r===focus.r && c===focus.c);
    }));
  };
  const enhanceCells = () => getEditableCells().forEach((row,r) => row.forEach((cell,c) => {
    if (cell.dataset.gridReady) return; cell.dataset.gridReady='1'; cell.tabIndex=0;
    cell.addEventListener('mousedown', (e) => { if (!e.shiftKey || !anchor) anchor={r,c}; focus={r,c}; paint(); });
    cell.addEventListener('focusin', () => { if (!focus || focus.r!==r || focus.c!==c) { anchor={r,c}; focus={r,c}; paint(); } });
  }));
  new MutationObserver(enhanceCells).observe(body,{childList:true,subtree:false}); enhanceCells();

  const cellValue = (cell) => cell.querySelector('select,input')?.value ?? cell.textContent ?? '';
  const setCellValue = (cell, value, c) => {
    const control = cell.querySelector('select,input'); if (!control) return false;
    if (c < resultCount) {
      const normalized = normalizeResult(value); if (String(value).trim() && !normalized) return false;
      control.value = normalized;
      control.dispatchEvent(new Event('change',{bubbles:true}));
    } else {
      control.value = value;
      control.dispatchEvent(new Event('input',{bubbles:true}));
    }
    return true;
  };

  section.addEventListener('copy', (e) => {
    const b = bounds(); if (!b || !e.clipboardData) return;
    const cells=getEditableCells(), lines=[];
    for(let r=b.r1;r<=b.r2;r++){ const vals=[]; for(let c=b.c1;c<=b.c2;c++) vals.push(cellValue(cells[r][c])); lines.push(vals.join('\t')); }
    e.clipboardData.setData('text/plain',lines.join('\n')); e.preventDefault();
  });
  section.addEventListener('paste', (e) => {
    if (!focus) return; const text=e.clipboardData?.getData('text/plain'); if (text==null) return; e.preventDefault();
    const grid=text.replace(/\r/g,'').split('\n').filter((x,i,a)=>x || i<a.length-1).map((x)=>x.split('\t'));
    const cells=getEditableCells(); let last={...focus}, count=0;
    grid.forEach((vals,dr)=>vals.forEach((v,dc)=>{const r=focus.r+dr,c=focus.c+dc;if(cells[r]?.[c]&&setCellValue(cells[r][c],v,c)){last={r,c};count++;}}));
    anchor={...focus}; focus=last; paint();
    const status=document.querySelector('#assignmentWorkbookStatus'); if(status) status.textContent='Pasted '+count+' cell(s). Unsaved changes.';
  });

  const host=document.createElement('div'); host.className='assignment-import-row';
  host.innerHTML=`
    <div class="assignment-import-top">
      <div>
        <label for="importResultTarget">Import into</label>
        <select id="importResultTarget">
          <option value="0">Round 1 results</option>
          <option value="1">Round 2 results</option>
          <option value="2">Single run results</option>
          <option value="3">Manual run</option>
        </select>
      </div>
      <div class="assignment-import-actions">
        <button id="importResultCsv" type="button" class="secondary-button">Import Result CSV</button>
        <input id="resultCsvFile" type="file" accept=".csv,text/csv" hidden>
      </div>
      <p class="assignment-import-hint">Matches VSTS/Test ID to the tracker. If sources disagree, Passed wins over Failed.</p>
    </div>
    <div class="assignment-paste-import">
      <label for="testResultPaste">Paste TestResult output</label>
      <textarea id="testResultPaste" rows="4" spellcheck="false" placeholder="Paste runner output here, e.g. VSTS24153 Passed Stale"></textarea>
      <div class="assignment-import-actions">
        <button id="applyPastedResults" type="button" class="secondary-button" disabled>Apply Pasted Results</button>
        <button id="clearPastedResults" type="button" class="secondary-button" disabled>Clear</button>
      </div>
    </div>`;
  const firstActions=section.querySelector('.action-row'); firstActions.after(host);
  const target=host.querySelector('#importResultTarget');
  const csvBtn=host.querySelector('#importResultCsv');
  const csvInput=host.querySelector('#resultCsvFile');
  const pasteInput=host.querySelector('#testResultPaste');
  const applyPasteBtn=host.querySelector('#applyPastedResults');
  const clearPasteBtn=host.querySelector('#clearPastedResults');

  const importEntries=(entries,name)=>{
    const c=Number(target.value), rows=[...body.rows], byId=new Map(rows.map((tr)=>[String(tr.cells[0]?.textContent||'').trim(),tr]));
    const matchedIds=new Set(), changedIds=new Set(), unmatchedIds=new Set();
    entries.forEach((entry)=>{
      const id=String(entry.testCaseId);
      const tr=byId.get(id);
      if(!tr){ unmatchedIds.add(id); return; }
      matchedIds.add(id);
      const cell=tr.cells[editableOffset+c], control=cell?.querySelector('select'); if(!control)return;
      const next=mergeResult(control.value,entry.result);
      if(control.value!==next){control.value=next;control.dispatchEvent(new Event('change',{bubbles:true}));changedIds.add(id);}
    });
    const s=document.querySelector('#assignmentWorkbookStatus');
    if(s) {
      const unmatchedText=unmatchedIds.size ? `, ${unmatchedIds.size} not found` : '';
      s.textContent=`${name}: parsed ${entries.length} result row(s), matched ${matchedIds.size} case(s), updated ${changedIds.size} cell(s)${unmatchedText} in ${target.options[target.selectedIndex].text}.`;
    }
  };
  const syncImportButtons=()=>{
    const trackerReady=body.rows.length>0;
    const hasPaste=Boolean(pasteInput.value.trim());
    csvBtn.disabled=!trackerReady;
    applyPasteBtn.disabled=!trackerReady || !hasPaste;
    clearPasteBtn.disabled=!pasteInput.value;
  };
  new MutationObserver(syncImportButtons).observe(body,{childList:true});
  pasteInput.addEventListener('input',syncImportButtons);
  syncImportButtons();

  csvBtn.onclick=()=>csvInput.click();
  csvInput.onchange=async()=>{const f=csvInput.files?.[0]; if(!f)return; try{importEntries(parseResultCsv(await f.text()),f.name);}catch(err){const s=document.querySelector('#assignmentWorkbookStatus');if(s)s.textContent=err.message;}finally{csvInput.value='';}};
  applyPasteBtn.onclick=()=>{
    try{
      const entries=parseTestResultTxt(pasteInput.value);
      if(!entries.length) throw new Error('No VSTS TestResult rows were found in the pasted text.');
      importEntries(entries,'Pasted TestResult');
    }catch(err){const s=document.querySelector('#assignmentWorkbookStatus');if(s)s.textContent=err.message;}
  };
  clearPasteBtn.onclick=()=>{pasteInput.value='';syncImportButtons();pasteInput.focus();};
})();
