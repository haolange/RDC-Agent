import type {
  ConversationToolApproval,
  ConversationToolApprovalStatus,
  ConversationToolCall,
  ConversationWorkBlock,
  ConversationWorkTrace,
} from '@shared/types/conversation';
import type { ThinkingArtifact } from '@shared/types/reasoning';

export type WorkProcessRowStatus = 'pending' | 'running' | 'complete' | 'error';

export type WorkProcessIconKey =
  | 'brain'
  | 'search'
  | 'file'
  | 'edit'
  | 'terminal'
  | 'globe'
  | 'git'
  | 'memory'
  | 'task'
  | 'question'
  | 'handoff'
  | 'spark'
  | 'plug'
  | 'monitor'
  | 'tool'
  | 'warning';

export type WorkProcessToolGroupKind =
  | 'explore'
  | 'search'
  | 'change'
  | 'command'
  | 'web'
  | 'git'
  | 'memory'
  | 'task'
  | 'interaction'
  | 'collaboration'
  | 'runtime'
  | 'mcp'
  | 'diagnostic';


export interface WorkProcessToolApproval {
  status: ConversationToolApprovalStatus;
  verb: string;
  message: string;
  metaLines: string[];
}

export type WorkProcessRow =
  | {
    type: 'summary';
    id: string;
    status: WorkProcessRowStatus;
    text: string;
    detailLines: string[];
    duration: string;
  }
  | {
    type: 'tool';
    id: string;
    status: WorkProcessRowStatus;
    verb: string;
    category: string;
    icon: WorkProcessIconKey;
    groupKind: WorkProcessToolGroupKind;
    toolName: string;
    target: string;
    duration: string;
    argsLines: string[];
    previewLines: string[];
    rawLines: string[];
    approval?: WorkProcessToolApproval;
    compact?: boolean;
  }
  | {
    type: 'userInput';
    id: string;
    status: WorkProcessRowStatus;
    verb: string;
    question: string;
    answer?: string;
    duration: string;
    detailLines: string[];
  }
  | {
    type: 'toolGroup';
    id: string;
    status: WorkProcessRowStatus;
    kind: WorkProcessToolGroupKind;
    icon: WorkProcessIconKey;
    title: string;
    countLabel: string;
    summary: string;
    duration: string;
    defaultOpen: boolean;
    rows: WorkProcessRow[];
  }
  | {
    type: 'approval';
    id: string;
    status: WorkProcessRowStatus;
    verb: string;
    message: string;
    duration: string;
    detailLines: string[];
    metaLines: string[];
  }
  | {
    type: 'diagnostic';
    id: string;
    status: WorkProcessRowStatus;
    message: string;
    detailLines: string[];
    duration: string;
  }
  | {
    type: 'subagent';
    id: string;
    status: WorkProcessRowStatus;
    profile: string;
    summary: string;
    detail: string;
    duration: string;
    children: WorkProcessRow[];
  }
  | {
    type: 'task';
    id: string;
    status: WorkProcessRowStatus;
    title: string;
    taskStatus: string;
    duration: string;
  }
  | {
    type: 'response';
    id: string;
    status: WorkProcessRowStatus;
    title: string;
    summary: string;
    duration: string;
    thinkingPreview: string;
    thinkingLabel: string;
    thinkingKind?: ThinkingArtifact['kind'];
    thinkingVisibility?: ThinkingArtifact['visibility'];
    thinkingStatus?: ConversationWorkBlock['thinkingStatus'];
    thinkingExpandable: boolean;
    thinkingOpenByDefault: boolean;
  }
  | {
    type: 'section';
    id: string;
    status: WorkProcessRowStatus;
    resultText: string;
    resultToolSummary: string;
    resultStreaming: boolean;
    clampResult: boolean;
    thinkingPreview: string;
    thinkingLabel: string;
    thinkingKind?: ThinkingArtifact['kind'];
    thinkingSource?: string;
    thinkingVisibility?: ThinkingArtifact['visibility'];
    thinkingStatus?: ConversationWorkBlock['thinkingStatus'];
    thinkingExpandable: boolean;
    thinkingOpenByDefault: boolean;
    stepCount: number;
    duration: string;
    defaultOpen: boolean;
    steps: WorkProcessRow[];
  };

export interface WorkProcessPresentation {
  rows: WorkProcessRow[];
  stepCount: number;
  toolCount: number;
  summary: string;
  duration: string;
  actionCount: number;
  defaultExpanded: boolean;
  important: boolean;
}

