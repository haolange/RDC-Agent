/** Inline SVG glyphs aligned with WorkProcessIcons.tsx */
(function (global) {
  const PATHS = {
    spark: '<path d="M12 3l1.2 4.2L17.5 8.5 13.2 9.8 12 14l-1.2-4.2L6.5 8.5l4.3-1.3L12 3Zm5.5 8.5 0.7 2.4 2.3.7-2.3.7-.7 2.4-.7-2.4-2.3-.7 2.3-.7.7-2.4Z"/>',
    fileRead: '<path d="M7 3.5h7l3 3V20H7V3.5Zm7 0v3h3"/><path d="M10 11h6M10 14h4"/>',
    fileWrite: '<path d="M7 3.5h7l3 3V20H7V3.5Zm7 0v3h3"/><path d="M10 16h6"/><path d="M13 10v6"/>',
    fileEdit: '<path d="M5 19h4l9.5-9.5a2.1 2.1 0 0 0-3-3L6 16l-1 3Zm10-11 3 3"/>',
    fileDelete: '<path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M8 7l1 13h6l1-13"/><path d="M11 11v5M13 11v5"/>',
    fileMove: '<path d="M4 8h7l2 2h7v8H4V8Z"/><path d="M10 14h6m0 0-2-2m2 2-2 2"/>',
    fileCopy: '<path d="M9 8h9v12H9V8Z"/><path d="M6 4h9v3"/><path d="M6 4v12h2"/>',
    fileGlob: '<path d="M4 7h6v6H4V7Zm10 0h6v6h-6V7ZM4 17h6v3H4v-3Zm10 0h6v3h-6v-3Z"/>',
    codeSearch: '<path d="M8 8 5 12l3 4M16 8l3 4-3 4"/><path d="M13 7l-2 10"/>',
    notebookEdit: '<path d="M6 4h12v16H6V4Z"/><path d="M9 4v16"/><path d="M12 9h4M12 13h4"/>',
    webFetch: '<path d="M7 4h7l3 3v13H7V4Zm7 0v3h3"/><path d="M11 12h7m0 0-2-2m2 2-2 2"/>',
    webSearch: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="M14.5 14.5 19 19"/><path d="M8 10.5h5M10.5 8v5"/>',
    terminal: '<path d="m6 8 4 4-4 4m6 0h6"/>',
    gitStatus: '<circle cx="7" cy="7" r="2"/><circle cx="17" cy="17" r="2"/><path d="M7 9v6a2 2 0 0 0 2 2h4"/><path d="M17 15V9a2 2 0 0 0-2-2h-2"/>',
    gitDiff: '<path d="M8 5v14M16 5v14"/><path d="M5 9h6M13 15h6"/>',
    gitLog: '<circle cx="8" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="8" cy="18" r="2"/><path d="M12 6h7M12 12h7M12 18h5"/>',
    gitAdd: '<circle cx="8" cy="12" r="2"/><path d="M8 5v5m0 4v5"/><path d="M14 12h6m-3-3v6"/>',
    gitUnstage: '<circle cx="8" cy="12" r="2"/><path d="M8 5v5m0 4v5"/><path d="M14 12h6"/>',
    gitCommit: '<circle cx="12" cy="12" r="3"/><path d="M12 3v6m0 6v6"/>',
    question: '<path d="M9.5 9a2.7 2.7 0 0 1 5.2.9c0 2-2.7 2.1-2.7 4.1m0 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>',
    toolSearch: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3"/><circle cx="16.5" cy="16.5" r="3.5"/><path d="M19 19 21.5 21.5"/>',
    handoff: '<path d="M7 7h10l-3-3m3 3-3 3M17 17H7l3 3m-3-3 3-3"/>',
    planArtifact: '<path d="M7 4h7l3 3v13H7V4Zm7 0v3h3"/><path d="M10 11h6M10 14h6M10 17h4"/>',
    outputPublish: '<path d="M12 4v10"/><path d="m8 10 4 4 4-4"/><path d="M5 18h14"/>',
    memorySearch: '<circle cx="10" cy="10" r="5"/><path d="m14 14 4 4"/><path d="M8 10h4"/>',
    memoryRead: '<path d="M5 7h14v10H5V7Z"/><path d="M8 10h8M8 13h5"/>',
    memoryWrite: '<path d="M5 7h14v10H5V7Z"/><path d="M12 9v6M9 12h6"/>',
    memoryDelete: '<path d="M5 7h14v10H5V7Z"/><path d="M9 12h6"/>',
    skillsList: '<path d="M6 6h12v4H6V6Zm0 8h12v4H6v-4Z"/>',
    skillRead: '<path d="M7 4h10v16H7V4Z"/><path d="M10 8h4M10 12h4"/>',
    plug: '<path d="M9 7V3m6 4V3"/><path d="M8 7h8v5a4 4 0 0 1-8 0V7Z"/><path d="M12 16v5"/>',
    monitor: '<path d="M4 6h16v10H4V6Z"/><path d="M9 20h6M12 16v4"/>',
    brain: '<path d="M9 8a3 3 0 0 1 6 0c1.5 0 3 1.2 3 3s-1 3-2.5 3H8.5C7 14 6 12.8 6 11s1.5-3 3-3Z"/><path d="M9 14v4m6-4v4"/>',
    taskCreate: '<path d="M6 6h12v12H6V6Z"/><path d="M12 9v6M9 12h6"/>',
    taskUpdate: '<path d="M6 6h12v12H6V6Z"/><path d="M9 12h6"/>',
    taskGet: '<path d="M6 6h12v12H6V6Z"/><path d="M9 10h6M9 13h4"/>',
    taskList: '<path d="M7 7h10M7 12h10M7 17h7"/>',
    taskStop: '<path d="M7 7h10v10H7V7Z"/>',
    tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 2.4-8.4Z"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
  };

  const TOOL_ICONS = {
    read_file: 'fileRead',
    write_file: 'fileWrite',
    edit_file: 'fileEdit',
    delete_file: 'fileDelete',
    move_file: 'fileMove',
    copy_file: 'fileCopy',
    glob: 'fileGlob',
    grep: 'codeSearch',
    notebook_edit: 'notebookEdit',
    web_fetch: 'webFetch',
    web_search: 'webSearch',
    bash: 'terminal',
    git_status: 'gitStatus',
    git_diff: 'gitDiff',
    git_log: 'gitLog',
    git_add: 'gitAdd',
    git_unstage: 'gitUnstage',
    git_commit: 'gitCommit',
    ask_user: 'question',
    tool_search: 'toolSearch',
    agent_handoff: 'handoff',
    plan_artifact: 'planArtifact',
    output_register: 'outputPublish',
    memory_search: 'memorySearch',
    memory_read: 'memoryRead',
    memory_write: 'memoryWrite',
    memory_delete: 'memoryDelete',
    skills: 'skillsList',
    skill_read: 'skillRead',
    mcp: 'plug',
    rdc_context: 'monitor',
    subagent: 'brain',
    task_create: 'taskCreate',
    task_update: 'taskUpdate',
    task_get: 'taskGet',
    task_list: 'taskList',
    task_stop: 'taskStop',
  };

  function icon(name, className) {
    const key = name.startsWith('mcp__') ? 'plug' : (TOOL_ICONS[name] || name || 'tool');
    const paths = PATHS[key] || PATHS.tool;
    return `<svg class="${className || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  }

  function taskIcon(status) {
    if (status === 'completed') {
      return '<svg viewBox="0 0 16 16"><path d="m3.5 8.1 2.7 2.7 6.3-6.1"/></svg>';
    }
    if (status === 'blocked') {
      return '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5"/><path d="M8 5.1v3.3M8 10.7h.01"/></svg>';
    }
    if (status === 'cancelled') {
      return '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5"/><path d="m5.5 5.5 5 5m0-5-5 5"/></svg>';
    }
    if (status === 'in_progress') {
      return '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4.8"/><path d="M8 5.4v2.8l1.9 1.3"/></svg>';
    }
    return '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4.8"/></svg>';
  }

  global.CotIcons = { icon, taskIcon, PATHS, TOOL_ICONS };
})(window);
