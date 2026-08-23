(function (global) {
  const { icon, taskIcon } = global.CotIcons;
  const { t, toolVerb, family, formatMeta, statusLabel, getLocale } = global.CotI18n;

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** CSS triangle caret — matches AgentChat.css .work-process-row-caret */
  function rowCaret(open) {
    return `<span class="work-process-row-caret${open ? ' is-open' : ''}" aria-hidden="true"></span>`;
  }

  function monogram(label) {
    const letter = (label || '?').trim().charAt(0).toUpperCase();
    return `<span class="favicon-image is-monogram" aria-hidden="true">${esc(letter)}</span>`;
  }

  function toolBody(tool) {
    const fam = family(tool.name);
    const running = tool.status === 'running' || tool.status === 'pending';

    if (fam === 'file') {
      const path = tool.path || tool.body || '';
      return `<div class="work-process-tool-card-body family-file">
        <code class="work-process-tool-card-path">${esc(path)}</code>
        ${path ? '<button type="button" class="cot-btn work-process-tool-card-copy" tabindex="-1">Copy</button>' : ''}
      </div>`;
    }
    if (fam === 'shell' || fam === 'git') {
      const cmd = tool.command || tool.body || '';
      return `<div class="work-process-tool-card-body family-${fam}"><code class="work-process-tool-card-command">$ ${esc(cmd)}</code></div>`;
    }
    if (fam === 'search') {
      if (running && !tool.summary) {
        return `<div class="work-process-tool-card-body family-search"><div class="work-process-tool-card-body-text">${esc(tool.pattern || tool.body || '')}</div></div>`;
      }
      const samples = (tool.samples || []).map((s) => `<li class="work-process-tool-card-body-list-item">${esc(s)}</li>`).join('');
      return `<div class="work-process-tool-card-body family-search"><div class="work-process-tool-card-body-text is-summary">${esc(tool.summary || '')}</div>${samples ? `<ul class="work-process-tool-card-body-list">${samples}</ul>` : ''}</div>`;
    }
    if (tool.name === 'web_search') {
      const pills = (tool.sources || []).map((s) => (
        `<a class="work-process-source-pill" href="#" title="${esc(s.title || s.domain)}" onclick="return false;">${monogram(s.domain)}<span>${esc(s.domain)}</span></a>`
      )).join('');
      return `<div class="work-process-tool-card-body family-web"><div class="work-process-tool-card-body-text is-summary">${esc(tool.summary || '')}</div><div class="work-process-source-pills">${pills}</div></div>`;
    }
    if (tool.name === 'web_fetch') {
      const page = tool.page || { domain: 'example.com', title: 'Page' };
      const title = page.title
        ? `<div class="work-process-tool-card-body-text is-summary">${esc(page.title)}</div>`
        : '';
      return `<div class="work-process-tool-card-body family-web">${title}<div class="work-process-web-destination"><a class="work-process-source-pill is-destination" href="#" title="${esc(page.title || page.domain)}" onclick="return false;">${monogram(page.domain)}<span>${esc(page.domain)}</span></a></div></div>`;
    }
    return `<div class="work-process-tool-card-body family-generic"><div class="work-process-tool-card-body-text is-summary">${esc(tool.body || tool.path || '')}</div></div>`;
  }

  function toolExpand(tool) {
    if (!tool.expandable) return '';
    const fam = family(tool.name);
    let detail = '';
    if (fam === 'shell' || fam === 'git') {
      detail = `<pre class="work-process-shell-command">$ ${esc(tool.command || '')}</pre><pre class="work-process-shell-stdout">${esc(tool.stdout || '(no output)')}</pre>`;
    } else if (tool.preview) {
      detail = `<pre class="work-process-tool-card-preview">${esc(tool.preview)}</pre>`;
    }
    const args = tool.rawArgs || tool.raw || '';
    const ret = tool.rawResult || tool.stdout || '';
    const raw = (args || ret)
      ? `<div class="work-process-tool-card-raw">
          ${args ? `<div class="work-process-tool-card-raw-section"><span class="work-process-tool-card-raw-label">${esc(t('args'))}</span><pre class="work-process-tool-card-raw-pre">${esc(args)}</pre></div>` : ''}
          ${ret ? `<div class="work-process-tool-card-raw-section"><span class="work-process-tool-card-raw-label">${esc(t('returnValue'))}</span><pre class="work-process-tool-card-raw-pre">${esc(ret)}</pre></div>` : ''}
        </div>`
      : '';
    return `<div class="work-process-tool-card-expand"><div class="work-process-tool-card-detail">${detail}</div>${raw}</div>`;
  }

  function toolApprovalCallout(tool) {
    if (!tool.approval) return '';
    return `<div class="work-process-tool-approval">
      <div class="work-process-tool-approval-head">
        <span class="work-process-tool-approval-verb">${esc(t('approvalPending'))}</span>
      </div>
      <p class="work-process-tool-approval-message">${esc(tool.approval.message || '')}</p>
    </div>`;
  }

  function renderToolCard(tool, options = {}) {
    const status = tool.status || 'complete';
    const expandable = Boolean(tool.expandable);
    const expanded = Boolean(options.expanded);
    const verb = tool.verb || toolVerb(tool.name, status);
    const runningMeta = status !== 'complete' ? statusLabel(status) : '';
    const metaBits = [tool.meta, runningMeta].filter(Boolean);
    const meta = metaBits.length || expandable
      ? `<span class="work-process-tool-card-meta">${metaBits.map((m) => `<span>${esc(m)}</span>`).join('')}${expandable ? rowCaret(expanded) : ''}</span>`
      : '';
    return `
      <div class="work-process-tool-card status-${status}${expandable ? ' is-expandable' : ''}${expanded ? ' is-expanded' : ''}" data-tool="${esc(tool.name)}">
        <button type="button" class="work-process-tool-card-header"${expandable ? ' data-toggle-expand="1"' : ' disabled'}>
          <span class="work-process-tool-card-title">
            ${icon(tool.name, 'work-process-tool-card-icon')}
            <span class="work-process-tool-card-verb" data-i18n-tool="${esc(tool.name)}" data-i18n-status="${status}">${esc(verb)}</span>
          </span>
          ${meta}
        </button>
        ${toolBody(tool)}
        ${toolApprovalCallout(tool)}
        ${toolExpand(tool)}
      </div>
    `;
  }

  /**
   * Align with resolveSectionThinking:
   * while section is running/pending → label「正在思考」, openByDefault true, Active Signal.
   * Respect sticky `open` when provided after settle.
   */
  function renderThinking(thinking, sectionStatus) {
    if (!thinking || thinking.kind === 'opaque' || thinking.visibility === 'hidden') return '';
    const sectionActive = sectionStatus === 'running' || sectionStatus === 'pending';
    const streaming = thinking.status === 'streaming' || sectionActive;
    const statusClass = streaming ? 'streaming' : 'complete';
    const openByDefault = sectionActive || thinking.status === 'streaming';
    const open = typeof thinking.open === 'boolean' ? thinking.open : openByDefault;
    const label = streaming
      ? (thinking.closing ? t('closing') : t('thinking'))
      : (thinking.duration ? t('thoughtFor', { duration: thinking.duration }) : t('thought'));
    const signal = streaming
      ? `<span class="active-signal-text is-active tone-info">${esc(label)}</span>`
      : esc(label);
    return `
      <details class="work-process-thinking-state kind-${thinking.kind || 'raw'} status-${statusClass}" ${open ? 'open' : ''}>
        <summary class="work-process-thinking-summary">
          ${icon('spark', 'work-process-thinking-icon')}
          <span class="work-process-thinking-caption" data-thinking-label="1">${signal}</span>
          ${rowCaret(open)}
        </summary>
        <div class="work-process-thinking-preview"><div class="markdown-body">${thinking.html || esc(thinking.preview || '')}</div></div>
      </details>
    `;
  }

  function renderProse(prose) {
    if (!prose || !prose.html) return '';
    return `<div class="work-process-prose${prose.streaming ? ' is-streaming' : ''}"><div class="markdown-body">${prose.html}</div></div>`;
  }

  function renderTask(task) {
    const statusLabelText = task.status === 'blocked'
      ? (task.reason ? `Blocked · ${task.reason}` : 'Blocked')
      : task.status === 'in_progress'
        ? 'In progress'
        : task.status === 'cancelled'
          ? 'Cancelled'
          : '';
    return `
      <li class="work-process-task status-complete task-${task.status}" data-testid="work-process-task">
        <span class="work-process-task-icon task-${task.status}" aria-hidden="true">${taskIcon(task.status)}</span>
        <span class="work-process-task-content">
          <span class="work-process-task-title">${esc(task.title)}</span>
          ${statusLabelText ? `<span class="work-process-task-status">${esc(statusLabelText)}</span>` : ''}
        </span>
      </li>
    `;
  }

  function renderAskUser(input) {
    const waiting = input.status === 'running' || input.status === 'pending';
    const verb = toolVerb('ask_user', waiting ? 'running' : 'complete');
    const count = (input.qa || []).length || input.questionCount || 0;
    const answered = (input.qa || []).filter((qa) => qa.a).length;
    const headerText = t('askCount', { verb, count });
    const expanded = input.expanded !== false && waiting;
    const headerInner = waiting
      ? `<span class="active-signal-text is-active tone-interaction work-process-user-input-verb">${esc(headerText)}</span>`
      : `<span class="work-process-user-input-verb">${esc(headerText)}</span>`;
    const items = (input.qa || []).map((qa, index) => `
      <li class="work-process-user-input-transcript-item">
        <span class="work-process-user-input-transcript-index">${index + 1}.</span>
        <p class="work-process-user-input-transcript-question">${esc(qa.q)}</p>
        ${qa.a
          ? `<p class="work-process-user-input-transcript-answer">${esc(qa.a)}</p>`
          : `<p class="work-process-user-input-transcript-pending">${esc(t('askPending'))}</p>`}
      </li>
    `).join('');
    const firstPrompt = (input.qa && input.qa[0] && input.qa[0].q) || input.summary || '';
    return `
      <div class="work-process-user-input ${expanded ? 'is-expanded' : ''}">
        <button type="button" class="work-process-user-input-header" data-toggle-ask="1">
          ${headerInner}
          ${waiting ? `<span class="work-process-user-input-progress">${answered}/${count}</span>` : ''}
          ${rowCaret(expanded)}
        </button>
        ${!expanded && firstPrompt ? `<p class="work-process-user-input-collapsed-summary"><span class="work-process-user-input-collapsed-question">${esc(firstPrompt)}</span>${count > 1 ? `<span class="work-process-user-input-collapsed-count">${esc(t('askRemaining', { n: count - 1 }))}</span>` : ''}</p>` : ''}
        ${expanded && items ? `<ol class="work-process-user-input-transcript">${items}</ol>` : ''}
      </div>
    `;
  }

  /** Flat ApprovalRow — not a sunkencard with icon */
  function renderApproval(approval) {
    const pending = approval.status !== 'complete';
    return `
      <div class="work-process-approval">
        <div class="work-process-tool-summary work-process-tool-summary-static">
          <span class="work-process-tool-line">
            <span class="work-process-tool-verb">${esc(approval.verb || t('approvalPending'))}</span>
            <span class="work-process-approval-message">${esc(approval.message || '')}</span>
          </span>
          ${pending ? `<span class="work-process-tool-meta"><span>${esc(statusLabel(approval.status || 'pending'))}</span></span>` : ''}
        </div>
      </div>
    `;
  }

  function renderAggregate(aggregate) {
    const cards = (aggregate.tools || []).map((tool) => `<li class="work-process-step kind-tool">${renderToolCard(tool)}</li>`).join('');
    return `
      <div class="work-process-tool-aggregate" data-testid="work-process-tool-aggregate">
        <details class="work-process-tool-aggregate-details">
          <summary class="work-process-tool-aggregate-summary">
            ${rowCaret(false).replace('work-process-row-caret', 'work-process-row-caret work-process-aggregate-caret')}
            <span class="work-process-tool-aggregate-text">${esc(aggregate.text)}</span>
          </summary>
          <ol class="work-process-tool-aggregate-body work-process-section-list">${cards}</ol>
        </details>
      </div>
    `;
  }

  function renderSummary(text) {
    return `<p class="work-process-step-summary">${esc(text || t('compact'))}</p>`;
  }

  function wrapStep(inner, options = {}) {
    const status = options.status || 'complete';
    const kind = options.kind || 'tool';
    return `
      <li class="work-process-step kind-${kind} status-${status}${options.appear ? ' is-appear' : ''}${options.section ? ' work-process-section' : ''}">
        <div class="work-process-step-rail status-${status}"><span class="work-process-rail-marker"></span></div>
        <div class="work-process-step-content">${inner}</div>
      </li>
    `;
  }

  function renderSectionItems(items) {
    return (items || []).map((item) => {
      if (item.type === 'tool') return `<li class="work-process-step kind-tool status-${item.tool.status || 'complete'}">${renderToolCard(item.tool, item)}</li>`;
      if (item.type === 'aggregate') return `<li class="work-process-step kind-aggregate">${renderAggregate(item)}</li>`;
      if (item.type === 'ask_user') return `<li class="work-process-step kind-user-input status-${item.status || 'complete'}">${renderAskUser(item)}</li>`;
      if (item.type === 'approval') return `<li class="work-process-step kind-approval status-${item.status || 'pending'}">${renderApproval(item)}</li>`;
      if (item.type === 'diagnostic') {
        return `<li class="work-process-step work-process-diagnostic status-${item.status || 'complete'} severity-${item.severity || 'info'} kind-diagnostic"><div class="work-process-diagnostic-message">${esc(item.message || '')}</div></li>`;
      }
      // tasks are narrative-level — not rendered inside section-list
      return '';
    }).join('');
  }

  function renderSection(section, options = {}) {
    const sectionStatus = section.status || 'complete';
    const toolsHtml = renderSectionItems(section.items);
    const hasProse = Boolean(section.prose && section.prose.html);
    const inner = `
      ${renderThinking(section.thinking, sectionStatus)}
      ${renderProse(section.prose)}
      ${toolsHtml ? `<ol class="work-process-section-list">${toolsHtml}</ol>` : ''}
    `;
    return wrapStep(inner, {
      status: sectionStatus,
      kind: 'section',
      section: true,
      appear: options.appear,
    }).replace(
      'work-process-section kind-section',
      `work-process-section kind-section${hasProse ? ' has-prose' : ''}`,
    );
  }

  function headline(status) {
    if (status === 'running') return t('working');
    if (status === 'stopped') return t('stopped');
    return t('workProcess');
  }

  function renderWorkProcess(model) {
    const status = model.status || 'complete';
    const expanded = model.expanded !== false;
    const label = headline(status);
    const labelHtml = status === 'running'
      ? `<span class="active-signal-text is-active tone-info work-process-label status-${status}" data-wp-label="1">${esc(label)}</span>`
      : `<span class="work-process-label status-${status}" data-wp-label="1">${esc(label)}</span>`;
    const metaText = model.meta
      || (model.duration || model.actionCount
        ? formatMeta(model.duration, model.actionCount || 0)
        : '');
    const meta = metaText
      ? `<span class="work-process-meta" data-wp-meta="1">${esc(metaText)}</span>`
      : '';

    const rows = [];
    (model.sections || []).forEach((section) => rows.push(renderSection(section)));
    (model.extras || []).forEach((item) => {
      if (item.type === 'summary') rows.push(wrapStep(renderSummary(item.text), { kind: 'summary' }));
      if (item.type === 'task') {
        // TaskRow is a top-level narrative <li.work-process-task> (no step rail wrapper)
        rows.push(renderTask(item.task));
      }
      if (item.type === 'diagnostic') {
        rows.push(wrapStep(
          `<div class="work-process-diagnostic-message">${esc(item.message || '')}</div>`,
          { kind: 'diagnostic', status: item.status || 'complete' },
        ));
      }
      if (item.type === 'ask_user') {
        rows.push(wrapStep(renderAskUser(item), { kind: 'user-input', status: item.status || 'complete' }));
      }
      if (item.type === 'approval') {
        rows.push(wrapStep(renderApproval(item), { kind: 'approval', status: item.status || 'pending' }));
      }
    });

    return `
      <section class="work-process status-${status} ${expanded ? 'is-expanded' : 'is-collapsed'}" data-wp-root="1" data-testid="work-process">
        <div class="work-process-header-row">
          <button type="button" class="work-process-header" data-wp-toggle="1" aria-expanded="${expanded}">
            <span class="work-process-caret${expanded ? ' is-open' : ''}" aria-hidden="true">${icon('chevron', '')}</span>
            <span class="work-process-status-dot status-${status}"></span>
            ${labelHtml}
            ${meta}
          </button>
        </div>
        <div class="work-process-body">
          <ol class="work-process-steps work-process-narrative-stream">
            ${rows.join('')}
          </ol>
        </div>
      </section>
    `;
  }

  function bindToolExpand(root) {
    root.querySelectorAll('[data-toggle-expand]').forEach((button) => {
      button.addEventListener('click', () => {
        const card = button.closest('.work-process-tool-card');
        if (!card) return;
        card.classList.toggle('is-expanded');
        const caretEl = card.querySelector('.work-process-row-caret');
        if (caretEl) caretEl.classList.toggle('is-open', card.classList.contains('is-expanded'));
      });
    });
    root.querySelectorAll('[data-toggle-ask]').forEach((button) => {
      button.addEventListener('click', () => {
        const box = button.closest('.work-process-user-input');
        if (!box) return;
        box.classList.toggle('is-expanded');
        const caretEl = button.querySelector('.work-process-row-caret');
        if (caretEl) caretEl.classList.toggle('is-open', box.classList.contains('is-expanded'));
        // Re-render collapsed/expanded bodies simply by toggling class + display via CSS
        const transcript = box.querySelector('.work-process-user-input-transcript');
        const summary = box.querySelector('.work-process-user-input-collapsed-summary');
        const open = box.classList.contains('is-expanded');
        if (transcript) transcript.hidden = !open;
        if (summary) summary.hidden = open;
      });
    });
  }

  function bindWorkProcessToggle(root) {
    root.querySelectorAll('[data-wp-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const wp = button.closest('.work-process');
        if (!wp) return;
        wp.classList.toggle('is-collapsed');
        wp.classList.toggle('is-expanded');
        const open = wp.classList.contains('is-expanded');
        button.setAttribute('aria-expanded', String(open));
        const caretEl = button.querySelector('.work-process-caret');
        if (caretEl) caretEl.classList.toggle('is-open', open);
      });
    });
  }

  function mount(target, model) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return null;
    el.innerHTML = renderWorkProcess(model);
    bindToolExpand(el);
    bindWorkProcessToggle(el);
    return el;
  }

  global.CotRender = {
    esc,
    renderToolCard,
    renderThinking,
    renderProse,
    renderTask,
    renderAskUser,
    renderApproval,
    renderAggregate,
    renderSection,
    renderWorkProcess,
    renderSummary,
    wrapStep,
    mount,
    bindToolExpand,
    bindWorkProcessToggle,
    headline,
    formatMeta,
  };
})(window);