interface WorkProcessToolDisplay {
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

const ROW_STATUS_LABEL: Record<WorkProcessRowStatus, string> = {
  pending: '等待中',
  running: '进行中',
  complete: '',
  error: '失败',
};

export const WORK_PROCESS_TOOL_DISPLAY_CATALOG: Record<string, WorkProcessToolDisplay> = {
  read_file: { icon: 'file', groupKind: 'explore', category: '文件', groupTitle: '探索', groupUnit: '文件', completeVerb: '已读取', runningVerb: '正在读取' },
  glob: { icon: 'search', groupKind: 'explore', category: '文件', groupTitle: '探索', groupUnit: '文件', completeVerb: '已列出', runningVerb: '正在列出' },
  grep: { icon: 'search', groupKind: 'search', category: '搜索', groupTitle: '搜索', groupUnit: '查询', completeVerb: '已搜索代码', runningVerb: '正在搜索代码' },
  search_codebase: { icon: 'search', groupKind: 'search', category: '搜索', groupTitle: '搜索', groupUnit: '查询', completeVerb: '已搜索代码库', runningVerb: '正在搜索代码库' },
  web_fetch: { icon: 'globe', groupKind: 'web', category: '联网', groupTitle: '联网', groupUnit: '页面', completeVerb: '已抓取网页', runningVerb: '正在抓取网页', approval: true },
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
  ask_user_question: { icon: 'question', groupKind: 'interaction', category: '人机交互', groupTitle: '询问', groupUnit: '问题', completeVerb: '已询问', runningVerb: '正在询问' },
  tool_search: { icon: 'search', groupKind: 'runtime', category: '工具', groupTitle: '工具发现', groupUnit: '查询', completeVerb: '已搜索工具', runningVerb: '正在搜索工具' },
  agent_handoff: { icon: 'handoff', groupKind: 'collaboration', category: '协作', groupTitle: '协作', groupUnit: '交接', completeVerb: '已准备交接', runningVerb: '正在准备交接' },
  plan_artifact: { icon: 'spark', groupKind: 'runtime', category: '计划', groupTitle: '产物', groupUnit: '产物', completeVerb: '已生成计划', runningVerb: '正在生成计划' },
  memory_read: { icon: 'memory', groupKind: 'memory', category: '记忆', groupTitle: '记忆', groupUnit: '项', completeVerb: '已读取记忆', runningVerb: '正在读取记忆' },
  memory_write: { icon: 'memory', groupKind: 'memory', category: '记忆', groupTitle: '记忆', groupUnit: '项', completeVerb: '已写入记忆', runningVerb: '正在写入记忆', mutation: true },
  memory_delete: { icon: 'memory', groupKind: 'memory', category: '记忆', groupTitle: '记忆', groupUnit: '项', completeVerb: '已删除记忆', runningVerb: '正在删除记忆', mutation: true },
  skills: { icon: 'spark', groupKind: 'runtime', category: '技能', groupTitle: '技能', groupUnit: '查询', completeVerb: '已列出技能', runningVerb: '正在列出技能' },
  skill_run: { icon: 'spark', groupKind: 'runtime', category: '技能', groupTitle: '技能', groupUnit: '执行', completeVerb: '已运行技能', runningVerb: '正在运行技能' },
  mcp: { icon: 'plug', groupKind: 'mcp', category: 'MCP', groupTitle: 'MCP', groupUnit: '调用', completeVerb: '已查询 MCP', runningVerb: '正在查询 MCP' },
  rdx_context: { icon: 'monitor', groupKind: 'runtime', category: 'RDX', groupTitle: 'RDX 上下文', groupUnit: '读取', completeVerb: '已读取 RDX 上下文', runningVerb: '正在读取 RDX 上下文' },
  subagent: { icon: 'handoff', groupKind: 'collaboration', category: '协作', groupTitle: '协作', groupUnit: '子任务', completeVerb: '已调用子代理', runningVerb: '正在调用子代理' },
  task_create: { icon: 'task', groupKind: 'task', category: '任务', groupTitle: '任务', groupUnit: '项', completeVerb: '已创建任务', runningVerb: '正在创建任务', mutation: true },
  task_update: { icon: 'task', groupKind: 'task', category: '任务', groupTitle: '任务', groupUnit: '项', completeVerb: '已更新任务', runningVerb: '正在更新任务', mutation: true },
  task_get: { icon: 'task', groupKind: 'task', category: '任务', groupTitle: '任务', groupUnit: '项', completeVerb: '已读取任务', runningVerb: '正在读取任务' },
  task_list: { icon: 'task', groupKind: 'task', category: '任务', groupTitle: '任务', groupUnit: '项', completeVerb: '已列出任务', runningVerb: '正在列出任务' },
  task_stop: { icon: 'task', groupKind: 'task', category: '任务', groupTitle: '任务', groupUnit: '项', completeVerb: '已停止任务', runningVerb: '正在停止任务', mutation: true, errorAccent: true },
};

const TARGET_KEYS = [
  'path',
  'title',
  'file',
  'filePath',
  'filepath',
  'target',
  'pattern',
  'query',
  'url',
  'command',
  'cmd',
  'cwd',
  'glob',
  'include',
  'input',
  'subject',
  'taskId',
  'name',
  'agent',
  'source',
  'destination',
  'dest',
  'from',
  'to',
];

const RAW_PAYLOAD_TARGET_KEYS = new Set(['content', 'text', 'body', 'payload']);
const INTERNAL_BLOCK_IDS = new Set(['runtime-run', 'assistant-output', 'runtime-reasoning']);

const normalizeThinkingDedupKey = (value: string): string => normalizeWorkProcessText(value).toLowerCase();

const resolveSectionResult = (
  block: ConversationWorkBlock,
): { resultText: string; resultToolSummary: string; resultStreaming: boolean; clampResult: boolean } => {
  const resultText = normalizeWorkProcessText(block.result?.text ?? '');
  const resultStatus = block.result?.status ?? (block.status === 'running' || block.status === 'pending' ? 'streaming' : 'complete');
  return {
    resultText: block.toolCalls.length > 0 && isMeaningfulText(resultText) ? resultText : '',
    resultToolSummary: '',
    resultStreaming: resultStatus === 'streaming',
    clampResult: true,
  };
};

const resolveSectionThinking = (
  block: ConversationWorkBlock,
  hasVisibleEvidence: boolean,
): {
  preview: string;
  label: string;
  kind?: ThinkingArtifact['kind'];
  source?: string;
  visibility?: ThinkingArtifact['visibility'];
  status?: ConversationWorkBlock['thinkingStatus'];
  expandable: boolean;
  openByDefault: boolean;
} => {
  const thinking = block.thinking;
  if (!hasVisibleEvidence || !thinking) {
    return { preview: '', label: '', expandable: false, openByDefault: false };
  }

  const isActiveBlock = block.status === 'running' || block.status === 'pending';
  const status = isActiveBlock ? block.thinkingStatus ?? 'streaming' : 'complete';
  if (thinking.kind === 'opaque' || thinking.visibility === 'hidden') {
    return {
      preview: '',
      label: '',
      kind: thinking.kind,
      source: '',
      visibility: thinking.visibility,
      status,
      expandable: false,
      openByDefault: false,
    };
  }

  const preview = normalizeWorkProcessText(thinking.text ?? '');
  if (!preview) {
    return { preview: '', label: '', expandable: false, openByDefault: false };
  }

  const isSummary = thinking.kind === 'summary' && thinking.visibility === 'summary';
  const isRaw = thinking.kind === 'raw' && thinking.visibility === 'raw-collapsed';
  if (!isSummary && !isRaw) {
    return { preview: '', label: '', expandable: false, openByDefault: false };
  }

  return {
    preview,
    label: status === 'streaming' || block.status === 'running' || block.status === 'pending'
      ? '正在思考'
      : isSummary ? '思考' : '原始思考',
    kind: thinking.kind,
    source: '',
    visibility: thinking.visibility,
    status,
    expandable: true,
    openByDefault: isSummary,
  };
};

const resolveResponseThinking = (
  block: ConversationWorkBlock,
): {
  preview: string;
  label: string;
  kind?: ThinkingArtifact['kind'];
  visibility?: ThinkingArtifact['visibility'];
  status?: ConversationWorkBlock['thinkingStatus'];
  expandable: boolean;
  openByDefault: boolean;
} => {
  const resolved = resolveSectionThinking(block, Boolean(block.thinking));
  if (!resolved.expandable) return { ...resolved, label: '', openByDefault: false };
  return {
    preview: resolved.preview,
    label: resolved.kind === 'summary' ? '收束摘要' : resolved.label,
    kind: resolved.kind,
    visibility: resolved.visibility,
    status: resolved.status,
    expandable: true,
    openByDefault: false,
  };
};

export const normalizeWorkProcessText = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
};

