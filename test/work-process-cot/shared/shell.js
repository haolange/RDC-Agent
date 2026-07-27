(function (global) {
  const SCENARIOS = [
    { id: 'index', href: '../index.html', label: '伪执行', labelEn: 'Play' },
    { id: '01', href: '01-happy-path.html', label: '完整路径', labelEn: 'Happy path' },
    { id: '02', href: '02-running-streaming.html', label: '运行中', labelEn: 'Running' },
    { id: '03', href: '03-completed-collapsed.html', label: '已完成', labelEn: 'Completed' },
    { id: '04', href: '04-stopped.html', label: '已停止', labelEn: 'Stopped' },
    { id: '05', href: '05-tool-families.html', label: '工具族', labelEn: 'Families' },
    { id: '06', href: '06-tool-aggregate.html', label: '聚合', labelEn: 'Aggregate' },
    { id: '07', href: '07-context-compact.html', label: 'Compact', labelEn: 'Compact' },
    { id: '08', href: '08-plan-and-tasks.html', label: 'Plan/Tasks', labelEn: 'Plan/Tasks' },
    { id: '09', href: '09-ask-user-approval.html', label: 'Ask/审批', labelEn: 'Ask/Approval' },
    { id: '10', href: '10-opaque-answer-only.html', label: 'Opaque', labelEn: 'Opaque' },
    { id: '11', href: '11-error-recovery-absent.html', label: '无恢复旁白', labelEn: 'No recovery' },
    { id: '12', href: '12-markdown-surfaces.html', label: 'Markdown', labelEn: 'Markdown' },
  ];

  function ensureTheme() {
    const saved = localStorage.getItem('cot-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    return saved;
  }

  function toggleTheme() {
    const next = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('cot-theme', next);
    return next;
  }

  function renderTopbar(options = {}) {
    const locale = global.CotI18n.getLocale();
    const active = options.active || 'index';
    const scenarios = SCENARIOS.map((item) => {
      const href = options.root
        ? (item.id === 'index' ? 'index.html' : `scenarios/${item.href}`)
        : (item.id === 'index' ? '../index.html' : item.href);
      const label = locale === 'en' ? item.labelEn : item.label;
      return `<a href="${href}" class="${item.id === active ? 'is-active' : ''}">${label}</a>`;
    }).join('');

    const brandHref = options.root ? 'index.html' : '../index.html';
    const extra = options.extraControls || '';

    return `
      <header class="cot-topbar">
        <a class="cot-brand" href="${brandHref}">CoT Acceptance</a>
        <nav class="cot-nav">${scenarios}</nav>
        <div class="cot-controls">
          ${extra}
          <button type="button" class="cot-btn" data-cot-lang>ZH / EN</button>
          <button type="button" class="cot-btn" data-cot-theme>Light / Dark</button>
        </div>
      </header>
    `;
  }

  function mountShell(options = {}) {
    ensureTheme();
    global.CotI18n.setLocale(global.CotI18n.getLocale());
    const shell = document.getElementById('cot-shell');
    if (!shell) return;

    let topbar = shell.querySelector('.cot-topbar');
    const markup = renderTopbar(options);
    if (topbar) {
      topbar.outerHTML = markup;
    } else {
      shell.insertAdjacentHTML('afterbegin', markup);
    }
    topbar = shell.querySelector('.cot-topbar');

    topbar.querySelector('[data-cot-theme]')?.addEventListener('click', toggleTheme);
    topbar.querySelector('[data-cot-lang]')?.addEventListener('click', () => {
      const next = global.CotI18n.getLocale() === 'zh' ? 'en' : 'zh';
      global.CotI18n.setLocale(next);
      mountShell(options);
      options.onLocaleChange?.(next);
    });
  }

  global.CotShell = {
    SCENARIOS,
    mountShell,
    ensureTheme,
    toggleTheme,
    renderTopbar,
  };
})(window);
