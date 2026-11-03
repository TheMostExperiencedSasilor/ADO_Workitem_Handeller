(() => {
  const $ = id => document.getElementById(id);
  let rows = [], selected = null, sort = 'date', ascending = false, generation = 0;
  let page = 1, pageCount = 0, loading = false;
  const status = message => { $('repoStatus').textContent = message; };
  async function api(path, options) {
    const response = await fetch('/api/repo-history' + path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
  $('repoConnect').addEventListener('submit', async e => {
    e.preventDefault(); loading = false; page = 1; generation++; $('repoLoad').disabled = true; rows = []; selected = null; render();
    const button = e.submitter; button.disabled = true; status('Connecting…');
    try {
      const data = await api('/connect', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url:$('repoUrl').value, pat:$('repoPat').value})});
      $('repoPat').value = ''; $('repoBranch').replaceChildren();
      for (const branch of data.branches) { const option = new Option(branch, branch); $('repoBranch').add(option); }
      if (data.defaultBranch) $('repoBranch').value = data.defaultBranch;
      $('repoLoad').disabled = !data.branches.length; status(`Connected to ${data.name}. Choose a branch and load history.`);
    } catch (err) { status(err.message); } finally { button.disabled = false; }
  });
  $('repoDisconnect').onclick = async () => { loading = false; page = 1; generation++; try { await api('/disconnect', {method:'POST'}); } catch (_) {} rows=[]; selected=null; $('repoBranch').replaceChildren(); $('repoPat').value=''; $('repoLoad').disabled=true; status('Not connected'); render(); };
  $('repoLoad').onclick = async () => {
    const token = ++generation; rows=[]; selected=null; page=1; loading=true; render(); $('repoLoad').disabled=true;
    try {
      let skip=0, count=0;
      while (true) {
        const data = await api(`/commits?branch=${encodeURIComponent($('repoBranch').value)}&skip=${skip}`);
        if (token !== generation) return;
        for (const commit of data.commits) {
          let changeSkip=0, more;
          do {
            const result = await api(`/changes/${commit.commitId}?skip=${changeSkip}`);
            if (token !== generation) return;
            for (const change of result.changes) {
              if (change.item?.gitObjectType !== 'blob') continue;
              rows.push({date:commit.author?.date || '', author:commit.author?.name || '', email:commit.author?.email || '', path:change.item.path || '', change:change.changeType || '', message:commit.comment || '', commit:commit.commitId});
            }
            more=result.hasMore; changeSkip+=result.changes.length;
            if (more && !result.changes.length) throw new Error('Could not continue loading changes.');
          } while (more);
          count++; status(`Loading history: ${count} commits, ${rows.length} file changes…`); render();
        }
        if (data.commits.length < 50) break;
        skip+=data.commits.length;
      }
      status(`History loaded: ${count} commits on ${$('repoBranch').value}.`);
    } catch (err) { if(token === generation) status(`History incomplete: ${err.message}`); }
    finally { if(token === generation) { loading=false; $('repoLoad').disabled=false; render(); } }
  };
  function render() {
    const author=$('repoAuthor').value.toLowerCase(), file=$('repoFile').value.toLowerCase(), from=$('repoFrom').value, to=$('repoTo').value;
    const filtered=rows.filter(r => (!selected || r.path===selected) && (r.author+' '+r.email).toLowerCase().includes(author) && r.path.toLowerCase().includes(file) && (!from || r.date.slice(0,10)>=from) && (!to || r.date.slice(0,10)<=to) && (!$('repoVsts').checked || /(?:^|\/)VSTS\d+\.cs$/i.test(r.path)));
    filtered.sort((a,b)=>String(a[sort]).localeCompare(String(b[sort]))*(ascending?1:-1));
    pageCount = Math.ceil(filtered.length / Number($('repoPageSize').value));
    page = Math.max(1, Math.min(page, pageCount || 1));
    $('repoPageTotal').textContent = `of ${pageCount}${loading ? ' so far' : ''}`;
    if (document.activeElement !== $('repoPage')) $('repoPage').value = page;
    $('repoFirst').disabled = $('repoPrev').disabled = page <= 1;
    $('repoNext').disabled = $('repoLast').disabled = page >= pageCount;
    $('repoRows').replaceChildren();
    const size = Number($('repoPageSize').value);
    for (const r of filtered.slice((page - 1) * size, page * size)) {
      const tr=document.createElement('tr');
      for (const value of [r.date.replace('T',' ').slice(0,19),r.author,r.path,r.change,r.message]) {
        const td=document.createElement('td');
        if(value===r.path) { const button=document.createElement('button'); button.type='button'; button.className='repo-file-button'; button.textContent=value; button.onclick=()=>{selected=r.path;page=1;render();}; td.append(button); }
        else td.textContent=value;
        tr.append(td);
      }
      $('repoRows').append(tr);
    }
    $('repoAll').hidden=!selected;
    $('repoCount').textContent = `${filtered.length} file changes${loading ? ' loaded so far' : ''}${selected ? ' for ' + selected : ''}`;
  }
  for (const id of ['repoAuthor','repoFile','repoFrom','repoTo','repoVsts']) $(id).addEventListener('input',()=>{page=1;render();});
  $('repoClear').onclick=()=>{page=1;for(const id of ['repoAuthor','repoFile','repoFrom','repoTo']) $(id).value=''; $('repoVsts').checked=false; render();};
  $('repoAll').onclick=()=>{selected=null;page=1;render();};
  $('repoPageSize').onchange=()=>{page=1;render();};
  function go(n) { page = n; $('repoPageMessage').textContent=''; render(); $('repoPage').value=page; }
  $('repoFirst').onclick=()=>go(1); $('repoPrev').onclick=()=>go(page-1);
  $('repoNext').onclick=()=>go(page+1); $('repoLast').onclick=()=>go(pageCount);
  function typedPage() { const n=Number($('repoPage').value); if (!Number.isInteger(n) || n<1 || n>pageCount) { $('repoPageMessage').textContent = loading ? 'Page not loaded yet.' : 'Enter an available page number.'; return; } go(n); }
  $('repoGo').onclick=typedPage; $('repoPage').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();typedPage();}};
  document.querySelectorAll('.repo-table th button').forEach(button=>button.onclick=()=>{ascending=sort===button.dataset.sort?!ascending:true;sort=button.dataset.sort;render();});
})();