const normalizeToolName = (toolName: string): string => toolName.trim().toLowerCase().replace(/[.\-]/g, '_');

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

const getToolDisplay = (toolName: string): WorkProcessToolDisplay => {
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

const formatMcpTarget = (toolName: string): string => {
  const parts = getMcpParts(normalizeToolName(toolName));
  return parts ? `${parts.server}/${parts.tool}` : '';
};

const NOISY_TEXT_PATTERNS = [
  /agent loop/i,
  /model and tool loop/i,
  /final answer/i,
  /response complete/i,
  /reply completed/i,
  /assistant output ready/i,
  /start agent loop/i,
  /回复已完成/,
  /回答已完成/,
];

export const formatDurationMs = (start?: number, end?: number): string => {
  if (!start) return '';
  const finish = end ?? Date.now();
  const ms = Math.max(0, finish - start);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
};

export const getRowStatusLabel = (status: WorkProcessRowStatus): string => ROW_STATUS_LABEL[status];

export const buildWorkProcessPresentation = (
  trace: ConversationWorkTrace,
): WorkProcessPresentation => {
  const rows = blocksToRows(trace.blocks);
  const toolCount = countToolSteps(rows);
  const stepCount = countSteps(rows);
  const important = trace.status === 'error' || rowsHaveAttention(rows);
  const summary = isMeaningfulText(trace.summary) ? trace.summary?.trim() ?? '' : '';

  return {
    rows,
    stepCount,
    toolCount,
    actionCount: toolCount,
    summary,
    duration: formatTraceDuration(trace.blocks),
    defaultExpanded: trace.status !== 'idle' || rows.length > 0 || Boolean(summary),
    important,
  };
};

const blocksToRows = (blocks: ConversationWorkBlock[]): WorkProcessRow[] => {
  const rows: WorkProcessRow[] = [];
  const visibleThinkingKeys = new Set<string>();
  let hasVisibleProcessEvidence = false;

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];
    if (block.kind === 'llm_turn') {
      const steps = groupProcessRows(block.toolCalls.map((call) => createToolRow(call, true)));
      if (steps.length === 0) {
        const responseRow = createResponseRow(block, hasVisibleProcessEvidence);
        if (responseRow) {
          const responseHasResultText = Boolean(normalizeWorkProcessText(block.result?.text ?? ''));
          if (responseRow.thinkingPreview && responseRow.thinkingKind !== 'raw') {
            const thinkingKey = normalizeThinkingDedupKey(responseRow.thinkingPreview);
            if (visibleThinkingKeys.has(thinkingKey)) {
              responseRow.thinkingPreview = '';
              responseRow.thinkingLabel = '';
              responseRow.thinkingExpandable = false;
              responseRow.thinkingOpenByDefault = false;
            } else {
              visibleThinkingKeys.add(thinkingKey);
            }
          }
          if (!responseHasResultText && !responseRow.thinkingLabel) {
            continue;
          }
          rows.push(responseRow);
          hasVisibleProcessEvidence = true;
          continue;
        }
      }
      const sectionResult = resolveSectionResult(block);
      const sectionThinking = resolveSectionThinking(block, steps.length > 0 || Boolean(block.thinking));
      if (sectionThinking.preview && sectionThinking.kind !== 'raw') {
        const thinkingKey = normalizeThinkingDedupKey(sectionThinking.preview);
        if (visibleThinkingKeys.has(thinkingKey)) {
          sectionThinking.preview = '';
          sectionThinking.label = '';
          sectionThinking.source = '';
          sectionThinking.expandable = false;
          sectionThinking.openByDefault = false;
        } else {
          visibleThinkingKeys.add(thinkingKey);
        }
      }
      if (
        steps.length === 0
        && !sectionResult.resultText
        && !sectionResult.resultToolSummary
        && !sectionThinking.label
      ) {
        continue;
      }
      rows.push({
        type: 'section',
        id: block.id,
        status: block.status,
        resultText: sectionResult.resultText,
        resultToolSummary: sectionResult.resultToolSummary,
        resultStreaming: sectionResult.resultStreaming,
        clampResult: sectionResult.clampResult,
        thinkingPreview: sectionThinking.preview,
        thinkingLabel: sectionThinking.label,
        thinkingKind: sectionThinking.kind,
        thinkingSource: sectionThinking.source,
        thinkingVisibility: sectionThinking.visibility,
        thinkingStatus: sectionThinking.status,
        thinkingExpandable: sectionThinking.expandable,
        thinkingOpenByDefault: sectionThinking.openByDefault,
        stepCount: countToolSteps(steps),
        duration: formatDurationMs(block.startedAt, block.completedAt),
        defaultOpen: false,
        steps,
      });
      hasVisibleProcessEvidence = true;
      continue;
    }

    if (block.kind === 'user_input') {
      const userInputRows = groupProcessRows(block.toolCalls.map((call) => createToolRow(call)));
      if (!appendRowsToLastSection(rows, userInputRows)) {
        rows.push(...userInputRows);
      }
      if (userInputRows.length > 0) hasVisibleProcessEvidence = true;
      continue;
    }

    if (block.kind === 'output') {
      if (
        hasVisibleProcessEvidence
        && !rows.some((row) => row.type === 'response')
        && !hasLaterAnswerOnlyLoop(blocks, blockIndex)
      ) {
        rows.push(createOutputResponseRow(block));
      }
      continue;
    }

    if (shouldSkipBlock(block)) {
      continue;
    }

    if (block.kind === 'approval') {
      rows.push(createApprovalRow(block));
      hasVisibleProcessEvidence = true;
      continue;
    }

    if (block.kind === 'subagent') {
      const childRows = block.children ? blocksToRows(block.children) : [];
      rows.push({
        type: 'subagent',
        id: block.id,
        status: block.status,
        profile: block.title.replace(/^Sub-agent[:?]\s*/, '').trim() || 'sub-agent',
        summary: getMeaningfulBlockSummary(block) || block.summary || '',
        detail: block.detail ?? '',
        duration: formatDurationMs(block.startedAt, block.completedAt),
        children: childRows,
      });
      hasVisibleProcessEvidence = true;
      continue;
    }

    if (block.kind === 'command') {
      const summaryText = getMeaningfulBlockSummary(block);
      if (summaryText) {
        const taskStatus = block.status === 'error'
          ? 'failed'
          : block.status === 'running'
            ? 'in_progress'
            : block.status === 'pending'
              ? 'pending'
              : 'completed';
        rows.push({
          type: 'task',
          id: block.id,
          status: block.status,
          title: summaryText,
          taskStatus,
          duration: formatDurationMs(block.startedAt, block.completedAt),
        });
        hasVisibleProcessEvidence = true;
      }
      continue;
    }

    if (block.kind === 'diagnostic' || block.status === 'error') {
      rows.push(createDiagnosticRow(block));
      hasVisibleProcessEvidence = true;
      continue;
    }

    const summaryText = getMeaningfulBlockSummary(block);
    if (summaryText) {
      rows.push({
        type: 'summary',
        id: block.id,
        status: block.status,
        text: summaryText,
        detailLines: createDetailLines(block.detail, 10),
        duration: formatDurationMs(block.startedAt, block.completedAt),
      });
      hasVisibleProcessEvidence = true;
    }
  }

  markLastSectionOpen(rows);
  return rows;
};

