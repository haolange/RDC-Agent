import type {
  ConversationToolCall,
  ConversationWorkBlock,
  ConversationWorkTrace,
} from '@shared/types/conversation';

export type WorkProcessRowStatus = 'pending' | 'running' | 'complete' | 'error';

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
  };

export interface WorkProcessPresentation {
  rows: WorkProcessRow[];
  stepCount: number;
  toolCount: number;
  summary: string;
  statusLabel: string;
  defaultExpanded: boolean;
  important: boolean;
}

const TRACE_STATUS_LABEL: Record<ConversationWorkTrace['status'], string> = {
  idle: 'waiting',
  running: 'running',
  complete: 'complete',
  error: 'failed',
  stopped: 'stopped',
};

const ROW_STATUS_LABEL: Record<WorkProcessRowStatus, string> = {
  pending: 'Waiting',
  running: 'Running',
  complete: '',
  error: 'Failed',
};

const TOOL_CATEGORY_LABELS: Array<[RegExp, string]> = [
  [/read|open|get|load/i, 'Read'],
  [/glob|grep|search|find|list|ls/i, 'Search'],
  [/write|edit|patch|save/i, 'Edit'],
  [/artifact/i, 'Edit'],
  [/bash|shell|exec|command|run/i, 'Run'],
  [/web|fetch|browser|http/i, 'Web'],
  [/approval|ask/i, 'Ask'],
  [/agent|handoff|task/i, 'Agent'],
];

const TOOL_VERB_LABELS: Array<[RegExp, string]> = [
  [/grep|search|find/i, 'Searched'],
  [/glob|list|ls/i, 'List'],
  [/read|open|get|load/i, 'Read'],
  [/write|save/i, 'Write'],
  [/artifact/i, 'Write'],
  [/edit|patch/i, 'Edit'],
  [/bash|shell|exec|command|run/i, 'Run'],
  [/web|fetch|browser|http/i, 'Fetch'],
  [/approval|ask/i, 'Ask'],
  [/agent|task/i, 'Delegate'],
  [/handoff/i, 'Prepare handoff'],
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
];

const RAW_PAYLOAD_TARGET_KEYS = new Set(['content', 'text', 'body', 'payload']);

