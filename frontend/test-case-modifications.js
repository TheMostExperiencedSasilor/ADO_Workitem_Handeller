function createModificationHistory({ $, node, request, rich, syncCalendar, api, itemName }) {
  const element = (name) => $(`tcModHistory${name}`);
  const pageSize = 20;
  const filterNames = ['Author', 'Type', 'From', 'To'];
  const fieldTypes = {
    'System.State': 'State',
    'System.AreaPath': 'Area Path',
    'System.IterationPath': 'Iteration Path',
    'System.AssignedTo': 'Assigned To',
    'Microsoft.VSTS.TCM.Steps': 'Test Steps',
  };
  const linkNames = {
    'System.LinkTypes.Hierarchy-Forward': 'Child work item',
    'System.LinkTypes.Hierarchy-Reverse': 'Parent work item',
    'System.LinkTypes.Related': 'Related work item',
    'ArtifactLink': 'Artifact link',
    'Hyperlink': 'Hyperlink',
  };
  const icons = {
    Created: 'M12 5v14m-7-7h14',
    Attachment: 'M8 13.5l6-6a3 3 0 0 1 4.2 4.2l-7.1 7.1a4.1 4.1 0 0 1-5.8-5.8l7.1-7.1',
    Link: 'M10 13.5l4-4m-5 7-1 1a3 3 0 0 1-4.2-4.2l3-3m8 3 3-3a3 3 0 0 0-4.2-4.2l-1 1',
    'Test Steps': 'm3 6 2 2 4-4m-6 11 2 2 4-4m3-6h9m-9 9h9',
    Fields: 'm5 16-1 4 4-1L19 8l-3-3L5 16Zm9-9 3 3',
  };
  let caseId, fields, loadVersion = 0;
  let rows = [], selected = null, page = 0, busy = false, loaded = false, error = '';

  const relationType = (relation) => relation.type === 'AttachedFile' ? 'Attachment' : 'Link';
  const relationLabel = (relation) => `${relation.operation[0].toUpperCase()}${relation.operation.slice(1)} ${relationType(relation).toLowerCase()}`;
  const authorKey = (update) => update.authorId || update.author;
  const revision = (update) => update.revision == null ? 'Update #' + update.id : 'Revision ' + update.revision;

  function normalize(update) {
    const fieldChanges = update.fields.map((change) => ({
      ...change,
      label: fields.get(change.field)?.name || fieldTypes[change.field] || change.label,
    }));
    const types = new Set();
    if (update.created) types.add('Created');
    fieldChanges.forEach((change) => types.add(fieldTypes[change.field] || 'Fields'));
    update.relations.forEach((relation) => types.add(relationType(relation)));
    if (!types.size) types.add('Other');
    let summary = `Updated ${itemName}`;
    if (update.created) summary = `Created ${itemName}`;
    else if (update.relations.length === 1 && !fieldChanges.length) summary = relationLabel(update.relations[0]);
    else if (fieldChanges.length === 1 && !update.relations.length) summary = 'Changed ' + fieldChanges[0].label;
    else if (fieldChanges.length && !update.relations.length) summary = `Modified ${fieldChanges.length} fields`;
    else if (update.relations.length) summary = `Modified ${fieldChanges.length + update.relations.length} items`;
    return { ...update, fields: fieldChanges, summary, types, time: testCaseDateTime.parse(update.changedAt)?.getTime() ?? -Infinity };
  }

  function icon(type) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    const path = document.createElementNS(ns, 'path');
    const attributes = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' };
    Object.entries(attributes).forEach(([name, value]) => svg.setAttribute(name, value));
    path.setAttribute('d', icons[type] || icons.Fields);
    svg.appendChild(path);
    return svg;
  }

  function time(value) {
    const timestamp = node('time', testCaseDateTime.format(value));
    if (testCaseDateTime.parse(value)) {
      timestamp.dateTime = value;
      timestamp.title = value;
    }
    return timestamp;
  }

  function textValue(value) {
    if (value == null || value === '') return '—';
    if (Array.isArray(value)) return value.map(textValue).join(', ') || '—';
    if (typeof value === 'object') return value.displayName || value.name || value.uniqueName || 'Value unavailable';
    return String(value);
  }

  function fieldValue(change, value) {
    if (testCaseDateTime.isDateField(fields.get(change.field), value)) return time(value);
    if (fields.get(change.field)?.type === 'html' || change.field === 'System.Description' || change.field === 'System.History') {
      return value == null || value === '' ? node('span', '—') : rich(value, testStepMarkdown.parseHtml);
    }
    return node('div', textValue(value), 'tc-mod-value');
  }

  function pair(before, after, removed = false) {
    const values = node('div', null, 'tc-mod-pair');
    for (const [label, value, style] of [['Previous', before, removed ? ' removed' : ''], ['Updated', after, after ? ' updated' : '']]) {
      const column = node('div', null, 'tc-mod-side' + style);
      column.append(node('span', label, 'tc-mod-label'), value || node('span', '—'));
      values.appendChild(column);
    }
    return values;
  }

  function stepSnapshot(steps) {
    if (steps == null) return node('p', 'Version unavailable');
    if (!steps.length) return node('p', 'No steps');
    const list = node('ol', null, 'tc-mod-step-list');
    steps.forEach((step) => {
      const item = node('li');
      item.append(node('strong', `Step ${step.number}`), stepValue(step));
      list.appendChild(item);
    });
    return list;
  }

  function stepValue(step, other = null) {
    if (!step) return null;
    const values = node('dl', null, 'tc-mod-step-values');
    for (const [name, label] of [['action', 'Action'], ['expected', 'Expected result']]) {
      if (other && step[name] === other[name]) continue;
      const cell = node('dd');
      cell.appendChild(rich(step[name], testStepMarkdown.parseHtml));
      values.append(node('dt', label), cell);
    }
    return values;
  }

  function stepChanges(comparison) {
    const body = node('div');
    if (comparison.note) body.appendChild(node('p', comparison.note, 'tc-hint'));
    if (comparison.warning) {
      body.append(node('p', comparison.warning, 'tc-hint'), pair(stepSnapshot(comparison.before), stepSnapshot(comparison.after)));
      return body;
    }
    if (!comparison.changes.length) body.appendChild(node('p', 'No differences in step text or order were found.', 'tc-hint'));
    comparison.changes.forEach(({ before, after, moved }) => {
      let label = after ? `Step ${after.number} updated` : `Step ${before.number} removed`;
      if (!before) label = `Step ${after.number} added`;
      else if (after && before.number !== after.number) label += ` (previously ${before.number})`;
      if (moved) label = before.number === after.number
        ? `Step ${after.number} changed relative order`
        : `Step ${before.number} moved to ${after.number}`;
      const previous = stepValue(before, after), updated = stepValue(after, before);
      body.appendChild(node('h6', label));
      if (previous?.childNodes.length || updated?.childNodes.length) body.appendChild(pair(previous, updated, !after));
    });
    return body;
  }

  function renderDetails(update) {
    const details = element('Details');
    details.replaceChildren();
    const heading = node('div', null, 'tc-mod-detail-heading');
    heading.append(node('h5', update.summary), node('strong', update.author || 'Unknown author'), time(update.changedAt),
      node('span', revision(update), 'tc-mod-revision'));
    details.appendChild(heading);
    update.fields.forEach((change) => {
      const section = node('section', null, 'tc-mod-delta');
      section.appendChild(node('h6', change.label));
      if (change.steps) section.appendChild(stepChanges(change.steps));
      else section.appendChild(pair(
        change.before == null ? null : fieldValue(change, change.before),
        change.after == null ? null : fieldValue(change, change.after),
        change.after == null,
      ));
      details.appendChild(section);
    });
    update.relations.forEach((relation) => {
      const section = node('section', null, 'tc-mod-delta');
      const value = node('div', null, 'tc-mod-value');
      value.appendChild(node('strong', relation.name || relation.target || 'Target unavailable'));
      if (relation.name && relation.target) value.appendChild(node('div', relation.target));
      if (relation.type && relation.type !== 'AttachedFile') value.appendChild(node('div', linkNames[relation.type] || relation.type));
      if (relation.comment) value.appendChild(node('div', relation.comment));
      section.appendChild(node('h6', relationLabel(relation)));
      if (relation.operation === 'updated') section.appendChild(value);
      else if (relation.operation === 'removed') section.appendChild(pair(value, null, true));
      else section.appendChild(pair(null, value));
      details.appendChild(section);
    });
    if (!update.fields.length && !update.relations.length) {
      details.appendChild(node('p', 'ADO did not provide field or link changes for this update.', 'tc-hint'));
    }
  }

  function populateOptions(name, options) {
    const select = element(name);
    select.replaceChildren(select.options[0]);
    [...options.entries()].sort((a, b) => a[1].localeCompare(b[1])).forEach(([value, label]) => {
      const option = node('option', label);
      option.value = value;
      select.appendChild(option);
    });
  }

  function render() {
    const { value: from } = element('From');
    const { value: to } = element('To');
    const { value: author } = element('Author');
    const { value: type } = element('Type');
    const invalidRange = Boolean(from && to && from > to);
    const matches = invalidRange ? [] : rows.filter((row) => (!author || authorKey(row) === author)
      && (!type || row.types.has(type)) && testCaseDateTime.inRange(row.changedAt, from, to));
    const pages = Math.ceil(matches.length / pageSize);
    page = Math.min(page, Math.max(0, pages - 1));
    const visible = matches.slice(page * pageSize, (page + 1) * pageSize);
    const current = visible.find((row) => row.id === selected) || visible[0];
    selected = current?.id ?? null;
    const status = element('Status');
    status.classList.toggle('tc-error', Boolean(error || invalidRange));
    if (error) status.textContent = error;
    else if (busy) status.textContent = 'Loading modification history…';
    else if (invalidRange) status.textContent = 'From date must be on or before To date.';
    else if (loaded && !rows.length) status.textContent = `No modification history returned by ADO for this ${itemName.toLowerCase()}.`;
    else if (loaded && !visible.length) status.textContent = 'No modifications match the current filters.';
    else status.textContent = '';
    element('').setAttribute('aria-busy', String(busy));
    element('Progress').hidden = !busy;
    element('Retry').hidden = !error;
    element('Content').hidden = !current;
    element('Page').textContent = `Page ${page + 1} of ${pages} · ${matches.length} updates`;
    element('Prev').disabled = page === 0;
    element('Next').disabled = page >= pages - 1;
    const timeline = element('Timeline');
    timeline.replaceChildren();
    element('Details').replaceChildren();
    if (!current) return;

    for (const row of visible) {
      const item = node('li');
      const button = node('button', null, 'tc-mod-entry');
      button.type = 'button';
      button.setAttribute('aria-current', String(row.id === selected));
      button.setAttribute('aria-controls', element('Details').id);
      const label = node('span', null, 'tc-mod-entry-label');
      label.append(node('strong', row.author || 'Unknown author'), node('span', row.summary), time(row.changedAt));
      button.append(icon(row.types.values().next().value), label, node('span', revision(row), 'tc-mod-revision'));
      button.addEventListener('click', () => {
        timeline.querySelector('[aria-current="true"]')?.setAttribute('aria-current', 'false');
        selected = row.id;
        button.setAttribute('aria-current', 'true');
        renderDetails(row);
      });
      item.appendChild(button);
      timeline.appendChild(item);
    }
    timeline.scrollTop = 0;
    renderDetails(current);
  }

  function filter() { page = 0; render(); }
  filterNames.forEach((name) => element(name).addEventListener('input', () => {
    filter();
    if (name === 'From' || name === 'To') syncCalendar();
  }));
  element('Clear').addEventListener('click', () => {
    filterNames.forEach((name) => { element(name).value = ''; });
    syncCalendar();
    filter();
  });
  element('Prev').addEventListener('click', () => { page--; render(); });
  element('Next').addEventListener('click', () => { page++; render(); });

  function reset(id = null, entries = []) {
    loadVersion++;
    caseId = id;
    fields = new Map(entries.map((field) => [field.referenceName, field]));
    rows = []; selected = null; page = 0; busy = false; loaded = false; error = '';
    populateOptions('Author', new Map());
    populateOptions('Type', new Map());
    filterNames.forEach((name) => { element(name).value = ''; });
    syncCalendar();
    render();
  }

  async function load() {
    if (!caseId || busy || loaded || error) return;
    const version = loadVersion;
    busy = true;
    render();
    try {
      const data = await request(`${api}/${caseId}/modification-history`);
      if (version !== loadVersion) return;
      if (!Array.isArray(data.updates)) throw new Error('ADO returned an invalid modification history response.');
      rows = data.updates.map(normalize).sort((a, b) => b.time - a.time || b.id - a.id);
      populateOptions('Author', new Map(rows.filter(authorKey).map((row) => [authorKey(row), row.author || 'Unknown author'])));
      populateOptions('Type', new Map(rows.flatMap((row) => [...row.types].map((type) => [type, type]))));
      loaded = true;
    } catch (failure) {
      if (version === loadVersion) error = failure.message;
    } finally {
      if (version === loadVersion) { busy = false; render(); }
    }
  }

  element('Retry').addEventListener('click', () => { error = ''; load(); });
  return { reset, load, filter, latest: () => rows.find((row) => Number.isFinite(row.time))?.changedAt };
}