const hasLaterAnswerOnlyLoop = (blocks: ConversationWorkBlock[], blockIndex: number): boolean => (
  blocks.slice(blockIndex + 1).some((block) => (
    block.kind === 'llm_turn'
    && block.toolCalls.length === 0
    && (
      Boolean(normalizeWorkProcessText(block.result?.text ?? ''))
      || Boolean(block.thinking)
    )
  ))
);

const createResponseRow = (
  block: ConversationWorkBlock,
  hasVisibleProcessEvidence: boolean,
): Extract<WorkProcessRow, { type: 'response' }> | null => {
  const resultText = normalizeWorkProcessText(block.result?.text ?? '');
  const thinking = resolveResponseThinking(block);
  const isTerminal = block.status === 'complete' || block.status === 'error';
  const hasFinalResponseBoundary = hasVisibleProcessEvidence
    && (Boolean(resultText) || (isTerminal && Boolean(thinking.label)));
  if (!hasFinalResponseBoundary) return null;

  return {
    type: 'response',
    id: `response-${block.id}`,
    status: block.status,
    title: '回复',
    summary: getResponseSummary(block.status),
    duration: formatDurationMs(block.startedAt, block.completedAt),
    thinkingPreview: thinking.preview,
    thinkingLabel: thinking.label,
    thinkingKind: thinking.kind,
    thinkingVisibility: thinking.visibility,
    thinkingStatus: thinking.status,
    thinkingExpandable: thinking.expandable,
    thinkingOpenByDefault: thinking.openByDefault,
  };
};

const createOutputResponseRow = (
  block: ConversationWorkBlock,
): Extract<WorkProcessRow, { type: 'response' }> => ({
  type: 'response',
  id: `response-${block.id}`,
  status: block.status,
  title: '回复',
  summary: getResponseSummary(block.status),
  duration: formatDurationMs(block.startedAt, block.completedAt),
  thinkingPreview: '',
  thinkingLabel: '',
  thinkingExpandable: false,
  thinkingOpenByDefault: false,
});

const getResponseSummary = (status: WorkProcessRowStatus): string => {
  if (status === 'running' || status === 'pending') return '正在生成最终回复';
  if (status === 'error') return '回复未完成';
  return '回复已生成';
};

const appendRowsToLastSection = (rows: WorkProcessRow[], childRows: WorkProcessRow[]): boolean => {
  if (childRows.length === 0) return true;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.type !== 'section') continue;
    row.steps.push(...childRows);
    row.stepCount = countToolSteps(row.steps);
    if (row.status === 'complete' && childRows.some((child) => child.status === 'running' || child.status === 'pending')) {
      row.status = 'running';
    }
    if (childRows.some((child) => child.status === 'error')) {
      row.status = 'error';
      row.defaultOpen = true;
    }
    return true;
  }
  return false;
};

const markLastSectionOpen = (rows: WorkProcessRow[]): void => {
  let lastSectionIndex = -1;
  rows.forEach((row, index) => {
    if (row.type === 'section') lastSectionIndex = index;
  });
  if (lastSectionIndex < 0) return;
  const lastSection = rows[lastSectionIndex];
  if (lastSection.type === 'section' && lastSection.status !== 'complete') lastSection.defaultOpen = true;
};

type GroupableWorkProcessRow = Extract<WorkProcessRow, { type: 'tool' | 'userInput' }>;

const isGroupableWorkProcessRow = (row: WorkProcessRow): row is GroupableWorkProcessRow => (
  row.type === 'tool' || row.type === 'userInput'
);

const groupProcessRows = (rows: WorkProcessRow[]): WorkProcessRow[] => {
  const grouped: WorkProcessRow[] = [];
  let bucket: GroupableWorkProcessRow[] = [];
  let bucketKey = '';

  const flush = (): void => {
    if (bucket.length === 0) return;
    grouped.push(createToolGroupRow(bucket, grouped.length));
    bucket = [];
    bucketKey = '';
  };

  for (const row of rows) {
    if (!isGroupableWorkProcessRow(row)) {
      flush();
      grouped.push(row);
      continue;
    }

    const nextKey = getGroupKey(row);
    if (bucket.length > 0 && nextKey !== bucketKey) flush();
    bucket.push(row);
    bucketKey = nextKey;
  }

  flush();
  return grouped;
};

const getGroupKey = (row: GroupableWorkProcessRow): string => {
  if (row.type === 'userInput') return 'interaction:询问';
  const display = getToolDisplay(row.toolName);
  return `${display.groupKind}:${display.groupTitle}`;
};

const createToolGroupRow = (rows: GroupableWorkProcessRow[], index: number): Extract<WorkProcessRow, { type: 'toolGroup' }> => {
  const first = rows[0];
  const display = first.type === 'tool' ? getToolDisplay(first.toolName) : WORK_PROCESS_TOOL_DISPLAY_CATALOG.ask_user;
  const status = deriveGroupStatus(rows);
  const unit = resolveGroupUnit(rows);
  const title = resolveGroupTitle(rows, display.groupTitle);

  return {
    type: 'toolGroup',
    id: `tool-group-${index}-${first.id}`,
    status,
    kind: display.groupKind,
    icon: display.icon,
    title,
    countLabel: `${rows.length} ${unit}`,
    summary: rows.map(formatGroupRowSummary).filter(Boolean).slice(0, 3).join(' · '),
    duration: rows.length === 1 ? first.duration : '',
    defaultOpen: true,
    rows,
  };
};

