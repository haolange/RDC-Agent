import type {
  ConversationLoopOutputPhase,
  ConversationLoopStopReason,
  ConversationReasoningState,
  ConversationToolApproval,
  ConversationToolApprovalStatus,
  ConversationToolCall,
  ConversationWorkBlock,
  ConversationWorkTrace,
} from '@shared/types/conversation';
import type { ThinkingArtifact } from '@shared/types/reasoning';
import {
  compactText,
  formatDurationMs,
  normalizeWorkProcessText,
} from './workProcessFormat';
import {
  createFallbackAskUserQuestion,
  normalizeAskUserAnswers,
  normalizeAskUserQuestions,
} from '@shared/utils/askUser';
import {
  buildSemanticStepGroups,
  flattenStepGroups,
} from './workProcessGrouping';
import {
  formatMcpTarget,
  getToolDisplay,
  normalizeToolName,
} from './workProcessToolCatalog';

export type {
  WorkProcessGroupThinking,
  WorkProcessIconKey,
  WorkProcessPresentationOptions,
  WorkProcessRow,
  WorkProcessRowStatus,
  WorkProcessStepGroup,
  WorkProcessToolApproval,
  WorkProcessToolGroupKind,
  WorkProcessUserInputItem,
  WorkProcessPresentation,
} from './workProcessTypes';
export { WORK_PROCESS_TOOL_DISPLAY_CATALOG } from './workProcessToolCatalog';
export { normalizeWorkProcessText, formatDurationMs } from './workProcessFormat';

import type {
  WorkProcessPresentation,
  WorkProcessPresentationOptions,
  WorkProcessRow,
  WorkProcessRowStatus,
  WorkProcessToolApproval,
  WorkProcessUserInputItem,
} from './workProcessTypes';
import {
  buildPresentationUnits,
  markLastSectionOpen,
  presentationUnitsToDetailRows,
} from './workProcessBlockProjection';