const INTERNAL_BLOCK_IDS = new Set(['runtime-run', 'assistant-output']);

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
  const rows: WorkProcessRow[] = [];
  let important = trace.status === 'error';

  for (const block of trace.blocks) {
    for (const call of block.toolCalls) {
      rows.push(createToolRow(call));
      if (call.status === 'error' || call.status === 'running') important = true;
    }

    if (shouldSkipBlock(block)) {
      continue;
    }

    if (block.kind === 'approval') {
      rows.push(createApprovalRow(block));
      if (block.status === 'error' || block.status === 'running') important = true;
      continue;
    }

    // subagent block：递归消费 children，渲染嵌套子 trace（优先于 diagnostic，保留 subagent 视觉）
    if (block.kind === 'subagent') {
      const childRows = block.children
        ? buildChildRows(block.children)
        : [];
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
      if (block.status === 'error' || block.status === 'running') important = true;
      continue;
    }

    // task block（runtime-tasks）：渲染为 task 卡片（优先于 diagnostic，保留 task 视觉）
    if (block.kind === 'command' || block.id === 'runtime-tasks') {
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
      important = true;
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

  const toolCount = rows.filter((row) => row.type === 'tool' || row.type === 'userInput').length;
  return {
    rows,
    stepCount: rows.length,
    toolCount,
    summary: isMeaningfulText(trace.summary) ? trace.summary?.trim() ?? '' : '',
    statusLabel: TRACE_STATUS_LABEL[trace.status],
    defaultExpanded: trace.status !== 'idle' || rows.length > 0,
    important,
  };
};

/**
 * 递归构建子 block 的 rows（用于 subagent 嵌套 trace）。
 *
 * 复用主循环的 block→row 逻辑，但不返回 Presentation 包装。
 */
const buildChildRows = (blocks: ConversationWorkBlock[]): WorkProcessRow[] => {
  const childRows: WorkProcessRow[] = [];
  for (const block of blocks) {
    for (const call of block.toolCalls) {
      childRows.push(createToolRow(call));
    }
    if (shouldSkipBlock(block)) continue;
    if (block.kind === 'approval') {
      childRows.push(createApprovalRow(block));
      continue;
    }
    if (block.kind === 'diagnostic' || block.status === 'error') {
      childRows.push(createDiagnosticRow(block));
      continue;
    }
    if (block.kind === 'subagent') {
      const grandChildren = block.children ? buildChildRows(block.children) : [];
      childRows.push({
        type: 'subagent',
        id: block.id,
        status: block.status,
        profile: block.title.replace(/^子 Agent[:：]\s*/, '').trim() || 'sub-agent',
        summary: getMeaningfulBlockSummary(block) || block.summary || '',
        detail: block.detail ?? '',
        duration: formatDurationMs(block.startedAt, block.completedAt),
        children: grandChildren,
      });
      continue;
    }
    const summaryText = getMeaningfulBlockSummary(block);
    if (summaryText) {
      childRows.push({
        type: 'summary',
        id: block.id,
        status: block.status,
        text: summaryText,
        detailLines: createDetailLines(block.detail, 10),
        duration: formatDurationMs(block.startedAt, block.completedAt),
      });
    }
  }
  return childRows;
};

const createToolRow = (call: ConversationToolCall): WorkProcessRow => {
  if (normalizeToolName(call.toolName) === 'ask_user') {
    return createUserInputRow(call);
  }
  const parsedResult = parsePreview(call.error || call.resultPreview);
  const status = deriveToolStatus(call, parsedResult);
  const previewLines = call.error
    ? createDetailLines(call.error, 6)
    : extractReadableResultLines(parsedResult, call.resultPreview);

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
  };
};

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
    question ? `Question: ${question}` : '',
    ...choices.map((choice, index) => `Choice ${index + 1}: ${choice}`),
    answer ? `Answer: ${answer}` : '',
    call.error ? `Error: ${call.error}` : '',
  ].filter(Boolean);

  return {
    type: 'userInput',
    id: call.id,
    status,
    verb: status === 'complete' ? 'Answered user' : status === 'error' ? 'User input stopped' : 'Asked user',
    question: compactText(question || 'The agent is waiting for user input.', 280),
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
  const message = status === 'running'
    ? compactText(block.summary || 'The agent needs approval before continuing.', 300)
    : compactText(detailAnswer || getMeaningfulBlockSummary(block) || 'Approval decision recorded.', 300);

  return {
    type: 'approval',
    id: block.id,
    status,
    verb: status === 'running'
      ? 'Requested approval'
      : status === 'error'
        ? isAutoReview ? 'Auto-review denied' : 'Denied'
        : isAutoReview ? 'Auto-reviewed' : 'Approved',
    message,
    duration: formatDurationMs(block.startedAt, block.completedAt),
    detailLines: createDetailLines(block.detail, 12),
    metaLines: [
      toolName ? `Tool: ${toolName}` : '',
      risk ? `Risk: ${risk}` : '',
      reviewer ? `Reviewer: ${reviewer}` : '',
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
  if (status !== 'error') return matchToolLabel(toolName, TOOL_VERB_LABELS, 'Called');
  return /approval required|no changes were made/i.test(resultPreview ?? '') ? 'Blocked' : 'Failed';
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
  if (block.kind === 'approval' && block.status === 'complete' && !block.detail && !isMeaningfulText(block.summary)) return true;
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

const extractReadableResultLines = (parsed: unknown, raw?: string): string[] => {
  const collected = collectReadableText(parsed, 6);
  if (collected.length > 0) return collected.slice(0, 6);
  if (parsed && typeof parsed === 'object') return [];
  return createDetailLines(raw, 6);
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

const createDetailLines = (value?: string, maxLines = 8): string[] => {
  const text = value?.trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    visible.push(`... ${lines.length - maxLines} more lines`);
  }
  return visible;
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