const deriveGroupStatus = (rows: GroupableWorkProcessRow[]): WorkProcessRowStatus => {
  if (rows.some((row) => row.status === 'error')) return 'error';
  if (rows.some((row) => row.status === 'running')) return 'running';
  if (rows.some((row) => row.status === 'pending')) return 'pending';
  return 'complete';
};

const resolveGroupUnit = (rows: GroupableWorkProcessRow[]): string => {
  const units = new Set(rows.map((row) => (
    row.type === 'tool' ? getToolDisplay(row.toolName).groupUnit : WORK_PROCESS_TOOL_DISPLAY_CATALOG.ask_user.groupUnit
  )));
  return units.size === 1 ? [...units][0] : '动作';
};

const resolveGroupTitle = (rows: GroupableWorkProcessRow[], fallback: string): string => {
  const mcpServers = rows
    .filter((row): row is Extract<WorkProcessRow, { type: 'tool' }> => row.type === 'tool')
    .map((row) => getMcpParts(normalizeToolName(row.toolName))?.server)
    .filter((server): server is string => Boolean(server));
  if (mcpServers.length > 0 && new Set(mcpServers).size === 1) return `MCP · ${mcpServers[0]}`;
  return fallback;
};

const formatGroupRowSummary = (row: GroupableWorkProcessRow): string => {
  if (row.type === 'userInput') return `${row.verb} ${row.question}`;
  return [row.verb, row.target].filter(Boolean).join(' ');
};

const countToolSteps = (rows: WorkProcessRow[]): number => rows.reduce((total, row) => {
  if (row.type === 'section') return total + countToolSteps(row.steps);
  if (row.type === 'toolGroup') return total + countToolSteps(row.rows);
  if (row.type === 'tool' || row.type === 'userInput') return total + 1;
  return total;
}, 0);

const countSteps = (rows: WorkProcessRow[]): number => rows.reduce((total, row) => {
  if (row.type === 'section') return total + 1 + countSteps(row.steps);
  if (row.type === 'toolGroup') return total + 1 + countSteps(row.rows);
  return total + 1;
}, 0);

const rowsHaveAttention = (rows: WorkProcessRow[]): boolean => rows.some((row) => {
  if (row.type === 'section') return row.status === 'running' || row.status === 'error' || rowsHaveAttention(row.steps);
  if (row.type === 'toolGroup') return row.status === 'running' || row.status === 'error' || rowsHaveAttention(row.rows);
  return row.status === 'error' || row.status === 'running';
});

const formatTraceDuration = (blocks: ConversationWorkBlock[]): string => {
  const timestamps = blocks.flatMap((block) => [block.startedAt, block.completedAt].filter(isNumber));
  if (timestamps.length === 0) return '';
  return formatDurationMs(Math.min(...timestamps), blocks.some((block) => !block.completedAt) ? undefined : Math.max(...timestamps));
};

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const createToolRow = (call: ConversationToolCall, compact = false): WorkProcessRow => {
  if (normalizeToolName(call.toolName) === 'ask_user') {
    return createUserInputRow(call);
  }
  const display = getToolDisplay(call.toolName);
  const approval = createToolApprovalPresentation(call.approval, call.toolName);
  const rawResult = call.error || call.resultPreview;
  const parsedResult = parsePreview(rawResult);
  const suppressApprovalPreview = Boolean(approval) && isApprovalRequiredPreview(parsedResult, rawResult);
  const status = deriveToolStatus(call, parsedResult);
  const previewLineLimit = /read_file|^read$/i.test(normalizeToolName(call.toolName)) ? 4 : 3;
  const rawPreviewLines = suppressApprovalPreview
    ? []
    : call.error
      ? createDetailLines(call.error, 4)
      : extractReadableResultLines(parsedResult, call.resultPreview, previewLineLimit);
  const previewLines = enhanceToolPreviewLines(
    call.toolName,
    parsedResult,
    suppressApprovalPreview ? undefined : call.resultPreview,
    !call.error && isLikelyBinaryText(rawPreviewLines.join('\n'))
      ? ['Binary content omitted from preview.']
      : rawPreviewLines,
  );

  return {
    type: 'tool',
    id: call.id,
    status,
    verb: getToolVerb(call.toolName, status, call.error || call.resultPreview, call.approval),
    category: display.category,
    icon: display.icon,
    groupKind: display.groupKind,
    toolName: call.toolName,
    target: getToolTarget(call.toolName, call.argsPreview),
    duration: formatDurationMs(call.startedAt, call.completedAt),
    argsLines: createDetailLines(prettyPrint(call.argsPreview), 10),
    previewLines,
    rawLines: suppressApprovalPreview ? [] : createDetailLines(prettyPrint(call.error || call.resultPreview), 16),
    approval,
    compact,
  };
};

const createToolApprovalPresentation = (
  approval: ConversationToolApproval | undefined,
  toolName: string,
): WorkProcessToolApproval | undefined => {
  if (!approval) return undefined;
  const isAutoReview = approval.reviewer === 'auto_review' || approval.approvalId.startsWith('auto-review-');
  const reason = normalizeApprovalMessage(approval.reason, toolName);
  const answer = normalizeApprovalMessage(approval.answer, toolName);
  const messageSource = approval.status === 'approved'
    ? (isGenericDecisionText(answer) ? '' : answer)
    : (isGenericDecisionText(answer) ? reason : answer) || reason;
  const message = compactText(messageSource || fallbackApprovalMessage(approval.status), 300);
  const metaLines = [
    approval.risk ? `风险：${approval.risk}` : '',
    isAutoReview ? '自动检查' : '人工审批',
  ].filter(Boolean);

  return {
    status: approval.status,
    verb: getToolApprovalVerb(approval.status, isAutoReview),
    message,
    metaLines,
  };
};

const getToolApprovalVerb = (status: ConversationToolApprovalStatus, isAutoReview: boolean): string => {
  if (status === 'pending') return isAutoReview ? '自动检查中' : '等待审批';
  if (status === 'approved') return isAutoReview ? '自动检查通过' : '已批准';
  if (status === 'rejected') return isAutoReview ? '自动检查拒绝' : '已拒绝';
  return '已取消';
};

const fallbackApprovalMessage = (status: ConversationToolApprovalStatus): string => {
  if (status === 'pending') return '当前权限模式要求先审批这个动作。';
  if (status === 'approved') return '这个动作已经批准继续执行。';
  if (status === 'rejected') return '这个动作已被拒绝。';
  return '这个动作已取消。';
};

