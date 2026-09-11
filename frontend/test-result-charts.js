(() => {
  const form = document.querySelector('#testChartsForm');
  const urlInput = document.querySelector('#testChartsUrl');
  const loadButton = document.querySelector('#loadTestChartsButton');
  const status = document.querySelector('#testChartsStatus');
  const content = document.querySelector('#testChartsContent');
  const outcomeHost = document.querySelector('#outcomeChart');
  const testerHost = document.querySelector('#testerChart');
  const totalLabel = document.querySelector('#outcomeChartTotal');
  if (!form || !urlInput || !loadButton || !status || !content || !outcomeHost || !testerHost) return;

  const outcomeOrder = ['Passed', 'Failed', 'Blocked', 'Not Run', 'Other'];
  const outcomeClass = {
    Passed: 'passed',
    Failed: 'failed',
    Blocked: 'blocked',
    'Not Run': 'not-run',
    Other: 'other',
  };

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
    status.classList.toggle('ok', !error && Boolean(message));
  }

  function normalizeOutcome(value) {
    const text = String(value || '').trim();
    if (outcomeOrder.includes(text)) return text;
    if (/not\s*run|not\s*executed|unspecified/i.test(text)) return 'Not Run';
    return text ? 'Other' : 'Other';
  }

  function makeOutcomeCounts(points) {
    const counts = Object.fromEntries(outcomeOrder.map((name) => [name, 0]));
    for (const point of points) counts[normalizeOutcome(point.outcome)] += 1;
    return counts;
  }

  function renderOutcome(points) {
    const counts = makeOutcomeCounts(points);
    const total = points.length;
    totalLabel.textContent = total + ' test point' + (total === 1 ? '' : 's');
    const fragment = document.createDocumentFragment();
    for (const name of outcomeOrder) {
      const count = counts[name];
      if (!count && name === 'Other') continue;
      const row = document.createElement('div');
      row.className = 'chart-bar-row';
      const label = document.createElement('div');
      label.className = 'chart-bar-label';
      label.textContent = name;
      const track = document.createElement('div');
      track.className = 'chart-bar-track';
      const fill = document.createElement('div');
      fill.className = 'chart-bar-fill ' + outcomeClass[name];
      fill.style.width = total ? ((count / total) * 100) + '%' : '0%';
      track.appendChild(fill);
      const value = document.createElement('div');
      value.className = 'chart-bar-value';
      value.textContent = count + (total ? ' (' + ((count / total) * 100).toFixed(1) + '%)' : '');
      row.append(label, track, value);
      fragment.appendChild(row);
    }
    outcomeHost.replaceChildren(fragment);
  }

  function groupByTester(points) {
    const testers = new Map();
    for (const point of points) {
      const name = String(point.tester || '').trim() || 'Unassigned';
      if (!testers.has(name)) testers.set(name, Object.fromEntries(outcomeOrder.map((outcome) => [outcome, 0])));
      testers.get(name)[normalizeOutcome(point.outcome)] += 1;
    }
    return [...testers.entries()]
      .map(([name, counts]) => ({ name, counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0) }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }

  function renderTester(points) {
    const groups = groupByTester(points);
    const fragment = document.createDocumentFragment();

    const legend = document.createElement('div');
    legend.className = 'chart-legend';
    for (const name of outcomeOrder) {
      const item = document.createElement('span');
      item.className = 'chart-legend-item';
      const swatch = document.createElement('i');
      swatch.className = 'chart-legend-swatch ' + outcomeClass[name];
      item.append(swatch, document.createTextNode(name));
      legend.appendChild(item);
    }
    fragment.appendChild(legend);

    if (!groups.length) {
      const empty = document.createElement('p');
      empty.className = 'chart-empty';
      empty.textContent = 'No tester data is available for this suite.';
      fragment.appendChild(empty);
      testerHost.replaceChildren(fragment);
      return;
    }

    for (const group of groups) {
      const row = document.createElement('div');
      row.className = 'tester-chart-row';
      const label = document.createElement('div');
      label.className = 'tester-chart-label';
      label.textContent = group.name;
      label.title = group.name;
      const track = document.createElement('div');
      track.className = 'tester-chart-track';
      for (const name of outcomeOrder) {
        const count = group.counts[name];
        if (!count) continue;
        const segment = document.createElement('div');
        segment.className = 'tester-chart-segment ' + outcomeClass[name];
        segment.style.width = ((count / group.total) * 100) + '%';
        segment.title = name + ': ' + count;
        track.appendChild(segment);
      }
      const total = document.createElement('div');
      total.className = 'tester-chart-total';
      total.textContent = String(group.total);
      row.append(label, track, total);
      fragment.appendChild(row);
    }
    testerHost.replaceChildren(fragment);
  }

  function renderCharts(data) {
    const points = Array.isArray(data.testPoints) ? data.testPoints : [];
    renderOutcome(points);
    renderTester(points);
    content.hidden = false;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (loadButton.disabled) return;
    const url = urlInput.value.trim();
    if (!url) {
      setStatus('Test Plan URL is required.', true);
      return;
    }

    loadButton.disabled = true;
    content.hidden = true;
    setStatus('Loading chart data…');
    try {
      const response = await fetch('/api/test-plans/read-suite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to load chart data.');
      renderCharts(data);
      setStatus('Charts loaded for Test Plan ' + data.planId + ', Suite ' + data.suiteId + '.');
    } catch (error) {
      setStatus(error.message || 'Unable to load chart data.', true);
    } finally {
      loadButton.disabled = false;
    }
  });
})();