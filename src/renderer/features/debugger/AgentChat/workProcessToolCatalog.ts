import type { WorkProcessIconKey, WorkProcessToolGroupKind } from './workProcessTypes';

export interface WorkProcessToolDisplay {
  icon: WorkProcessIconKey;
  groupKind: WorkProcessToolGroupKind;
  category: string;
  groupTitle: string;
  groupUnit: string;
  completeVerb: string;
  runningVerb: string;
  pendingVerb?: string;
  mutation?: boolean;
  approval?: boolean;
  errorAccent?: boolean;
}

export const WORK_PROCESS_TOOL_DISPLAY_CATALOG: Record<string, WorkProcessToolDisplay> = {
  read_file: { icon: 'file', groupKind: 'explore', category: '文件', groupTitle: '探索', groupUnit: '文件', completeVerb: '已读取', runningVerb: '正在读取' },
  glob: { icon: 'search', groupKind: 'explore', category: '文件', groupTitle: '探索', groupUnit: '文件', completeVerb: '已列出', runningVerb: '正在列出' },
  grep: { icon: 'search', groupKind: 'search', category: '搜索', groupTitle: '搜索', groupUnit: '查询', completeVerb: '已搜索代码', runningVerb: '正在搜索代码' },
  search_codebase: { icon: 'search', groupKind: 'search', category: '搜索', groupTitle: '搜索', groupUnit: '查询', completeVerb: '已搜索代码库', runningVerb: '正在搜索代码库' },
  web_fetch: { icon: 'globe', groupKind: 'web', category: '联网', groupTitle: '联网', groupUnit: '页面', completeVerb: '已浏览', runningVerb: '正在浏览', approval: true },
  web_search: { icon: 'globe', groupKind: 'search', category: '联网搜索', groupTitle: '搜索', groupUnit: '查询', completeVerb: '已联网搜索', runningVerb: '正在联网搜索', approval: true },
  bash: { icon: 'terminal', groupKind: 'command', category: '命令', groupTitle: '命令', groupUnit: '命令', completeVerb: '已运行命令', runningVerb: '正在运行命令', approval: true, errorAccent: true },
  write_file: { icon: 'edit', groupKind: 'change', category: '变更', groupTitle: '变更', groupUnit: '文件', completeVerb: '已写入', runningVerb: '正在写入', mutation: true, approval: true },
  edit_file: { icon: 'edit', groupKind: 'change', category: '变更', groupTitle: '变更', groupUnit: '文件', completeVerb: '已编辑', runningVerb: '正在编辑', mutation: true, approval: true },
  delete_file: { icon: 'edit', groupKind: 'change', category: '变更', groupTitle: '变更', groupUnit: '文件', completeVerb: '已删除', runningVerb: '正在删除', mutation: true, approval: true, errorAccent: true },
  move_file: { icon: 'edit', groupKind: 'change', category: '变更', groupTitle: '变更', groupUnit: '文件', completeVerb: '已移动', runningVerb: '正在移动', mutation: true, approval: true },
  copy_file: { icon: 'edit', groupKind: 'change', category: '变更', groupTitle: '变更', groupUnit: '文件', completeVerb: '已复制', runningVerb: '正在复制', mutation: true, approval: true },
  notebook_edit: { icon: 'edit', groupKind: 'change', category: 'Notebook', groupTitle: '变更', groupUnit: 'Notebook', completeVerb: '已编辑 Notebook', runningVerb: '正在编辑 Notebook', mutation: true },
  git_status: { icon: 'git', groupKind: 'git', category: 'Git', groupTitle: 'Git', groupUnit: '操作', completeVerb: '已检查状态', runningVerb: '正在检查状态' },
  git_diff: { icon: 'git', groupKind: 'git', category: 'Git', groupTitle: 'Git', groupUnit: '操作', completeVerb: '已查看差异', runningVerb: '正在查看差异' },
  git_log: { icon: 'git', groupKind: 'git', category: 'Git', groupTitle: 'Git', groupUnit: '操作', completeVerb: '已查看历史', runningVerb: '正在查看历史' },
  git_add: { icon: 'git', groupKind: 'git', category: 'Git', groupTitle: 'Git', groupUnit: '操作', completeVerb: '已暂存', runningVerb: '正在暂存', mutation: true, approval: true },
  git_unstage: { icon: 'git', groupKind: 'git', category: 'Git', groupTitle: 'Git', groupUnit: '操作', completeVerb: '已取消暂存', runningVerb: '正在取消暂存', mutation: true, approval: true },
  git_commit: { icon: 'git', groupKind: 'git', category: 'Git', groupTitle: 'Git', groupUnit: '操作', completeVerb: '已提交', runningVerb: '正在提交', mutation: true, approval: true },
  ask_user: { icon: 'question', groupKind: 'interaction', category: '人机交互', groupTitle: '询问', groupUnit: '问题', completeVerb: '已回答', runningVerb: '等待用户' },
  tool_search: { icon: 'search', groupKind: 'runtime', category: '工具', groupTitle: '工具发现', groupUnit: '查询', completeVerb: '已搜索工具', runningVerb: '正在搜索工具' },
  agent_handoff: { icon: 'handoff', groupKind: 'collaboration', category: '协作', groupTitle: '协作', groupUnit: '交接', completeVerb: '已准备交接', runningVerb: '正在准备交接' },
  plan_artifact: { icon: 'spark', groupKind: 'runtime', category: '计划', groupTitle: '产物', groupUnit: '产物', completeVerb: '已生成计划', runningVerb: '正在生成计划' },
  memory_search: { icon: 'memory', groupKind: 'memory', category: '记忆', groupTitle: '记忆', groupUnit: '项', completeVerb: '已搜索记忆', runningVerb: '正在搜索记忆' },
  memory_read: { icon: 'memory', groupKind: 'memory', category: '记忆', groupTitle: '记忆', groupUnit: '项', completeVerb: '已读取记忆', runningVerb: '正在读取记忆' },
  memory_write: { icon: 'memory', groupKind: 'memory', category: '记忆', groupTitle: '记忆', groupUnit: '项', completeVerb: '已写入记忆', runningVerb: '正在写入记忆', mutation: true },
  memory_delete: { icon: 'memory', groupKind: 'memory', category: '记忆', groupTitle: '记忆', groupUnit: '项', completeVerb: '已删除记忆', runningVerb: '正在删除记忆', mutation: true },
  skills: { icon: 'spark', groupKind: 'runtime', category: '技能', groupTitle: '技能', groupUnit: '查询', completeVerb: '已列出技能', runningVerb: '正在列出技能' },
  skill_read: { icon: 'spark', groupKind: 'runtime', category: '技能', groupTitle: '技能', groupUnit: '读取', completeVerb: '已加载技能', runningVerb: '正在加载技能' },
  mcp: { icon: 'plug', groupKind: 'mcp', category: 'MCP', groupTitle: 'MCP', groupUnit: '调用', completeVerb: '已查询 MCP', runningVerb: '正在查询 MCP' },
  rdx_context: { icon: 'monitor', groupKind: 'runtime', category: 'RDX', groupTitle: 'RDX 上下文', groupUnit: '读取', completeVerb: '已读取 RDX 上下文', runningVerb: '正在读取 RDX 上下文' },
  subagent: { icon: 'handoff', groupKind: 'collaboration', category: '协作', groupTitle: '协作', groupUnit: '子任务', completeVerb: '已调用子代理', runningVerb: '正在调用子代理' },
  task_create: { icon: 'task', groupKind: 'task', category: '任务', groupTitle: '任务', groupUnit: '项', completeVerb: '已创建任务', runningVerb: '正在创建任务', mutation: true },
  task_update: { icon: 'task', groupKind: 'task', category: '任务', groupTitle: '任务', groupUnit: '项', completeVerb: '已更新任务', runningVerb: '正在更新任务', mutation: true },
  task_get: { icon: 'task', groupKind: 'task', category: '任务', groupTitle: '任务', groupUnit: '项', completeVerb: '已读取任务', runningVerb: '正在读取任务' },
  task_list: { icon: 'task', groupKind: 'task', category: '任务', groupTitle: '任务', groupUnit: '项', completeVerb: '已列出任务', runningVerb: '正在列出任务' },
  task_stop: { icon: 'task', groupKind: 'task', category: '任务', groupTitle: '任务', groupUnit: '项', completeVerb: '已停止任务', runningVerb: '正在停止任务', mutation: true, errorAccent: true },
};