const normalizeApprovalMessage = (value: string | undefined, toolName: string): string => {
  const text = value?.trim() ?? '';
  if (!text) return '';
  const networkMatch = text.match(/^Network tool "([^"]+)" requires approval in the current permission mode.?$/i);
  if (networkMatch) return `当前权限模式要求先审批 ${networkMatch[1]}。`;
  const toolMatch = text.match(/^Tool "([^"]+)" requires approval(?: before it can run)?.?$/i);
  if (toolMatch) return `当前权限模式要求先审批 ${toolMatch[1]}。`;
  if (/requires approval/i.test(text)) return `当前权限模式要求先审批 ${toolName}。`;
  return text;
};

const isGenericDecisionText = (value: string): boolean => (
  /^(approved once|user denied)$/i.test(value.trim())
);

const isToolApprovalRejected = (approval: ConversationToolApproval | undefined): boolean => (
  approval?.status === 'rejected' || approval?.status === 'cancelled'
);

const isApprovalRequiredPreview = (parsedResult: unknown, raw?: string): boolean => {
  const record = toRecord(parsedResult);
  const errorMessage = record
    ? readNestedString(record, ['error', 'message']) || readNestedString(record, ['message'])
    : '';
  return /approval required|requires approval/i.test(`${errorMessage} ${raw ?? ''}`);
};
export const createToolRowForPresentation = (
  call: ConversationToolCall,
  compact = false,
): WorkProcessRow => createToolRow(call, compact);

const createUserInputRow = (call: ConversationToolCall): WorkProcessRow => {
  const args = parsePreview(call.argsPreview);
  const record = toRecord(args) ?? {};
  const question = stringifyPreview(record.question);
  const rawChoices = record.choices;
  const choices = Array.isArray(rawChoices)
    ? rawChoices.map(stringifyPreview).filter(Boolean)
    : [];
  const status = call.status === 'complete'
    ? 'complete'
    : call.status === 'error' || call.error
      ? 'error'
      : 'running';
  const answer = status === 'complete' && call.resultPreview?.trim()
    ? call.resultPreview.trim()
    : undefined;
  const detailLines = [
    question ? `问题：${question}` : '',
    ...choices.map((choice, index) => `选项 ${index + 1}：${choice}`),
    answer ? `回答：${answer}` : '',
    call.error ? `错误：${call.error}` : '',
  ].filter(Boolean);

  return {
    type: 'userInput',
    id: call.id,
    status,
    verb: status === 'complete' ? '已回答' : status === 'error' ? '用户交互中断' : '等待用户',
    question: compactText(question || '等待用户输入。', 280),
    answer,
    duration: formatDurationMs(call.startedAt, call.completedAt),
    detailLines,
  };
};

const createApprovalRow = (block: ConversationWorkBlock): WorkProcessRow => {
  const parsed = parsePreview(block.detail);
  const record = toRecord(parsed) ?? {};
  const detailAnswer = typeof parsed === 'string' ? parsed : stringifyPreview(record.answer);
  const reviewer = stringifyPreview(record.reviewer);
  const toolName = stringifyPreview(record.toolName);
  const risk = stringifyPreview(record.risk);
  const isAutoReview = reviewer === 'auto_review' || block.id.includes('auto-review');
  const resolvedText = (detailAnswer || getMeaningfulBlockSummary(block) || '').trim();
  const isGenericDecision = /^(approved once|user denied)$/i.test(resolvedText);
  const message = isGenericDecision ? '' : compactText(resolvedText, 300);

  return {
    type: 'approval',
    id: block.id,
    status: block.status,
    verb: getApprovalVerb(block.status, isAutoReview),
    message,
    duration: formatDurationMs(block.startedAt, block.completedAt),
    detailLines: [],
    metaLines: [
      toolName ? `工具：${toolName}` : '',
      risk ? `风险：${risk}` : '',
    ].filter(Boolean),
  };
};

const getApprovalVerb = (status: WorkProcessRowStatus, isAutoReview: boolean): string => {
  if (status === 'error') return isAutoReview ? '自动检查拒绝' : '已拒绝';
  if (status === 'running' || status === 'pending') return isAutoReview ? '自动检查中' : '等待审批';
  return isAutoReview ? '自动检查通过' : '已批准';
};

const deriveToolStatus = (call: ConversationToolCall, parsedResult: unknown): WorkProcessRowStatus => {
  if (call.approval?.status === 'pending') return 'running';
  if (isToolApprovalRejected(call.approval)) return 'error';
  if (call.status === 'error' || call.error) return 'error';
  if (call.status !== 'complete') return call.status;
  if (resultIndicatesFailure(parsedResult, call.resultPreview)) return 'error';
  return call.status;
};

const getToolVerb = (
  toolName: string,
  status: WorkProcessRowStatus,
  resultPreview?: string,
  approval?: ConversationToolApproval,
): string => {
  const display = getToolDisplay(toolName);
  if (approval?.status === 'pending') return '等待审批';
  if (status === 'pending') return display.pendingVerb ?? '等待执行';
  if (status === 'running') return display.runningVerb;
  if (status !== 'error') return display.completeVerb;
  return isToolApprovalRejected(approval) || /approval required|no changes were made/i.test(resultPreview ?? '') ? '已阻断' : '执行失败';
};

const resultIndicatesFailure = (parsedResult: unknown, raw?: string): boolean => {
  const record = toRecord(parsedResult);
  if (record) {
    if (record.ok === false) return true;
    const status = String(record.status ?? readNestedValue(record, ['data', 'status']) ?? '').toLowerCase();
    if (status === 'error' || status === 'failed') return true;
    const errorMessage = readNestedString(record, ['error', 'message']) || readNestedString(record, ['message']);
    if (/approval required|no changes were made/i.test(errorMessage)) return true;
  }
  return /approval required|no changes were made/i.test(raw ?? '');
};

const createDiagnosticRow = (block: ConversationWorkBlock): WorkProcessRow => ({
  type: 'diagnostic',
  id: block.id,
  status: block.status === 'error' ? 'error' : block.status,
  message: getMeaningfulBlockSummary(block) || block.title || 'Runtime diagnostic',
  detailLines: createDetailLines(block.detail, 12),
  duration: formatDurationMs(block.startedAt, block.completedAt),
});

