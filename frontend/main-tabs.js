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

    const tabs = panels.map((panel, index) => {
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

      tabList.appendChild(button);
      return button;
    });

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
        const slug = tabs[index].textContent
          .toLowerCase()
          .replace(/\s*\/\s*/g, '-')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        history.replaceState(null, '', `#${slug}`);
      }
    }

    layout.before(tabList);

    const hash = window.location.hash.slice(1).toLowerCase();
    const hashIndex = tabs.findIndex((tab) => tab.textContent
      .toLowerCase()
      .replace(/\s*\/\s*/g, '-')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') === hash);

    activateTab(hashIndex >= 0 ? hashIndex : DEFAULT_TAB_INDEX);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMainTabs);
  } else {
    initializeMainTabs();
  }
})();
