import type {
  WorkProcessIconKey,
  WorkProcessToolFamily,
  WorkProcessToolGroupKind,
} from './workProcessTypes';

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
  read_file: { icon: 'fileRead', groupKind: 'explore', category: '文件读取', groupTitle: '探索', groupUnit: '文件', completeVerb: '已读取', runningVerb: '正在读取' },
  artifact_read: { icon: 'artifactRead', groupKind: 'explore', category: '产物读取', groupTitle: '探索', groupUnit: '产物', completeVerb: '已读取产物', runningVerb: '正在读取产物' },
  read_image: { icon: 'imageRead', groupKind: 'explore', category: '图片查看', groupTitle: '探索', groupUnit: '图片', completeVerb: '已查看图片', runningVerb: '正在查看图片' },
  glob: { icon: 'fileGlob', groupKind: 'explore', category: '文件列举', groupTitle: '探索', groupUnit: '文件', completeVerb: '已列出', runningVerb: '正在列出' },
  grep: { icon: 'codeSearch', groupKind: 'search', category: '代码搜索', groupTitle: '搜索', groupUnit: '查询', completeVerb: '已搜索代码', runningVerb: '正在搜索代码' },
  web_fetch: { icon: 'webFetch', groupKind: 'web', category: '网页抓取', groupTitle: '联网', groupUnit: '页面', completeVerb: '已抓取', runningVerb: '正在抓取', approval: true },
  web_search: { icon: 'webSearch', groupKind: 'search', category: '联网搜索', groupTitle: '搜索', groupUnit: '查询', completeVerb: '已联网搜索', runningVerb: '正在联网搜索', approval: true },
  shell: { icon: 'terminal', groupKind: 'command', category: '命令', groupTitle: '命令', groupUnit: '命令', completeVerb: '已运行命令', runningVerb: '正在运行命令', approval: true, errorAccent: true },
  write_file: { icon: 'fileWrite', groupKind: 'change', category: '文件写入', groupTitle: '变更', groupUnit: '文件', completeVerb: '已写入', runningVerb: '正在写入', mutation: true, approval: true },
  edit_file: { icon: 'fileEdit', groupKind: 'change', category: '文件编辑', groupTitle: '变更', groupUnit: '文件', completeVerb: '已编辑', runningVerb: '正在编辑', mutation: true, approval: true },
  delete_file: { icon: 'fileDelete', groupKind: 'change', category: '文件删除', groupTitle: '变更', groupUnit: '文件', completeVerb: '已删除', runningVerb: '正在删除', mutation: true, approval: true, errorAccent: true },
  move_file: { icon: 'fileMove', groupKind: 'change', category: '文件移动', groupTitle: '变更', groupUnit: '文件', completeVerb: '已移动', runningVerb: '正在移动', mutation: true, approval: true },
  copy_file: { icon: 'fileCopy', groupKind: 'change', category: '文件复制', groupTitle: '变更', groupUnit: '文件', completeVerb: '已复制', runningVerb: '正在复制', mutation: true, approval: true },
  notebook_edit: { icon: 'notebookEdit', groupKind: 'change', category: 'Notebook', groupTitle: '变更', groupUnit: 'Notebook', completeVerb: '已编辑 Notebook', runningVerb: '正在编辑 Notebook', mutation: true },
  git_status: { icon: 'gitStatus', groupKind: 'git', category: 'Git 状态', groupTitle: 'Git', groupUnit: '状态', completeVerb: '已查看状态', runningVerb: '正在查看状态' },
  git_diff: { icon: 'gitDiff', groupKind: 'git', category: 'Git 差异', groupTitle: 'Git', groupUnit: '差异', completeVerb: '已查看差异', runningVerb: '正在查看差异' },
  git_log: { icon: 'gitLog', groupKind: 'git', category: 'Git 历史', groupTitle: 'Git', groupUnit: '历史', completeVerb: '已查看历史', runningVerb: '正在查看历史' },
  git_add: { icon: 'gitAdd', groupKind: 'git', category: 'Git 暂存', groupTitle: 'Git', groupUnit: '暂存', completeVerb: '已暂存', runningVerb: '正在暂存', mutation: true, approval: true },
  git_unstage: { icon: 'gitUnstage', groupKind: 'git', category: 'Git 取消暂存', groupTitle: 'Git', groupUnit: '取消暂存', completeVerb: '已取消暂存', runningVerb: '正在取消暂存', mutation: true, approval: true },
  git_commit: { icon: 'gitCommit', groupKind: 'git', category: 'Git 提交', groupTitle: 'Git', groupUnit: '提交', completeVerb: '已提交', runningVerb: '正在提交', mutation: true, approval: true },
  ask_user: { icon: 'question', groupKind: 'interaction', category: '人机交互', groupTitle: '询问', groupUnit: '问题', completeVerb: '已回答', runningVerb: '等待用户' },
  tool_search: { icon: 'toolSearch', groupKind: 'runtime', category: '工具发现', groupTitle: '工具发现', groupUnit: '查询', completeVerb: '已搜索工具', runningVerb: '正在搜索工具' },
  code_interpreter: { icon: 'interpreter', groupKind: 'command', category: '解释器', groupTitle: '解释器', groupUnit: '脚本', completeVerb: '已运行解释器', runningVerb: '正在运行解释器', approval: true, errorAccent: true },
  agent_handoff: { icon: 'handoff', groupKind: 'collaboration', category: '代理交接', groupTitle: '交接', groupUnit: '交接', completeVerb: '已准备交接', runningVerb: '正在准备交接' },
  plan_artifact: { icon: 'planArtifact', groupKind: 'runtime', category: '计划产物', groupTitle: '产物', groupUnit: '产物', completeVerb: '已生成计划', runningVerb: '正在生成计划' },
  output_register: { icon: 'outputPublish', groupKind: 'runtime', category: '输出发布', groupTitle: '输出', groupUnit: '文件', completeVerb: '已发布输出', runningVerb: '正在发布输出', mutation: true },
  memory_search: { icon: 'memorySearch', groupKind: 'memory', category: '记忆搜索', groupTitle: '记忆', groupUnit: '搜索', completeVerb: '已搜索记忆', runningVerb: '正在搜索记忆' },
  memory_read: { icon: 'memoryRead', groupKind: 'memory', category: '记忆读取', groupTitle: '记忆', groupUnit: '读取', completeVerb: '已读取记忆', runningVerb: '正在读取记忆' },
  memory_write: { icon: 'memoryWrite', groupKind: 'memory', category: '记忆写入', groupTitle: '记忆', groupUnit: '写入', completeVerb: '已写入记忆', runningVerb: '正在写入记忆', mutation: true },
  memory_delete: { icon: 'memoryDelete', groupKind: 'memory', category: '记忆删除', groupTitle: '记忆', groupUnit: '删除', completeVerb: '已删除记忆', runningVerb: '正在删除记忆', mutation: true },
  skills: { icon: 'skillsList', groupKind: 'runtime', category: '技能目录', groupTitle: '技能', groupUnit: '查询', completeVerb: '已列出技能', runningVerb: '正在列出技能' },
  skill_read: { icon: 'skillRead', groupKind: 'runtime', category: '技能加载', groupTitle: '技能', groupUnit: '读取', completeVerb: '已加载技能', runningVerb: '正在加载技能' },
  mcp: { icon: 'plug', groupKind: 'mcp', category: 'MCP', groupTitle: 'MCP', groupUnit: '调用', completeVerb: '已查询 MCP', runningVerb: '正在查询 MCP' },
  rdx_context: { icon: 'monitor', groupKind: 'runtime', category: 'RDX', groupTitle: 'RDX 上下文', groupUnit: '读取', completeVerb: '已读取 RDX 上下文', runningVerb: '正在读取 RDX 上下文' },
  subagent: { icon: 'brain', groupKind: 'collaboration', category: '子代理', groupTitle: '子代理', groupUnit: '子任务', completeVerb: '已调用子代理', runningVerb: '正在调用子代理' },
  task_create: { icon: 'taskCreate', groupKind: 'task', category: '任务创建', groupTitle: '任务', groupUnit: '创建', completeVerb: '已创建任务', runningVerb: '正在创建任务', mutation: true },
  task_update: { icon: 'taskUpdate', groupKind: 'task', category: '任务更新', groupTitle: '任务', groupUnit: '更新', completeVerb: '已更新任务', runningVerb: '正在更新任务', mutation: true },
  task_get: { icon: 'taskGet', groupKind: 'task', category: '任务读取', groupTitle: '任务', groupUnit: '读取', completeVerb: '已读取任务', runningVerb: '正在读取任务' },
  task_list: { icon: 'taskList', groupKind: 'task', category: '任务列表', groupTitle: '任务', groupUnit: '列表', completeVerb: '已列出任务', runningVerb: '正在列出任务' },
  task_stop: { icon: 'taskStop', groupKind: 'task', category: '任务停止', groupTitle: '任务', groupUnit: '停止', completeVerb: '已停止任务', runningVerb: '正在停止任务', mutation: true, errorAccent: true },
  knowledge_browse: { icon: 'knowledgeBrowse', groupKind: 'runtime', category: '知识浏览', groupTitle: '知识', groupUnit: '浏览', completeVerb: '已浏览知识', runningVerb: '正在浏览知识' },
  knowledge_search: { icon: 'knowledgeSearch', groupKind: 'runtime', category: '知识搜索', groupTitle: '知识', groupUnit: '搜索', completeVerb: '已搜索知识', runningVerb: '正在搜索知识' },
  knowledge_read: { icon: 'knowledgeRead', groupKind: 'runtime', category: '知识读取', groupTitle: '知识', groupUnit: '读取', completeVerb: '已读取知识', runningVerb: '正在读取知识' },
  knowledge_compile: { icon: 'knowledgeCompile', groupKind: 'runtime', category: '知识编译', groupTitle: '知识', groupUnit: '编译', completeVerb: '已编译知识', runningVerb: '正在编译知识' },
  knowledge_candidate_create: { icon: 'knowledgeCandidate', groupKind: 'runtime', category: '知识候选', groupTitle: '知识', groupUnit: '候选', completeVerb: '已创建知识候选', runningVerb: '正在创建知识候选', mutation: true },
  investigation_read: { icon: 'investigationRead', groupKind: 'runtime', category: '调查读取', groupTitle: '调查', groupUnit: '读取', completeVerb: '已读取调查产物', runningVerb: '正在读取调查产物' },
  investigation_write: { icon: 'investigationWrite', groupKind: 'runtime', category: '调查写入', groupTitle: '调查', groupUnit: '写入', completeVerb: '已写入调查产物', runningVerb: '正在写入调查产物', mutation: true },
  investigation_list: { icon: 'investigationList', groupKind: 'runtime', category: '调查列表', groupTitle: '调查', groupUnit: '列表', completeVerb: '已列出调查产物', runningVerb: '正在列出调查产物' },
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