const shouldSkipBlock = (block: ConversationWorkBlock): boolean => {
  if (INTERNAL_BLOCK_IDS.has(block.id) || block.kind === 'output') return true;
  if (block.kind === 'user_input') return true;
  if (block.kind === 'approval' && block.status === 'complete') return true;
  if (!block.summary && isNoisyText(block.title)) return true;
  return false;
};

const getMeaningfulBlockSummary = (block: ConversationWorkBlock): string => {
  const candidates = [block.summary, block.title].map((value) => value?.trim()).filter(Boolean) as string[];
  return candidates.find((value) => isMeaningfulText(value)) ?? '';
};

const isMeaningfulText = (value?: string): value is string => Boolean(value?.trim()) && !isNoisyText(value);

const isNoisyText = (value?: string): boolean => {
  const text = value?.trim();
  if (!text) return true;
  return NOISY_TEXT_PATTERNS.some((pattern) => pattern.test(text));
};

const getToolTarget = (toolName: string, argsPreview?: string): string => {
  const mcpTarget = formatMcpTarget(toolName);
  const parsed = parsePreview(argsPreview);
  const record = toRecord(parsed);
  if (!record) {
    const text = stringifyPreview(parsed);
    if (mcpTarget) return mcpTarget;
    return isRawPayloadPreview(text) ? '' : compactText(text, 180);
  }

  const source = stringifyPreview(record.source ?? record.from);
  const destination = stringifyPreview(record.destination ?? record.dest ?? record.to);
  if (source && destination) return compactText(`${source} -> ${destination}`, 180);
  if (mcpTarget) return mcpTarget;

  for (const key of TARGET_KEYS) {
    const text = stringifyPreview(record[key]);
    if (text) return compactText(text, 180);
  }

  const fallback = Object.entries(record)
    .filter(([key]) => !RAW_PAYLOAD_TARGET_KEYS.has(key))
    .map(([, value]) => stringifyPreview(value))
    .find((text) => text.length > 0 && text.length < 160);
  return fallback ? compactText(fallback, 180) : '';
};

const extractReadableResultLines = (parsed: unknown, raw?: string, maxLines = 3): string[] => {
  const collected = collectReadableText(parsed, maxLines);
  if (collected.length > 0) return collected.slice(0, maxLines);
  if (parsed && typeof parsed === 'object') {
    const rawLines = createDetailLines(raw, maxLines);
    return rawLines.length > 0 ? rawLines : [];
  }
  return createDetailLines(raw, maxLines);
};

const enhanceToolPreviewLines = (
  toolName: string,
  parsed: unknown,
  raw: string | undefined,
  previewLines: string[],
): string[] => {
  const normalized = normalizeToolName(toolName);
  const record = toRecord(parsed);

  if (normalized === 'bash' || normalized.includes('shell')) {
    const exitCode = record?.exitCode ?? record?.exit_code ?? readNestedValue(record ?? {}, ['result', 'exitCode']);
    const stdout = stringifyPreview(record?.stdout ?? readNestedValue(record ?? {}, ['result', 'stdout']));
    const lines = [
      exitCode !== undefined && exitCode !== null ? `exit ${String(exitCode)}` : '',
      ...createDetailLines(stdout || raw, 3),
    ].filter(Boolean);
    if (lines.length > 0) return lines.slice(0, 4);
  }

  if (/grep|glob|search_codebase/.test(normalized)) {
    const matches = collectReadableText(
      record?.matches ?? record?.files ?? record?.paths ?? readNestedValue(record ?? {}, ['data', 'matches']),
      4,
    );
    if (matches.length > 0) return matches;
  }

  if (/read_file|^read$/.test(normalized)) {
    const lineCount = record?.lineCount ?? record?.lines ?? readNestedValue(record ?? {}, ['meta', 'lineCount']);
    if (lineCount !== undefined) {
      return [`${String(lineCount)} lines`, ...previewLines].filter(Boolean).slice(0, 3);
    }
  }

  if (normalized.startsWith('git_')) {
    const summary = stringifyPreview(record?.summary ?? record?.status ?? record?.output ?? raw);
    const lines = createDetailLines(summary, 3);
    if (lines.length > 0) return lines;
  }

  if (/web_fetch|web_search/.test(normalized)) {
    const details = getDetailsRecord(record);
    if (details?.kind === 'search' || normalized === 'web_search') {
      const resultRecords = getRecordArray(
        details?.results
        ?? record?.results
        ?? readNestedValue(record ?? {}, ['data', 'details', 'results']),
      );
      const resultLines = resultRecords.slice(0, 3).flatMap((result, index) => {
        const title = stringifyPreview(result.title);
        const url = stringifyPreview(result.url);
        const source = stringifyPreview(result.source ?? result.domain);
        const publishedAt = stringifyPreview(result.publishedAt ?? result.date);
        return [
          title ? `${index + 1}. ${title}` : '',
          url,
          source || publishedAt ? [source ? `Source: ${source}` : '', publishedAt ? `Date: ${publishedAt}` : ''].filter(Boolean).join(' / ') : '',
        ].filter(Boolean);
      });
      const lines = [
        stringifyPreview(details?.provider) ? `Provider: ${stringifyPreview(details?.provider)}` : '',
        stringifyPreview(details?.resultCount) ? `Results: ${stringifyPreview(details?.resultCount)}` : '',
        ...resultLines,
      ].filter(Boolean);
      if (lines.length > 0) return lines.slice(0, 8);
    }

    const status = stringifyPreview(details?.status ?? record?.status ?? record?.statusCode);
    const statusText = stringifyPreview(details?.statusText ?? record?.statusText);
    const url = stringifyPreview(details?.url ?? record?.url ?? readNestedValue(record ?? {}, ['data', 'details', 'url']));
    const lines = [
      status ? `HTTP ${status}${statusText ? ` ${statusText}` : ''}` : '',
      url,
    ].filter(Boolean);
    if (lines.length > 0) return [...lines, ...previewLines].slice(0, 4);
  }

  if (normalized.startsWith('task_') || normalized.startsWith('memory_')) {
    const summary = stringifyPreview(
      record?.subject
      ?? record?.name
      ?? record?.taskId
      ?? record?.id
      ?? record?.title,
    );
    if (summary) return [summary, ...previewLines].slice(0, 3);
  }

  return previewLines;
};

const getDetailsRecord = (record: Record<string, unknown> | null | undefined): Record<string, unknown> | null => {
  if (!record) return null;
  return toRecord(record.details)
    ?? toRecord(readNestedValue(record, ['data', 'details']))
    ?? toRecord(readNestedValue(record, ['result', 'details']));
};


