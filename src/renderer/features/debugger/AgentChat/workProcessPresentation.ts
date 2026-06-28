import type {
  ConversationThinkingPresentation,
  ConversationToolCall,
  ConversationWorkBlock,
  ConversationWorkTrace,
} from '@shared/types/conversation';

export type WorkProcessRowStatus = 'pending' | 'running' | 'complete' | 'error';

export type SectionPrimaryMode = 'result' | 'thinking-summary' | 'thinking-full' | 'none';

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
    toolName: string;
    target: string;
    duration: string;
    argsLines: string[];
    previewLines: string[];
    rawLines: string[];
    /** section 内紧凑展示：隐藏 meta/caret，仅 error 展开。 */
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
    /** 嵌套子 trace 的 row（递归构建）。 */
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
    type: 'section';
    id: string;
    status: WorkProcessRowStatus;
    /** 单一主文案（result / provider summary / 完整 CoT）。 */
    primaryText: string;
    primaryMode: SectionPrimaryMode;
    clampPrimary: boolean;
    narration: string;
    thinking: string;
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
  defaultExpanded: boolean;
  important: boolean;
}

const ROW_STATUS_LABEL: Record<WorkProcessRowStatus, string> = {
  pending: '等待中',
  running: '进行中',
  complete: '',
  error: '失败',
};

const TOOL_CATEGORY_LABELS: Array<[RegExp, string]> = [
  [/read_file|read|open|get|load/i, '读取'],
  [/glob|grep|search_codebase|find|list|ls/i, '检索'],
  [/write_file|write|save/i, '编辑'],
  [/edit_file|edit|patch|notebook_edit/i, '编辑'],
  [/delete_file|move_file|copy_file/i, '文件'],
  [/artifact|plan_artifact/i, '编辑'],
  [/bash|shell|exec|command|run/i, '命令'],
  [/web_fetch|web_search|web|fetch|browser|http/i, '网络'],
  [/git_/i, '版本控制'],
  [/memory_/i, '记忆'],
  [/task_/i, '任务'],
  [/skills|mcp|rdx_context/i, '运行时'],
  [/approval|ask/i, '询问'],
  [/agent_handoff|handoff|agent|task/i, '协作'],
];

const TOOL_VERB_LABELS: Array<[RegExp, string]> = [
  [/git_status/i, '已查看状态'],
  [/git_diff/i, '已对比变更'],
  [/git_log/i, '已查看历史'],
  [/git_add/i, '已暂存'],
  [/git_unstage/i, '已取消暂存'],
  [/git_commit/i, '已提交'],
  [/grep|search_codebase/i, '已搜索'],
  [/glob|list|ls/i, '已列出'],
  [/read_file|read|open|get|load/i, '已读取'],
  [/write_file|write|save/i, '已写入'],
  [/plan_artifact|artifact/i, '已写入'],
  [/edit_file|edit|patch/i, '已编辑'],
  [/notebook_edit/i, '已编辑笔记本'],
  [/delete_file/i, '已删除'],
  [/move_file/i, '已移动'],
  [/copy_file/i, '已复制'],
  [/bash|shell|exec|command|run/i, '已执行命令'],
  [/web_fetch/i, '已抓取'],
  [/web_search/i, '已搜索网络'],
  [/web|fetch|browser|http/i, '已抓取'],
  [/memory_read/i, '已读取记忆'],
  [/memory_write/i, '已写入记忆'],
  [/memory_delete/i, '已删除记忆'],
  [/task_list/i, '已列出任务'],
  [/task_create/i, '已创建任务'],
  [/task_update/i, '已更新任务'],
  [/task_get/i, '已读取任务'],
  [/skills/i, '已列出技能'],
  [/mcp/i, '已查询 MCP'],
  [/rdx_context/i, '已读取上下文'],
  [/agent_handoff|handoff/i, '准备交接'],
  [/approval|ask/i, '已询问'],
  [/agent|task/i, '已委派'],
];

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

