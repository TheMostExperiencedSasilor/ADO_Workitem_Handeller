(() => {
  const TAB_LABELS = [
    'Setup',
    'Test Results',
    'Work Items',
    'Read',
    'Analyze',
    'Draft',
    'Create / Edit',
    'Output',
  ];

  const DEFAULT_TAB_INDEX = 1;

  function initializeMainTabs() {
    const layout = document.querySelector('main.layout');
    if (!layout || document.querySelector('.main-tabs')) return;

    const panels = [...layout.querySelectorAll(':scope > section.panel')];
    if (!panels.length) return;

    const tabList = document.createElement('nav');
    tabList.className = 'main-tabs';
    tabList.setAttribute('role', 'tablist');
    tabList.setAttribute('aria-label', 'Application sections');

    const tabs = [];

    function slugFor(label) {
      return label
        .toLowerCase()
        .replace(/\s*\/\s*/g, '-')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }

    function activateTab(index, updateHash = false) {
      tabs.forEach((tab, tabIndex) => {
        const active = tabIndex === index;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        panels[tabIndex].hidden = !active;
        panels[tabIndex].classList.toggle('active', active);
      });

      if (updateHash) {
        history.replaceState(null, '', `#${slugFor(tabs[index].textContent)}`);
      }
    }

    panels.forEach((panel, index) => {
      const panelId = `main-tab-panel-${index}`;
      const tabId = `main-tab-${index}`;
      const button = document.createElement('button');

      panel.id = panelId;
      panel.classList.add('main-tab-panel');
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tabId);

      button.type = 'button';
      button.id = tabId;
      button.className = 'main-tab';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', panelId);
      button.textContent = TAB_LABELS[index]
        || panel.querySelector('h2')?.textContent?.trim()
        || `Section ${index + 1}`;

      tabs.push(button);
      tabList.appendChild(button);

      button.addEventListener('click', () => activateTab(index, true));
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();

        let nextIndex = index;
        if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = tabs.length - 1;

        activateTab(nextIndex, true);
        tabs[nextIndex].focus();
      });
    });

    layout.before(tabList);

    const hash = window.location.hash.slice(1).toLowerCase();
    const hashIndex = tabs.findIndex((tab) => slugFor(tab.textContent) === hash);
    activateTab(hashIndex >= 0 ? hashIndex : DEFAULT_TAB_INDEX);
  }

  function ensureTestPlannerSubtab() {
    const summaryTab = document.querySelector('#testResultsSummaryTab');
    const summaryPanel = document.querySelector('#testResultsSummaryPanel');
    if (!summaryTab || !summaryPanel || document.querySelector('#testResultsPlannerTab')) return;

    const plannerTab = document.createElement('button');
    plannerTab.id = 'testResultsPlannerTab';
    plannerTab.className = 'test-results-subtab';
    plannerTab.type = 'button';
    plannerTab.setAttribute('role', 'tab');
    plannerTab.setAttribute('aria-selected', 'false');
    plannerTab.setAttribute('aria-controls', 'testResultsPlannerPanel');
    plannerTab.tabIndex = -1;
    plannerTab.textContent = 'Test Planner';
    summaryTab.insertAdjacentElement('afterend', plannerTab);

    const plannerPanel = document.createElement('div');
    plannerPanel.id = 'testResultsPlannerPanel';
    plannerPanel.className = 'test-results-subpanel';
    plannerPanel.setAttribute('role', 'tabpanel');
    plannerPanel.setAttribute('aria-labelledby', 'testResultsPlannerTab');
    plannerPanel.hidden = true;
    summaryPanel.insertAdjacentElement('afterend', plannerPanel);
  }

  function loadWorkspaceAssets() {
    const styles = [
      ['test-planner.css', 'test-planner-style'],
      ['test-planner-enhancements.css', 'test-planner-enhancements-style'],
      ['test-planner-layout.css', 'test-planner-layout-style'],
    ];

    for (const [href, marker] of styles) {
      if (document.querySelector(`link[data-${marker}]`)) continue;
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = href;
      style.dataset[marker.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = '1';
      document.head.appendChild(style);
    }

    const scripts = [
      ['test-results-summary.js', 'test-summary-script'],
      ['test-planner.js', 'test-planner-script'],
      ['test-planner-enhancements.js', 'test-planner-enhancements-script'],
      ['test-planner-layout.js', 'test-planner-layout-script'],
    ];

    for (const [src, marker] of scripts) {
      if (document.querySelector(`script[data-${marker}]`)) continue;
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.dataset[marker.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = '1';
      document.body.appendChild(script);
    }
  }

  const initialize = () => {
    initializeMainTabs();
    ensureTestPlannerSubtab();
    loadWorkspaceAssets();
  };

  // main-tabs.js is loaded at the end of index.html, after the Test Results DOM
  // exists. Initialize immediately so Result Tracker can discover Test Planner
  // before test-assignment-workbook.js wires the subtab controller.
  if (document.querySelector('main.layout')) {
    initialize();
  } else {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  }
})();