const getRecordArray = (value: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(value)) return [];
  return value.map(toRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry));
};

const isRawPayloadPreview = (value: string): boolean => {
  const text = value.trim();
  if (!text) return false;
  return /^\{?\s*"?(?:content|text|body|payload)"?\s*:/.test(text);
};

const collectReadableText = (value: unknown, maxLines = 6): string[] => {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') {
    const extracted = extractContentTextFromJsonishString(value);
    return createDetailLines(extracted || value, maxLines);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectReadableText(item, maxLines)).slice(0, maxLines);
  }

  const record = value as Record<string, unknown>;
  const errorMessage = readNestedString(record, ['error', 'message']) || readNestedString(record, ['message']);
  if (errorMessage) return createDetailLines(errorMessage, maxLines);

  const dataContentLines = collectContentArray(record.data, maxLines);
  if (dataContentLines.length > 0) return dataContentLines;

  const directContentLines = collectContentArray(record.content, maxLines);
  if (directContentLines.length > 0) return directContentLines;

  for (const key of ['result', 'text', 'stdout', 'stderr']) {
    const nested = collectReadableText(record[key], maxLines);
    if (nested.length > 0) return nested;
  }

  for (const key of ['results', 'entries', 'files', 'items', 'matches']) {
    const nested = collectReadableText(readNestedValue(record, ['data', key]) ?? record[key], maxLines);
    if (nested.length > 0) return nested;
  }

  const detailsResults = collectReadableText(readNestedValue(record, ['data', 'details', 'results']), maxLines);
  if (detailsResults.length > 0) return detailsResults;

  return [];
};

const collectContentArray = (value: unknown, maxLines = 6): string[] => {
  if (!value || typeof value !== 'object') return [];
  const content = Array.isArray(value)
    ? value
    : (value as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];

  return content.flatMap((item) => {
    if (item && typeof item === 'object') {
      return createDetailLines(stringifyPreview((item as Record<string, unknown>).text), maxLines);
    }
    return createDetailLines(stringifyPreview(item), maxLines);
  }).slice(0, maxLines);
};

const toRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const readNestedValue = (record: Record<string, unknown>, path: string[]): unknown => (
  path.reduce<unknown>((current, key) => (
    current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined
  ), record)
);

const readNestedString = (record: Record<string, unknown>, path: string[]): string => {
  const value = readNestedValue(record, path);
  return typeof value === 'string' ? value : '';
};

const parsePreview = (value?: string): unknown => {
  let text = value?.trim();
  if (!text) return undefined;

  for (let depth = 0; depth < 3; depth += 1) {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'string' && isJsonLike(parsed) && parsed.trim() !== text) {
        text = parsed.trim();
        continue;
      }
      return parsed;
    } catch {
      return text;
    }
  }

  return text;
};

const prettyPrint = (value?: string): string => {
  const parsed = parsePreview(value);
  if (parsed === undefined) return '';
  if (typeof parsed === 'string') return parsed;
  return JSON.stringify(parsed, null, 2);
};

const stringifyPreview = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

const LINE_NUMBER_GUTTER = /^\s*\d+\s*(?:->|\||>)\s?/;

const stripLineNumberGutter = (line: string): string => line.replace(LINE_NUMBER_GUTTER, '');

const createDetailLines = (value?: string, maxLines = 8): string[] => {
  const text = value?.trim();
  if (!text) return [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => stripLineNumberGutter(line.trimEnd()))
    .filter(Boolean);
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    visible.push(`... ${lines.length - maxLines} more lines`);
  }
  return visible;
};

const isLikelyBinaryText = (value: string): boolean => {
  const text = value.slice(0, 2000);
  if (text.length < 16) return false;
  const escapeSeqs = (text.match(/\\u[0-9a-fA-F]{4}/g) ?? []).length;
  const replacementChars = (text.match(/\uFFFD/g) ?? []).length;
  if (escapeSeqs < 4 && replacementChars < 4) return false;
  const noisyChars = escapeSeqs * 6 + replacementChars;
  return noisyChars / text.length > 0.3;
};

const compactText = (value: string, maxLength: number): string => {
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
};

const extractContentTextFromJsonishString = (value: string): string => {
  const escapedTextMatch = value.match(/\\"content\\"\s*:\s*\[[\s\S]*?\\"text\\"\s*:\s*\\"([\s\S]*)/);
  if (escapedTextMatch?.[1]) {
    return decodeJsonStringFragment(stripEscapedJsonTail(escapedTextMatch[1]));
  }

  const plainTextMatch = value.match(/"content"\s*:\s*\[[\s\S]*?"text"\s*:\s*"([\s\S]*)/);
  if (plainTextMatch?.[1]) {
    return decodeJsonStringFragment(stripPlainJsonTail(plainTextMatch[1]));
  }

  const candidates = [
    value,
    value.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t'),
  ];

  for (const candidate of candidates) {
    const looseMatch = candidate.match(/"content"\s*:\s*\[[\s\S]*?"text"\s*:\s*"([\s\S]*)"\s*\}\s*\]\s*(?:,|\})/);
    if (looseMatch?.[1]) return decodeJsonStringFragment(looseMatch[1]);

    const strictMatch = candidate.match(/"content"\s*:\s*\[[\s\S]*?"text"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (strictMatch?.[1]) return decodeJsonStringFragment(strictMatch[1]);
  }

  return '';
};

const stripEscapedJsonTail = (value: string): string => {
  const tailIndex = value.search(/\\"\s*\}\s*\]\s*(?:,|\})/);
  return tailIndex >= 0 ? value.slice(0, tailIndex) : value;
};

const stripPlainJsonTail = (value: string): string => {
  const tailIndex = value.search(/"\s*\}\s*\]\s*(?:,|\})/);
  return tailIndex >= 0 ? value.slice(0, tailIndex) : value;
};

const decodeJsonStringFragment = (value: string): string => {
  try {
    const parsed = JSON.parse(`"${value.replace(/\r?\n/g, '\\n')}"`);
    return typeof parsed === 'string' ? decodeEscapedText(parsed) : String(parsed);
  } catch {
    return decodeEscapedText(value);
  }
};

const decodeEscapedText = (value: string): string => (
  value
    .replace(/\\\\n/g, '\n')
    .replace(/\\\\r/g, '\r')
    .replace(/\\\\t/g, '\t')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\+"/g, '"')
    .replace(/\\\\/g, '\\')
);

const isJsonLike = (value: string): boolean => {
  const text = value.trim();
  return text.startsWith('{') || text.startsWith('[');
};