const ROW_STATUS_LABEL: Record<WorkProcessRowStatus, string> = {
  pending: '等待中',
  running: '进行中',
  complete: '',
  error: '失败',
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

const resolveReasoningState = (block: ConversationWorkBlock): ConversationReasoningState => {
  if (block.reasoningState) return block.reasoningState;
  if (!block.thinking) return 'none';
  if (block.thinking.kind === 'raw') return 'raw';
  if (block.thinking.kind === 'summary') return 'summary';
  if (block.thinking.kind === 'unknown') return 'unknown';
  if (block.thinking.kind === 'opaque') return 'opaque';
  return 'none';
};

const isNonFinalStopReason = (stopReason?: ConversationLoopStopReason): boolean => (
  stopReason === 'max_tokens' || stopReason === 'refusal' || stopReason === 'aborted'
);

const resolveOutputPhase = (
  block: ConversationWorkBlock,
  hasVisibleProcessEvidence: boolean,
): ConversationLoopOutputPhase => {
  if (block.result?.outputPhase) return block.result.outputPhase;
  if (block.status === 'running' || block.status === 'pending') {
    if (block.toolCalls.length === 0 && hasVisibleProcessEvidence) {
      return 'final_answer';
    }
    return 'commentary';
  }
  const stopReason = block.result?.stopReason;
  if (isNonFinalStopReason(stopReason)) return 'commentary';
  if (
    block.toolCalls.length === 0
    && (stopReason === 'end_turn' || stopReason === undefined)
    && hasVisibleProcessEvidence
    && (block.status === 'complete' || block.status === 'error')
  ) {
    return 'final_answer';
  }
  return 'commentary';
};

const hasReadableThinkingText = (block: ConversationWorkBlock): boolean => {
  const reasoningState = resolveReasoningState(block);
  if (!['raw', 'summary', 'unknown'].includes(reasoningState)) return false;
  return Boolean(normalizeWorkProcessText(block.thinking?.text ?? ''));
};

const resolveSectionResult = (
  block: ConversationWorkBlock,
  outputPhase: ConversationLoopOutputPhase,
  hasVisibleProcessEvidence: boolean,
): { resultText: string; resultToolSummary: string; resultStreaming: boolean; clampResult: boolean; clampable: boolean } => {
  // Industry alignment: commentary never occupies a separate result box.
  // Readable thinking owns the process slot; otherwise commentary is promoted into the thinking slot.
  void outputPhase;
  void hasVisibleProcessEvidence;
  const resultStatus = block.result?.status ?? (block.status === 'running' || block.status === 'pending' ? 'streaming' : 'complete');
  return {
    resultText: '',
    resultToolSummary: '',
    resultStreaming: resultStatus === 'streaming',
    clampResult: false,
    clampable: false,
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
  const isActiveBlock = block.status === 'running' || block.status === 'pending';
  const thinking = block.thinking;
  const reasoningState = resolveReasoningState(block);

  if (hasVisibleEvidence && thinking && ['raw', 'summary', 'unknown'].includes(reasoningState)) {
    const preview = normalizeWorkProcessText(thinking.text ?? '');
    if (preview) {
      const status = isActiveBlock ? block.thinkingStatus ?? 'streaming' : 'complete';
      const isSummary = reasoningState === 'summary' || (thinking.kind === 'summary' && thinking.visibility === 'summary');
      const isRaw = reasoningState === 'raw' || (thinking.kind === 'raw' && thinking.visibility === 'raw-collapsed');
      const isUnknown = reasoningState === 'unknown' || thinking.kind === 'unknown';
      if (isSummary || isRaw || isUnknown) {
        return {
          preview,
          label: status === 'streaming' || isActiveBlock
            ? '正在思考'
            : '思考过程',
          kind: thinking.kind,
          source: '',
          visibility: thinking.visibility,
          status,
          expandable: true,
          openByDefault: isSummary,
        };
      }
    }
  }

  // No provider thinking: promote visible commentary into the thinking slot.
  const commentary = normalizeWorkProcessText(block.result?.text ?? '');
  const canPromoteCommentary = hasVisibleEvidence
    && isMeaningfulText(commentary)
    && (block.toolCalls.length > 0 || isNonFinalStopReason(block.result?.stopReason));
  if (!canPromoteCommentary || hasReadableThinkingText(block)) {
    return { preview: '', label: '', expandable: false, openByDefault: false };
  }

  const resultStatus = block.result?.status ?? (isActiveBlock ? 'streaming' : 'complete');
  return {
    preview: commentary,
    label: resultStatus === 'streaming' || isActiveBlock ? '正在思考' : '思考过程',
    kind: undefined,
    source: '',
    visibility: undefined,
    status: resultStatus === 'streaming' ? 'streaming' : 'complete',
    expandable: true,
    openByDefault: false,
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
    label: resolved.label,
    kind: resolved.kind,
    visibility: resolved.visibility,
    status: resolved.status,
    expandable: true,
    openByDefault: false,
  };
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

export const getRowStatusLabel = (status: WorkProcessRowStatus): string => ROW_STATUS_LABEL[status];

const getLoopProjectionDeps = () => ({
  resolveOutputPhase,
  resolveReasoningState,
  resolveSectionResult,
  resolveSectionThinking,
  resolveResponseThinking,
  isNonFinalStopReason,
  normalizeThinkingDedupKey,
  createResponseRow,
  createReasoningIndicatorRow,
  appendRowsToLastSection,
  createApprovalRow,
  createDiagnosticRow,
  shouldSkipBlock,
  getMeaningfulBlockSummary,
  countToolSteps,
});

const buildProjectionContext = (): {
  visibleThinkingKeys: Set<string>;
  hasVisibleProcessEvidence: boolean;
  createToolRow: typeof createToolRow;
  groupProcessRows: typeof groupProcessRows;
  blocksToDetailRows: typeof blocksToDetailRows;
} => ({
  visibleThinkingKeys: new Set<string>(),
  hasVisibleProcessEvidence: false,
  createToolRow,
  groupProcessRows,
  blocksToDetailRows,
});

function blocksToDetailRows(blocks: ConversationWorkBlock[]): WorkProcessRow[] {
  const ctx = buildProjectionContext();
  const units = buildPresentationUnits(blocks, getLoopProjectionDeps(), ctx);
  return presentationUnitsToDetailRows(units);
}

function blocksToGroupedRows(blocks: ConversationWorkBlock[]): {
  groups: import('./workProcessTypes').WorkProcessStepGroup[];
  rows: WorkProcessRow[];
} {
  const ctx = buildProjectionContext();
  const units = buildPresentationUnits(blocks, getLoopProjectionDeps(), ctx);
  const groups = buildSemanticStepGroups(units);
  const rows = flattenStepGroups(groups);
  markLastSectionOpen(rows);
  return { groups, rows };
}

export const buildWorkProcessPresentation = (
  trace: ConversationWorkTrace,
  options: WorkProcessPresentationOptions = {},
): WorkProcessPresentation => {
  const view = options.view ?? 'grouped';
  const { groups, rows: groupedRows } = blocksToGroupedRows(trace.blocks);
  const detailRows = view === 'detail' ? blocksToDetailRows(trace.blocks) : groupedRows;
  const rows = view === 'detail' ? detailRows : groupedRows;
  const toolCount = countToolSteps(rows);
  const stepCount = countSteps(rows);
  const important = trace.status === 'error' || rowsHaveAttention(rows);
  const summary = isMeaningfulText(trace.summary) ? trace.summary?.trim() ?? '' : '';

  return {
    groups: view === 'detail' ? [] : groups,
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

const createReasoningIndicatorRow = (
  block: ConversationWorkBlock,
  state: Extract<ConversationReasoningState, 'opaque' | 'hidden'>,
): Extract<WorkProcessRow, { type: 'reasoningIndicator' }> => ({
  type: 'reasoningIndicator',
  id: `reasoning-indicator-${block.id}`,
  status: block.status,
  state,
  duration: formatDurationMs(block.startedAt, block.completedAt),
  loopId: block.id,
});

const createResponseRow = (
  block: ConversationWorkBlock,
  hasVisibleProcessEvidence: boolean,
  outputPhase: ConversationLoopOutputPhase,
): Extract<WorkProcessRow, { type: 'response' }> | null => {
  if (outputPhase !== 'final_answer') return null;
  const stopReason = block.result?.stopReason;
  if (isNonFinalStopReason(stopReason)) return null;

  const thinking = resolveResponseThinking(block);
  const isTerminal = block.status === 'complete' || block.status === 'error';
  const hasFinalResponseBoundary = hasVisibleProcessEvidence
    && (isTerminal || block.status === 'running' || block.status === 'pending')
    && (Boolean(thinking.label) || Boolean(thinking.preview) || isTerminal);
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
    outputPhase,
    stopReason,
  };
};

const getResponseSummary = (status: WorkProcessRowStatus): string => {
  if (status === 'running' || status === 'pending') return '正在生成最终回复';
  if (status === 'error') return '回复未完成';
  return '回复已生成';
};

const appendRowsToLastSection = (_rows: WorkProcessRow[], _childRows: WorkProcessRow[]): boolean => false;

const groupProcessRows = (rows: WorkProcessRow[]): WorkProcessRow[] => rows;

const countToolSteps = (rows: WorkProcessRow[]): number => rows.reduce((total, row) => {
  if (row.type === 'section') return total + countToolSteps(row.steps);
  if (row.type === 'tool' || row.type === 'userInput') return total + 1;
  return total;
}, 0);

const countSteps = (rows: WorkProcessRow[]): number => rows.reduce((total, row) => {
  if (row.type === 'section') return total + 1 + countSteps(row.steps);
  return total + 1;
}, 0);

const rowsHaveAttention = (rows: WorkProcessRow[]): boolean => rows.some((row) => {
  if (row.type === 'section') return row.status === 'running' || row.status === 'error' || rowsHaveAttention(row.steps);
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
  const webPresentation = extractWebToolPresentation(call.toolName, parsedResult);

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
    ...webPresentation,
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
  const parsedQuestions = normalizeAskUserQuestions(args);
  const questions = parsedQuestions.length > 0 ? parsedQuestions : [createFallbackAskUserQuestion()];
  const status = call.status === 'complete'
    ? 'complete'
    : call.status === 'error' || call.error
      ? 'error'
      : 'running';
  const result = parsePreview(call.resultPreview);
  const answers = status === 'complete'
    ? normalizeAskUserAnswers(questions, result)
    : [];
  const answerByQuestionId = new Map(answers.map((entry) => [entry.questionId, entry]));
  const items: WorkProcessUserInputItem[] = questions.map((question) => {
    const answer = answerByQuestionId.get(question.questionId);
    return {
      questionId: question.questionId,
      prompt: question.prompt,
      answer: answer?.answer,
      selectedOptionId: answer?.selectedOptionId,
    };
  });

  return {
    type: 'userInput',
    id: call.id,
    status,
    verb: status === 'complete' ? '已询问' : status === 'error' ? '询问已中断' : '正在询问',
    questionCount: questions.length,
    items,
    error: call.error || undefined,
    duration: formatDurationMs(call.startedAt, call.completedAt),
  };
};

const createApprovalRow = (block: ConversationWorkBlock): WorkProcessRow => {
  const resolvedText = (getMeaningfulBlockSummary(block) || '').trim();
  const isGenericDecision = /^(approved once|user denied)$/i.test(resolvedText);
  const message = isGenericDecision ? '' : compactText(resolvedText, 300);
  const isAutoReview = block.id.includes('auto-review');

  return {
    type: 'approval',
    id: block.id,
    status: block.status,
    verb: getApprovalVerb(block.status, isAutoReview),
    message,
    duration: formatDurationMs(block.startedAt, block.completedAt),
    detailLines: [],
    metaLines: [],
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
  detailLines: [],
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

  if (/grep|glob/.test(normalized)) {
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

const resolveUrlHostname = (url: string): string => {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
};

const resolveSourceDomain = (result: Record<string, unknown>): string => {
  const url = stringifyPreview(result.url);
  const source = stringifyPreview(result.source ?? result.domain);
  if (source) return source.replace(/^https?:\/\//i, '').split('/')[0] || source;
  if (url) return resolveUrlHostname(url);
  return '';
};

export const extractWebToolPresentation = (
  toolName: string,
  parsedResult: unknown,
): {
  sourcePills?: Array<{ domain: string; url?: string; title?: string }>;
  browseLink?: { label: string; url: string };
} => {
  const normalized = normalizeToolName(toolName);
  const record = toRecord(parsedResult);
  const details = getDetailsRecord(record);

  if (normalized === 'web_search' || details?.kind === 'search') {
    const resultRecords = getRecordArray(
      details?.results
      ?? record?.results
      ?? readNestedValue(record ?? {}, ['data', 'details', 'results']),
    );
    const sourcePills = resultRecords
      .slice(0, 6)
      .map((result) => {
        const domain = resolveSourceDomain(result);
        if (!domain) return null;
        const url = stringifyPreview(result.url) || undefined;
        const title = stringifyPreview(result.title) || undefined;
        return { domain, url, title } as { domain: string; url?: string; title?: string };
      })
      .filter((entry): entry is { domain: string; url?: string; title?: string } => entry != null);
    return sourcePills.length > 0 ? { sourcePills } : {};
  }

  if (normalized === 'web_fetch') {
    const url = stringifyPreview(
      details?.url
      ?? record?.url
      ?? readNestedValue(record ?? {}, ['data', 'details', 'url']),
    );
    if (url) {
      return { browseLink: { label: resolveUrlHostname(url), url } };
    }
  }

  return {};
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