const FILE_FAMILY_TOOLS = new Set([
  'read_file',
  'artifact_read',
  'write_file',
  'edit_file',
  'delete_file',
  'move_file',
  'copy_file',
  'notebook_edit',
  'read_image',
]);

const SEARCH_FAMILY_TOOLS = new Set(['glob', 'grep']);

const GIT_FAMILY_TOOLS = new Set([
  'git_status',
  'git_diff',
  'git_log',
  'git_add',
  'git_unstage',
  'git_commit',
]);

/** Map a tool name onto the unified Work Process card family. */
export const getToolFamily = (toolName: string): WorkProcessToolFamily => {
  const normalized = normalizeToolName(toolName);
  if (FILE_FAMILY_TOOLS.has(normalized) || normalized === 'read') return 'file';
  if (SEARCH_FAMILY_TOOLS.has(normalized)) return 'search';
  if (normalized === 'shell' || normalized.includes('shell')) return 'shell';
  if (normalized === 'code_interpreter') return 'interpreter';
  if (GIT_FAMILY_TOOLS.has(normalized) || normalized.startsWith('git_')) return 'git';
  if (normalized === 'web_search' || normalized === 'web_fetch') return 'web';
  if (normalized.startsWith('memory_')) return 'memory';
  if (normalized === 'skills' || normalized === 'skill_read') return 'skill';
  if (normalized === 'mcp' || normalized.startsWith('mcp__')) return 'mcp';
  if (
    normalized === 'tool_search'
    || normalized === 'plan_artifact'
    || normalized === 'output_register'
    || normalized === 'rdx_context'
    || normalized === 'agent_handoff'
    || normalized.startsWith('knowledge_')
    || normalized.startsWith('investigation_')
  ) return 'runtime';
  return 'generic';
};