const resolveSectionPrimary = (
  narration: string,
  thinking: string,
  thinkingPresentation?: ConversationThinkingPresentation,
): { primaryText: string; primaryMode: SectionPrimaryMode; clampPrimary: boolean } => {
  const thinkingText = normalizeSegmentPrimaryText(thinking);
  const narrationText = normalizeSegmentPrimaryText(narration);
  if (thinkingText) {
    const isSummary = thinkingPresentation === 'summary';
    return {
      primaryText: thinkingText,
      primaryMode: isSummary ? 'thinking-summary' : 'thinking-full',
      clampPrimary: isSummary,
    };
  }
  if (narrationText && isMeaningfulText(narrationText)) {
    return {
      primaryText: narrationText,
      primaryMode: 'result',
      clampPrimary: true,
    };
  }
  return {
    primaryText: '',
    primaryMode: 'none',
    clampPrimary: false,
  };
};

/** 压缩 section 主文案中的多余空白，避免思维链呈现为松散日志墙。 */
export const normalizeSegmentPrimaryText = (value: string): string => {
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

const NOISY_TEXT_PATTERNS = [
  /agent loop/i,
  /model and tool loop/i,
  /模型与工具循环已完成/,
  /生成最终回答/,
  /最终回答已生成/,
  /请求用户决策/,
  /回复已完成/,
  /final answer/i,
  /response complete/i,
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

  return {
    rows,
    stepCount,
    toolCount,
    summary: isMeaningfulText(trace.summary) ? trace.summary?.trim() ?? '' : '',
    defaultExpanded: trace.status !== 'idle' || rows.length > 0,
    important,
  };
};

/**
 * 把 block 列表转成展示行，并把工具块聚合成"思维链小节"（section）。
 *
 * 同时服务顶层 trace 与 subagent 的嵌套子 trace，保证两处分组一致。
 */
const blocksToRows = (blocks: ConversationWorkBlock[]): WorkProcessRow[] => {
  const rows: WorkProcessRow[] = [];

  for (const block of blocks) {
    // 工具块（runtime-segment-* / 旧 runtime-tools）→ 聚合为一个可折叠小节。
    if (block.kind === 'tool') {
      if (block.toolCalls.length === 0) continue;
      const steps = block.toolCalls.map((call) => createToolRow(call, true));
      const narration = isMeaningfulText(block.summary) ? block.summary.trim() : '';
      const thinking = block.detail?.trim() ?? '';
      const primary = resolveSectionPrimary(narration, thinking, block.thinkingPresentation);
      rows.push({
        type: 'section',
        id: block.id,
        status: block.status,
        primaryText: primary.primaryText,
        primaryMode: primary.primaryMode,
        clampPrimary: primary.clampPrimary,
        narration,
        thinking,
        stepCount: steps.length,
        duration: formatDurationMs(block.startedAt, block.completedAt),
        defaultOpen: false,
        steps,
      });
      continue;
    }

    // 非工具块仍可能携带工具调用（如 ask_user → user_input 块、handoff 块）：平铺为独立行。
    for (const call of block.toolCalls) {
      rows.push(createToolRow(call));
    }

    if (shouldSkipBlock(block)) {
      continue;
    }

    if (block.kind === 'approval') {
      rows.push(createApprovalRow(block));
      continue;
    }

    // subagent block：递归消费 children，渲染嵌套子 trace（优先于 diagnostic，保留 subagent 视觉）
    if (block.kind === 'subagent') {
      const childRows = block.children ? blocksToRows(block.children) : [];
      rows.push({
        type: 'subagent',
        id: block.id,
        status: block.status,
        profile: block.title.replace(/^子 Agent[:：]\s*/, '').trim() || 'sub-agent',
        summary: getMeaningfulBlockSummary(block) || block.summary || '',
        detail: block.detail ?? '',
        duration: formatDurationMs(block.startedAt, block.completedAt),
        children: childRows,
      });
      continue;
    }

    // command block：渲染为 task 卡片（优先于 diagnostic，保留 task 视觉）
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
      }
      continue;
    }

    if (block.kind === 'diagnostic' || block.status === 'error') {
      rows.push(createDiagnosticRow(block));
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
    }
  }

  // hybrid 折叠：仅把最后一个小节默认展开（最新/运行轮），其余旧轮折叠回标题。
  markLastSectionOpen(rows);

  return rows;
};

