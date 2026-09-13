(() => {
  'use strict';

  if (window.__testResultsSummaryDashboardInitialized) return;
  window.__testResultsSummaryDashboardInitialized = true;

  const panel = document.querySelector('#testResultsSummaryPanel');
  const results = document.querySelector('#testSuiteResults');
  const sourceSummary = document.querySelector('#testSuiteSummary');
  const rowsBody = document.querySelector('#testSuiteRows');
  const sourceUrl = document.querySelector('#testPlanUrl');
  const loadButton = document.querySelector('#loadTestSuiteButton');
  if (!panel || !results || !sourceSummary || !rowsBody || !sourceUrl || !loadButton) return;

  const heading = panel.querySelector('#testPlanHeading');
  if (heading) heading.textContent = 'Test Suite Summary';

  const form = document.querySelector('#testSuiteForm');
  if (form && !document.querySelector('#summaryIntro')) {
    const intro = document.createElement('p');
    intro.id = 'summaryIntro';
    intro.className = 'summary-intro';
    intro.textContent = 'Your suite command center: execution progress, ownership, attention items, and shortcuts into planning and result logging.';
    form.before(intro);
  }

  const dashboard = document.createElement('section');
  dashboard.id = 'testSummaryDashboard';
  dashboard.className = 'test-summary-dashboard';
  dashboard.innerHTML = `
    <div class="summary-card-grid" id="summaryCardGrid"></div>

    <div class="summary-progress-card">
      <div class="summary-progress-heading">
        <div>
          <strong>Execution progress</strong>
          <span id="summaryExecutionText" class="mini-status">Waiting for suite data</span>
        </div>
        <strong id="summaryExecutionPercent">0%</strong>
      </div>
      <progress id="summaryExecutionProgress" max="100" value="0"></progress>
    </div>

    <div class="summary-dashboard-grid">
      <section class="summary-dashboard-panel">
        <div class="summary-section-heading">
          <h3>Needs attention</h3>
          <span class="mini-status">Actionable now</span>
        </div>
        <div id="summaryAttention" class="summary-attention-grid"></div>
      </section>

      <section class="summary-dashboard-panel">
        <div class="summary-section-heading">
          <h3>Tester overview</h3>
          <span class="mini-status">Current test points</span>
        </div>
        <div id="summaryTesterOverview" class="summary-tester-list"></div>
      </section>
    </div>

    <div class="summary-quick-actions">
      <strong>Quick actions</strong>
      <button id="summaryOpenPlanner" type="button">Open Test Planner</button>
      <button id="summaryOpenTracker" type="button" class="secondary-button">Open Result Tracker</button>
      <button id="summaryOpenCharts" type="button" class="secondary-button">View Charts</button>
      <button id="summaryRefreshSuite" type="button" class="secondary-button">Refresh Suite</button>
    </div>
  `;

  sourceSummary.insertAdjacentElement('afterend', dashboard);
  sourceSummary.classList.add('summary-source-meta');

  const details = document.createElement('details');
  details.id = 'summaryTestPointDetails';
  details.className = 'summary-test-point-details';
  const detailsSummary = document.createElement('summary');
  detailsSummary.textContent = 'Test point details';
  details.appendChild(detailsSummary);

  const detailNodes = [
    results.querySelector('.test-suite-filters'),
    document.querySelector('#testSuiteFilterStatus'),
    document.querySelector('#clearTestFilters')?.closest('.action-row'),
    [...results.children].find((node) => node.tagName === 'P' && node.classList.contains('mini-status') && node.id !== 'testSuiteFilterStatus'),
    results.querySelector('.test-suite-table-wrap'),
  ].filter(Boolean);

  for (const node of detailNodes) details.appendChild(node);
  results.appendChild(details);

  const cardGrid = dashboard.querySelector('#summaryCardGrid');
  const progress = dashboard.querySelector('#summaryExecutionProgress');
  const progressText = dashboard.querySelector('#summaryExecutionText');
  const progressPercent = dashboard.querySelector('#summaryExecutionPercent');
  const attention = dashboard.querySelector('#summaryAttention');
  const testerOverview = dashboard.querySelector('#summaryTesterOverview');

  const readSummaryValues = () => {
    const values = {};
    for (const span of sourceSummary.querySelectorAll('span')) {
      const text = span.textContent || '';
      const split = text.indexOf(':');
      if (split < 0) continue;
      const key = text.slice(0, split).trim();
      const value = text.slice(split + 1).trim();
      values[key] = value;
    }
    return values;
  };

  const numberValue = (value) => {
    const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const makeCard = (label, value, className = '') => {
    const card = document.createElement('div');
    card.className = `summary-metric-card ${className}`.trim();
    const number = document.createElement('strong');
    number.textContent = String(value);
    const caption = document.createElement('span');
    caption.textContent = label;
    card.append(number, caption);
    return card;
  };

  const readTesterRows = () => {
    const testers = new Map();
    let unassigned = 0;
    for (const row of rowsBody.querySelectorAll('tr')) {
      const tester = String(row.children[3]?.textContent || '').trim() || 'Unassigned';
      testers.set(tester, (testers.get(tester) || 0) + 1);
      if (tester === 'Unassigned') unassigned += 1;
    }
    return { testers, unassigned };
  };

  const renderDashboard = () => {
    const values = readSummaryValues();
    const total = numberValue(values.Total);
    const passed = numberValue(values.Passed);
    const failed = numberValue(values.Failed);
    const active = numberValue(values['Other / Not Run']);
    const executed = Math.min(total, passed + failed);
    const percent = total ? (executed / total) * 100 : 0;

    cardGrid.replaceChildren(
      makeCard('Total', total),
      makeCard('Passed', passed, 'passed'),
      makeCard('Active', active, 'active'),
      makeCard('Failed', failed, 'failed'),
    );

    progress.value = percent;
    progressPercent.textContent = `${percent.toFixed(1)}%`;
    progressText.textContent = total
      ? `${executed} of ${total} test point(s) executed`
      : 'Waiting for suite data';

    const { testers, unassigned } = readTesterRows();
    attention.replaceChildren(
      makeCard('Failed', failed, failed ? 'failed' : ''),
      makeCard('Active / Not Run', active, active ? 'active' : ''),
      makeCard('Unassigned', unassigned, unassigned ? 'active' : ''),
    );

    const testerFragment = document.createDocumentFragment();
    const sorted = [...testers.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const [name, count] of sorted.slice(0, 10)) {
      const item = document.createElement('div');
      item.className = 'summary-tester-row';
      const testerName = document.createElement('span');
      testerName.textContent = name;
      testerName.title = name;
      const testerCount = document.createElement('strong');
      testerCount.textContent = String(count);
      item.append(testerName, testerCount);
      testerFragment.appendChild(item);
    }
    if (!sorted.length) {
      const empty = document.createElement('p');
      empty.className = 'mini-status';
      empty.textContent = 'No tester data loaded yet.';
      testerFragment.appendChild(empty);
    }
    testerOverview.replaceChildren(testerFragment);
  };

  const activateSubtab = (tabId) => {
    const tab = document.querySelector(tabId);
    if (tab) tab.click();
  };

  dashboard.querySelector('#summaryOpenPlanner').addEventListener('click', () => activateSubtab('#testResultsPlannerTab'));
  dashboard.querySelector('#summaryOpenTracker').addEventListener('click', () => activateSubtab('#testResultsTrackerTab'));
  dashboard.querySelector('#summaryOpenCharts').addEventListener('click', () => activateSubtab('#testResultsChartsTab'));
  dashboard.querySelector('#summaryRefreshSuite').addEventListener('click', () => {
    if (!sourceUrl.value.trim() || loadButton.disabled) return;
    form?.requestSubmit?.();
  });

  const summaryObserver = new MutationObserver(renderDashboard);
  summaryObserver.observe(sourceSummary, { childList: true, subtree: true, characterData: true });
  const rowsObserver = new MutationObserver(renderDashboard);
  rowsObserver.observe(rowsBody, { childList: true, subtree: true, characterData: true });

  renderDashboard();
})();