const GENERIC_TOOL_DISPLAY: WorkProcessToolDisplay = {
  icon: 'tool',
  groupKind: 'runtime',
  category: '工具',
  groupTitle: '工具',
  groupUnit: '调用',
  completeVerb: '已调用工具',
  runningVerb: '正在调用工具',
  pendingVerb: '等待调用工具',
};

export const normalizeToolName = (toolName: string): string => toolName.trim().toLowerCase().replace(/[.-]/g, '_');

const getMcpParts = (normalizedToolName: string): { server: string; tool: string } | null => {
  if (!normalizedToolName.startsWith('mcp__')) return null;
  const [, server = '', ...toolParts] = normalizedToolName.split('__');
  const tool = toolParts.join('__');
  if (!server || !tool) return null;
  return { server, tool };
};

const formatMcpGroupTitle = (normalizedToolName: string): string => {
  const parts = getMcpParts(normalizedToolName);
  return parts ? `MCP · ${parts.server}` : 'MCP';
};

export const getToolDisplay = (toolName: string): WorkProcessToolDisplay => {
  const normalized = normalizeToolName(toolName);
  if (normalized.startsWith('mcp__')) {
    return {
      icon: 'plug',
      groupKind: 'mcp',
      category: 'MCP',
      groupTitle: formatMcpGroupTitle(normalized),
      groupUnit: '调用',
      completeVerb: '已调用 MCP',
      runningVerb: '正在调用 MCP',
    };
  }
  return WORK_PROCESS_TOOL_DISPLAY_CATALOG[normalized] ?? GENERIC_TOOL_DISPLAY;
};

export const formatMcpTarget = (toolName: string): string => {
  const parts = getMcpParts(normalizeToolName(toolName));
  return parts ? `${parts.server}/${parts.tool}` : '';
};