/** 把 rows 中最后一个 section 标记为默认展开，其余 section 保持折叠。 */
const markLastSectionOpen = (rows: WorkProcessRow[]): void => {
  let lastSectionIndex = -1;
  rows.forEach((row, index) => {
    if (row.type === 'section') lastSectionIndex = index;
  });
  if (lastSectionIndex < 0) return;
  const lastSection = rows[lastSectionIndex];
  if (lastSection.type === 'section') lastSection.defaultOpen = true;
};

/** 统计工具步骤总数（含 section 内的步骤）。 */
const countToolSteps = (rows: WorkProcessRow[]): number => rows.reduce((total, row) => {
  if (row.type === 'section') return total + countToolSteps(row.steps);
  if (row.type === 'tool' || row.type === 'userInput') return total + 1;
  return total;
}, 0);

/** 统计动作步骤数：section 计为其内部步骤数，其余行各计 1。 */
const countSteps = (rows: WorkProcessRow[]): number => rows.reduce((total, row) => {
  if (row.type === 'section') return total + row.stepCount;
  return total + 1;
}, 0);

const rowsHaveAttention = (rows: WorkProcessRow[]): boolean => rows.some((row) => {
  if (row.type === 'section') return rowsHaveAttention(row.steps);
  return row.status === 'error' || row.status === 'running';
});

const createToolRow = (call: ConversationToolCall, compact = false): WorkProcessRow => {
  if (normalizeToolName(call.toolName) === 'ask_user') {
    return createUserInputRow(call);
  }
  const parsedResult = parsePreview(call.error || call.resultPreview);
  const status = deriveToolStatus(call, parsedResult);
  const rawPreviewLines = call.error
    ? createDetailLines(call.error, 4)
    : extractReadableResultLines(parsedResult, call.resultPreview, 3);
  const previewLines = enhanceToolPreviewLines(
    call.toolName,
    parsedResult,
    call.resultPreview,
    !call.error && isLikelyBinaryText(rawPreviewLines.join('\n'))
      ? ['（二进制内容，预览已省略）']
      : rawPreviewLines,
  );

  return {
    type: 'tool',
    id: call.id,
    status,
    verb: getToolVerb(call.toolName, status, call.error || call.resultPreview),
    category: matchToolLabel(call.toolName, TOOL_CATEGORY_LABELS, 'Tool'),
    toolName: call.toolName,
    target: getToolTarget(call.argsPreview),
    duration: formatDurationMs(call.startedAt, call.completedAt),
    argsLines: createDetailLines(prettyPrint(call.argsPreview), 10),
    previewLines,
    rawLines: createDetailLines(prettyPrint(call.error || call.resultPreview), 16),
    compact,
  };
};

/** 供守卫脚本验证 catalog 工具展示覆盖。 */
export const createToolRowForPresentation = (
  call: ConversationToolCall,
  compact = false,
): WorkProcessRow => createToolRow(call, compact);

const createUserInputRow = (call: ConversationToolCall): WorkProcessRow => {
  const args = parsePreview(call.argsPreview);
  const question = args && typeof args === 'object' && !Array.isArray(args)
    ? stringifyPreview((args as Record<string, unknown>).question)
    : '';
  const rawChoices = args && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>).choices
    : undefined;
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
    verb: status === 'complete' ? '已回答' : status === 'error' ? '用户输入已停止' : '询问用户',
    question: compactText(question || '正在等待用户输入。', 280),
    answer,
    duration: formatDurationMs(call.startedAt, call.completedAt),
    detailLines,
  };
};

