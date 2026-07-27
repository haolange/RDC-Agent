(function (global) {
  const TOOL_VERBS = {
    read_file: { zh: { running: '正在读取', complete: '已读取' }, en: { running: 'Reading file', complete: 'Read file' } },
    write_file: { zh: { running: '正在写入', complete: '已写入' }, en: { running: 'Writing file', complete: 'Wrote file' } },
    edit_file: { zh: { running: '正在编辑', complete: '已编辑' }, en: { running: 'Editing file', complete: 'Edited file' } },
    delete_file: { zh: { running: '正在删除', complete: '已删除' }, en: { running: 'Deleting file', complete: 'Deleted file' } },
    move_file: { zh: { running: '正在移动', complete: '已移动' }, en: { running: 'Moving file', complete: 'Moved file' } },
    copy_file: { zh: { running: '正在复制', complete: '已复制' }, en: { running: 'Copying file', complete: 'Copied file' } },
    glob: { zh: { running: '正在列出', complete: '已列出' }, en: { running: 'Listing files', complete: 'Listed files' } },
    grep: { zh: { running: '正在搜索代码', complete: '已搜索代码' }, en: { running: 'Searching code', complete: 'Searched code' } },
    notebook_edit: { zh: { running: '正在编辑 Notebook', complete: '已编辑 Notebook' }, en: { running: 'Editing notebook', complete: 'Edited notebook' } },
    web_fetch: { zh: { running: '正在抓取', complete: '已抓取' }, en: { running: 'Fetching page', complete: 'Fetched page' } },
    web_search: { zh: { running: '正在联网搜索', complete: '已联网搜索' }, en: { running: 'Searching web', complete: 'Searched web' } },
    bash: { zh: { running: '正在运行命令', complete: '已运行命令' }, en: { running: 'Running command', complete: 'Ran command' } },
    git_status: { zh: { running: '正在查看状态', complete: '已查看状态' }, en: { running: 'Viewing status', complete: 'Viewed status' } },
    git_diff: { zh: { running: '正在查看差异', complete: '已查看差异' }, en: { running: 'Viewing diff', complete: 'Viewed diff' } },
    git_log: { zh: { running: '正在查看历史', complete: '已查看历史' }, en: { running: 'Viewing history', complete: 'Viewed history' } },
    git_add: { zh: { running: '正在暂存', complete: '已暂存' }, en: { running: 'Staging changes', complete: 'Staged changes' } },
    git_unstage: { zh: { running: '正在取消暂存', complete: '已取消暂存' }, en: { running: 'Unstaging changes', complete: 'Unstaged changes' } },
    git_commit: { zh: { running: '正在提交', complete: '已提交' }, en: { running: 'Committing', complete: 'Committed' } },
    ask_user: { zh: { running: '等待用户', complete: '已回答' }, en: { running: 'Waiting for user', complete: 'Answered' } },
    tool_search: { zh: { running: '正在搜索工具', complete: '已搜索工具' }, en: { running: 'Searching tools', complete: 'Searched tools' } },
    agent_handoff: { zh: { running: '正在准备交接', complete: '已准备交接' }, en: { running: 'Preparing handoff', complete: 'Prepared handoff' } },
    plan_artifact: { zh: { running: '正在生成计划', complete: '已生成计划' }, en: { running: 'Generating plan', complete: 'Generated plan' } },
    // Real EN catalog often falls back to Chinese for this verb — keep ZH and mirror product gap.
    output_register: { zh: { running: '正在发布输出', complete: '已发布输出' }, en: { running: '正在发布输出', complete: '已发布输出' } },
    memory_search: { zh: { running: '正在搜索记忆', complete: '已搜索记忆' }, en: { running: 'Searching memory', complete: 'Searched memory' } },
    memory_read: { zh: { running: '正在读取记忆', complete: '已读取记忆' }, en: { running: 'Reading memory', complete: 'Read memory' } },
    memory_write: { zh: { running: '正在写入记忆', complete: '已写入记忆' }, en: { running: 'Writing memory', complete: 'Wrote memory' } },
    memory_delete: { zh: { running: '正在删除记忆', complete: '已删除记忆' }, en: { running: 'Deleting memory', complete: 'Deleted memory' } },
    skills: { zh: { running: '正在列出技能', complete: '已列出技能' }, en: { running: 'Listing skills', complete: 'Listed skills' } },
    skill_read: { zh: { running: '正在加载技能', complete: '已加载技能' }, en: { running: 'Loading skill', complete: 'Loaded skill' } },
    // Bare `mcp` tool vs `mcp__*` — product catalog differs.
    mcp: { zh: { running: '正在查询 MCP', complete: '已查询 MCP' }, en: { running: 'Querying MCP', complete: 'Queried MCP' } },
    mcp_call: { zh: { running: '正在调用 MCP', complete: '已调用 MCP' }, en: { running: 'Calling MCP', complete: 'Called MCP' } },
    rdx_context: { zh: { running: '正在读取 RDX 上下文', complete: '已读取 RDX 上下文' }, en: { running: 'Reading RDX context', complete: 'Read RDX context' } },
    subagent: { zh: { running: '正在调用子代理', complete: '已调用子代理' }, en: { running: 'Calling subagent', complete: 'Called subagent' } },
    task_create: { zh: { running: '正在创建任务', complete: '已创建任务' }, en: { running: 'Creating task', complete: 'Created task' } },
    task_update: { zh: { running: '正在更新任务', complete: '已更新任务' }, en: { running: 'Updating task', complete: 'Updated task' } },
    task_get: { zh: { running: '正在读取任务', complete: '已读取任务' }, en: { running: 'Reading task', complete: 'Read task' } },
    task_list: { zh: { running: '正在列出任务', complete: '已列出任务' }, en: { running: 'Listing tasks', complete: 'Listed tasks' } },
    task_stop: { zh: { running: '正在停止任务', complete: '已停止任务' }, en: { running: 'Stopping task', complete: 'Stopped task' } },
  };

  const LABELS = {
    working: { zh: '工作中', en: 'Working' },
    workProcess: { zh: '工作过程', en: 'Work process' },
    stopped: { zh: '已停止', en: 'Stopped' },
    thinking: { zh: '正在思考', en: 'Thinking' },
    thought: { zh: '已思考', en: 'Thought' },
    thoughtFor: { zh: '已思考 · {duration}', en: 'Thought for {duration}' },
    closing: { zh: '收束摘要', en: 'Closing summary' },
    actions: { zh: '{n} 个动作', en: '{n} actions' },
    // Real: ZH duration =「持续 {duration}」; EN duration =「{duration}」
    duration: { zh: '持续 {duration}', en: '{duration}' },
    meta: { zh: '{durationMeta} · {actionMeta}', en: '{durationMeta} · {actionMeta}' },
    compact: { zh: 'Earlier work summarized', en: 'Earlier work summarized' },
    play: { zh: '播放', en: 'Play' },
    pause: { zh: '暂停', en: 'Pause' },
    replay: { zh: '重播', en: 'Replay' },
    jumpDone: { zh: '跳到完成', en: 'Jump to done' },
    aggregateRead: { zh: '读取了 {n} 个文件', en: 'Read {n} files' },
    args: { zh: '参数', en: 'Args' },
    returnValue: { zh: '返回值', en: 'Return value' },
    statusRunning: { zh: '进行中', en: 'Running' },
    statusPending: { zh: '等待中', en: 'Pending' },
    statusError: { zh: '失败', en: 'Failed' },
    approvalPending: { zh: '等待审批', en: 'Awaiting approval' },
    askPending: { zh: '等待回答', en: 'Waiting for answer' },
    askRemaining: { zh: '另 {n} 问', en: '{n} more' },
    askCount: { zh: '{verb} · {count}', en: '{verb} · {count}' },
  };

  const FAMILY = {
    read_file: 'file', write_file: 'file', edit_file: 'file', delete_file: 'file',
    move_file: 'file', copy_file: 'file', notebook_edit: 'file',
    glob: 'search', grep: 'search',
    bash: 'shell',
    git_status: 'git', git_diff: 'git', git_log: 'git', git_add: 'git', git_unstage: 'git', git_commit: 'git',
    web_search: 'web', web_fetch: 'web',
  };

  let locale = localStorage.getItem('cot-locale') || 'zh';

  function t(key, vars) {
    const entry = LABELS[key];
    let text = entry ? entry[locale] || entry.zh : key;
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, String(v));
      });
    }
    return text;
  }

  function formatMeta(duration, actionCount) {
    const durationMeta = duration ? t('duration', { duration }) : '';
    const actionMeta = actionCount > 0 ? t('actions', { n: actionCount }) : '';
    return [durationMeta, actionMeta].filter(Boolean).join(' · ');
  }

  function resolveToolKey(tool) {
    if (tool.startsWith('mcp__')) return 'mcp_call';
    return tool;
  }

  function toolVerb(tool, status) {
    const key = resolveToolKey(tool);
    const entry = TOOL_VERBS[key];
    if (!entry) {
      return locale === 'en'
        ? (status === 'running' ? 'Calling tool' : 'Called tool')
        : (status === 'running' ? '正在调用工具' : '已调用工具');
    }
    const phase = status === 'running' || status === 'pending' ? 'running' : 'complete';
    return entry[locale][phase];
  }

  function family(tool) {
    if (tool.startsWith('mcp__')) return 'generic';
    return FAMILY[tool] || 'generic';
  }

  function statusLabel(status) {
    if (status === 'running') return t('statusRunning');
    if (status === 'pending') return t('statusPending');
    if (status === 'error') return t('statusError');
    return '';
  }

  function setLocale(next) {
    locale = next === 'en' ? 'en' : 'zh';
    localStorage.setItem('cot-locale', locale);
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    document.dispatchEvent(new CustomEvent('cot:locale', { detail: { locale } }));
  }

  function getLocale() {
    return locale;
  }

  global.CotI18n = {
    t,
    toolVerb,
    family,
    formatMeta,
    statusLabel,
    setLocale,
    getLocale,
    TOOL_VERBS,
    LABELS,
  };
})(window);