const createApprovalRow = (block: ConversationWorkBlock): WorkProcessRow => {
  const parsed = parsePreview(block.detail);
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  const detailAnswer = typeof parsed === 'string' ? parsed : stringifyPreview(record.answer);
  const reviewer = stringifyPreview(record.reviewer);
  const toolName = stringifyPreview(record.toolName);
  const risk = stringifyPreview(record.risk);
  const isAutoReview = reviewer === 'auto_review' || block.id.includes('auto-review');
  const status = block.status;
  // running / complete 审批均由 shouldSkipBlock 跳过（Composer 批准面板与工具行已覆盖），
  // 到达此处仅为 error（拒绝 / 自动审查拒绝）：通用“已拒绝”用动词表达即可，
  // 仅在带具体原因（如自动审查拒绝说明）时才作为 message 展示，且不回灌内部 JSON。
  const resolvedText = (detailAnswer || getMeaningfulBlockSummary(block) || '').trim();
  const isGenericDecision = /^(已批准一次|用户已拒绝)$/.test(resolvedText);
  const message = isGenericDecision ? '' : compactText(resolvedText, 300);

  return {
    type: 'approval',
    id: block.id,
    status,
    verb: status === 'error'
      ? isAutoReview ? '自动审查已拒绝' : '已拒绝'
      : isAutoReview ? '自动审查通过' : '已批准',
    message,
    duration: formatDurationMs(block.startedAt, block.completedAt),
    detailLines: [],
    metaLines: [
      toolName ? `工具：${toolName}` : '',
      risk ? `风险：${risk}` : '',
    ].filter(Boolean),
  };
};

const deriveToolStatus = (call: ConversationToolCall, parsedResult: unknown): WorkProcessRowStatus => {
  if (call.status === 'error' || call.error) return 'error';
  if (call.status !== 'complete') return call.status;
  if (resultIndicatesFailure(parsedResult, call.resultPreview)) return 'error';
  return call.status;
};

const getToolVerb = (toolName: string, status: WorkProcessRowStatus, resultPreview?: string): string => {
  if (status !== 'error') return matchToolLabel(toolName, TOOL_VERB_LABELS, '已调用');
  return /approval required|no changes were made/i.test(resultPreview ?? '') ? '已阻止' : '已失败';
};

const resultIndicatesFailure = (parsedResult: unknown, raw?: string): boolean => {
  if (parsedResult && typeof parsedResult === 'object' && !Array.isArray(parsedResult)) {
    const record = parsedResult as Record<string, unknown>;
    if (record.ok === false) return true;
    const status = String(record.status ?? '').toLowerCase();
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
  if (block.kind === 'tool' && block.toolCalls.length > 0) return true;
  // running 审批由 Composer 批准面板独占承担；complete 审批已隐含在工具行记录中，无需重复顶层行；
  // error 态（拒绝/自动审查拒绝）保留，有重要信号意义。
  if (block.kind === 'approval' && block.status === 'running') return true;
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

const matchToolLabel = (
  toolName: string,
  labels: Array<[RegExp, string]>,
  fallback: string,
): string => labels.find(([pattern]) => pattern.test(toolName))?.[1] ?? fallback;

const getToolTarget = (argsPreview?: string): string => {
  const parsed = parsePreview(argsPreview);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const text = stringifyPreview(parsed);
    return isRawPayloadPreview(text) ? '' : compactText(text, 180);
  }

  for (const key of TARGET_KEYS) {
    const text = stringifyPreview((parsed as Record<string, unknown>)[key]);
    if (text) return compactText(text, 180);
  }

  const fallback = Object.entries(parsed as Record<string, unknown>)
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
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;

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
    const status = stringifyPreview(record?.status ?? record?.statusCode);
    const title = stringifyPreview(record?.title ?? record?.pageTitle);
    const lines = [status ? `HTTP ${status}` : '', title].filter(Boolean);
    if (lines.length > 0) return [...lines, ...previewLines].slice(0, 3);
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

  for (const key of ['entries', 'files', 'items', 'matches']) {
    const nested = collectReadableText(readNestedValue(record, ['data', key]) ?? record[key], maxLines);
    if (nested.length > 0) return nested;
  }

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

/** 行首行号槽：`  1→`、`  1|`、`1->`、`1>` 等工具自带的行号前缀，渲染时剥掉以消除噪声。 */
const LINE_NUMBER_GUTTER = /^\s*\d+\s*(?:->|→|\||>)\s?/;

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
    visible.push(`… 还有 ${lines.length - maxLines} 行`);
  }
  return visible;
};

/**
 * 检测预览文本是否为二进制 / 非文本内容。
 *
 * 真实场景：读取 `.rdc` 等二进制文件时，结果会退化成大量 `\uXXXX` 转义序列与
 * 替换字符，平铺成等宽乱码墙。命中后用一行说明替代，避免噪声。
 */
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
