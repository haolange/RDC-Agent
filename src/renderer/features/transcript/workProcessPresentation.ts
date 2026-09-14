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
import { normalizeAskUserAnswers } from '@shared/utils/askUser';
import {
  formatMcpTarget,
  getToolDisplay,
  getToolFamily,
  normalizeToolName,
} from './workProcessToolCatalog';

export type {
  WorkProcessIconKey,
  WorkProcessRow,
  WorkProcessRowStatus,
  WorkProcessToolApproval,
  WorkProcessToolFamily,
  WorkProcessToolGroupKind,
  WorkProcessUserInputItem,
  WorkProcessPresentation,
} from './workProcessTypes';
export { WORK_PROCESS_TOOL_DISPLAY_CATALOG, getToolFamily } from './workProcessToolCatalog';
export { normalizeWorkProcessText, formatDurationMs } from './workProcessFormat';

import type {
  WorkProcessPresentation,
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
  skipped: '已跳过',
};

const TARGET_KEYS = [
  'uri',
  'ref',
  'path',
  'title',
  'file',
  'filePath',
  'filepath',
  'target',
  'pattern',
  'query',
  'code',
  'key',
  'skill_id',
  'skillId',
  'url',
  'spaceId',
  'cardId',
  'relativePath',
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

const ENVELOPE_KEY_PATTERN = /^(?:ok|data|artifacts|error|duration_ms|trace_id|content|details)$/;
const SHELL_PREVIEW_MAX_LINES = 20;
const SKILL_DESCRIPTION_MAX = 180;

const RAW_PAYLOAD_TARGET_KEYS = new Set(['content', 'text', 'body', 'payload']);
const INTERNAL_BLOCK_IDS = new Set(['runtime-run', 'assistant-output', 'runtime-reasoning']);

const normalizeThinkingDedupKey = (value: string): string => (
  normalizeWorkProcessText(value).replace(/\s+/g, ' ').toLowerCase()
);

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
  _hasVisibleProcessEvidence: boolean,
): ConversationLoopOutputPhase => {
  // Runtime phase is authoritative. Unknown streaming text is treated as final-side
  // withheld output so it can never flash as Work Process prose.
  if (block.result?.outputPhase) return block.result.outputPhase;
  if (block.toolCalls.length > 0 || isNonFinalStopReason(block.result?.stopReason)) {
    return 'commentary';
  }
  if (block.status === 'running' || block.status === 'pending') {
    return 'final_answer';
  }
  return 'final_answer';
};

const resolveSectionProse = (
  block: ConversationWorkBlock,
  outputPhase: ConversationLoopOutputPhase,
): { proseText: string; proseStreaming: boolean } => {
  // Commentary is narrative prose — never promoted into the thinking slot.
  // Final answers render only in the assistant body, never as WP prose.
  const commentary = normalizeWorkProcessText(block.result?.text ?? '');
  const resultStatus = block.result?.status
    ?? (block.status === 'running' || block.status === 'pending' ? 'streaming' : 'complete');
  const isStreaming = resultStatus === 'streaming';
  const canShow = isMeaningfulText(commentary) && outputPhase === 'commentary';
  return {
    proseText: canShow ? commentary : '',
    proseStreaming: canShow && isStreaming,
  };
};

const resolveThinkingDurationLabel = (block: ConversationWorkBlock): string => {
  const start = typeof block.startedAt === 'number' && Number.isFinite(block.startedAt)
    ? block.startedAt
    : undefined;
  if (!start) return '';

  const firstToolStart = block.toolCalls
    .map((call) => call.startedAt)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => a - b)[0];
  const end = firstToolStart
    ?? (typeof block.completedAt === 'number' && Number.isFinite(block.completedAt) ? block.completedAt : undefined);
  return formatDurationMs(start, end);
};

const resolveSettledThinkingLabel = (block: ConversationWorkBlock): string => {
  const duration = resolveThinkingDurationLabel(block);
  return duration ? `已思考 · ${duration}` : '已思考';
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
            : resolveSettledThinkingLabel(block),
          kind: thinking.kind,
          source: '',
          visibility: thinking.visibility,
          status,
          expandable: true,
          // Policy hint for UI: expand while the loop is live; fold after settle.
          // summary / raw / unknown share the same lifecycle (user sticky lives in the row).
          openByDefault: isActiveBlock || status === 'streaming',
        };
      }
    }
  }

  // No provider thinking and no commentary promotion — empty thinking slot.
  return { preview: '', label: '', expandable: false, openByDefault: false };
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
  // Final-answer / closing thinking shares the same lifecycle policy as process loops:
  // expand while the section is live, fold after settle (UI may sticky-override).
  const resolved = resolveSectionThinking(block, Boolean(block.thinking));
  if (!resolved.expandable) return { ...resolved, label: '', openByDefault: false };
  return {
    preview: resolved.preview,
    label: resolved.label,
    kind: resolved.kind,
    visibility: resolved.visibility,
    status: resolved.status,
    expandable: true,
    openByDefault: resolved.openByDefault,
  };
};

const NOISY_TEXT_PATTERNS = [
  /agent loop/i,
  /model and tool loop/i,
  /^context compacted\b/i,
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
  resolveSectionProse,
  resolveSectionThinking,
  resolveResponseThinking,
  isNonFinalStopReason,
  normalizeThinkingDedupKey,
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
  visibleThinkingKeys: new Set(),
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

export const buildWorkProcessPresentation = (
  trace: ConversationWorkTrace,
): WorkProcessPresentation => {
  const blocks = Array.isArray(trace.blocks) ? trace.blocks : [];
  const rows = blocksToDetailRows(blocks);
  markLastSectionOpen(rows);
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
    toolEvidence: trace.toolEvidence ? { ...trace.toolEvidence } : undefined,
    duration: formatTraceDuration(blocks),
    defaultExpanded: trace.status !== 'idle' || rows.length > 0 || Boolean(summary),
    important,
  };
};

const groupProcessRows = (rows: WorkProcessRow[]): WorkProcessRow[] => rows;

const countToolSteps = (rows: WorkProcessRow[]): number => rows.reduce((total, row) => {
  if (row.type === 'section') return total + countToolSteps(row.steps);
  if (row.type === 'toolAggregate') return total + row.children.length;
  if (row.type === 'tool' || row.type === 'userInput' || row.type === 'planReview') return total + 1;
  return total;
}, 0);

const countSteps = (rows: WorkProcessRow[]): number => rows.reduce((total, row) => {
  if (row.type === 'section') return total + 1 + countSteps(row.steps);
  if (row.type === 'toolAggregate') return total + 1;
  return total + 1;
}, 0);

const rowsHaveAttention = (rows: WorkProcessRow[]): boolean => rows.some((row) => {
  if (row.type === 'section') return row.status === 'running' || row.status === 'error' || row.status === 'skipped' || rowsHaveAttention(row.steps);
  if (row.type === 'toolAggregate') return row.status === 'error' || row.status === 'running' || row.status === 'skipped';
  return row.status === 'error' || row.status === 'running' || row.status === 'skipped';
});

const formatTraceDuration = (blocks: ConversationWorkBlock[]): string => {
  const timestamps = blocks.flatMap((block) => [block.startedAt, block.completedAt].filter(isNumber));
  if (timestamps.length === 0) return '';
  return formatDurationMs(Math.min(...timestamps), blocks.some((block) => !block.completedAt) ? undefined : Math.max(...timestamps));
};

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const createToolRow = (call: ConversationToolCall): WorkProcessRow => {
  if (normalizeToolName(call.toolName) === 'ask_user') {
    return createUserInputRow(call);
  }
  if (normalizeToolName(call.toolName) === 'plan_artifact' && call.planReview) {
    if (call.planReview.status === 'superseded' || call.planReview.status === 'rejected') {
      return createPlanReviewShellRow(call);
    }
    return createPlanReviewRow(call);
  }
  const display = getToolDisplay(call.toolName);
  const approval = createToolApprovalPresentation(call.approval, call.toolName);
  const rawResult = call.error || call.resultPreview;
  const parsedResult = parsePreview(rawResult);
  const suppressApprovalPreview = Boolean(approval) && isApprovalRequiredPreview(parsedResult, rawResult);
  const status = deriveToolStatus(call, parsedResult);
  const unwrapped = suppressApprovalPreview
    ? emptyUnwrappedContent()
    : unwrapToolContentLayer(call.toolName, parsedResult, call.error ? undefined : call.resultPreview, call.argsPreview);
  const previewLines = call.error && !suppressApprovalPreview
    ? (
      unwrapped.previewLines.length > 0
        ? unwrapped.previewLines
        : createDetailLines(sanitizeContentText(call.error), 4)
    )
    : unwrapped.previewLines;
  const webPresentation = extractWebToolPresentation(call.toolName, parsedResult);
  const diagnosticCaption = status === 'error'
    ? (extractDiagnosticCaption(
      parsePreview(call.resultPreview) ?? parsedResult,
      call.error || call.resultPreview,
      previewLines,
    ) || undefined)
    : undefined;

  return {
    type: 'tool',
    id: call.id,
    status,
    verb: getToolVerb(call.toolName, status, call.error || call.resultPreview, call.approval),
    category: display.category,
    icon: display.icon,
    groupKind: display.groupKind,
    family: getToolFamily(call.toolName),
    toolName: call.toolName,
    target: getToolTarget(call.toolName, call.argsPreview),
    duration: formatDurationMs(call.startedAt, call.completedAt),
    argsLines: createDetailLines(prettyPrint(call.argsPreview), 10),
    previewLines,
    rawLines: suppressApprovalPreview ? [] : createDetailLines(prettyPrint(call.error || call.resultPreview), 40),
    bodyText: unwrapped.bodyText,
    bodyLines: unwrapped.bodyLines,
    previewKind: unwrapped.previewKind,
    commandText: unwrapped.commandText,
    pathChip: unwrapped.pathChip,
    chips: unwrapped.chips,
    diagnosticCaption,
    approval,
    imagePreviews: call.imagePreviews,
    ...webPresentation,
  };
};

/** Prefer a short human-readable failure line over the full tool JSON envelope. */
export const extractDiagnosticCaption = (
  parsedResult: unknown,
  raw?: string,
  previewLines: string[] = [],
): string => {
  const record = toRecord(parsedResult);
  const fromNested = record
    ? (
      readNestedString(record, ['error', 'message'])
      || readNestedString(record, ['message'])
      || readNestedString(record, ['data', 'error', 'message'])
    )
    : '';
  const candidates = [
    fromNested,
    ...previewLines,
    typeof parsedResult === 'string' ? parsedResult : '',
    raw ?? '',
  ]
    .map((value) => normalizeWorkProcessText(value).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((value) => !isJsonLike(value) && !/^\{?\s*"?ok"?\s*:/i.test(value));

  const caption = candidates[0] ?? '';
  if (!caption) return '';
  const firstLine = caption.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? caption;
  return compactText(firstLine, 160);
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
): WorkProcessRow => createToolRow(call);

const createPlanReviewRow = (call: ConversationToolCall): WorkProcessRow => ({
  type: 'planReview',
  id: call.id,
  status: call.status === 'error' ? 'error' : call.planReview?.status === 'approved' ? 'complete' : 'running',
  plan: call.planReview!,
  duration: formatDurationMs(call.startedAt, call.completedAt),
});

const createPlanReviewShellRow = (call: ConversationToolCall): WorkProcessRow => {
  const rejected = call.planReview?.status === 'rejected';
  const feedback = call.planReview?.decision?.kind === 'reject' ? call.planReview.decision.feedback : call.resultPreview;
  return {
    type: 'tool',
    id: call.id,
    status: rejected || call.status === 'error' ? 'complete' : 'complete',
    verb: rejected ? '已更新计划 · 已拒绝' : '已更新计划',
    category: '计划产物',
    icon: 'planArtifact',
    groupKind: 'runtime',
    family: 'runtime',
    toolName: call.toolName,
    target: call.planReview?.title ?? '',
    duration: formatDurationMs(call.startedAt, call.completedAt),
    argsLines: [],
    previewLines: feedback ? [feedback] : [],
    rawLines: [],
    bodyText: feedback || undefined,
  };
};

const createUserInputRow = (call: ConversationToolCall): WorkProcessRow => {
  const questions = call.userInputQuestions ?? [];
  const incomplete = questions.length === 0;
  const status = incomplete
    ? 'error'
    : call.status === 'complete'
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
    };
  });

  return {
    type: 'userInput',
    id: call.id,
    status,
    verb: incomplete ? '问题数据不完整' : status === 'complete' ? '已询问' : status === 'error' ? '询问已中断' : '正在询问',
    questionCount: questions.length,
    items,
    answeredCount: items.filter((item) => Boolean(item.answer)).length,
    incomplete,
    error: incomplete ? undefined : call.error || undefined,
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
  if (status === 'skipped') return '已跳过';
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
  severity: block.diagnosticSeverity ?? (block.status === 'error' ? 'error' : 'info'),
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

const emptyUnwrappedContent = (): UnwrappedToolContent => ({
  previewKind: 'generic',
  previewLines: [],
});

export type UnwrappedToolContent = {
  previewKind: 'shell' | 'skill' | 'file' | 'web' | 'generic';
  previewLines: string[];
  /** Outcome-first collapsed summary when results are available. */
  bodyText?: string;
  /** Short collapsed sample list (search / list-like tools). */
  bodyLines?: string[];
  commandText?: string;
  pathChip?: string;
  chips?: string[];
};

const FILE_TOOL_NAMES = /^(?:read_file|artifact_read|write_file|edit_file|delete_file|move_file|copy_file|read)$/;

/**
 * Strip transport envelopes (`ok` / `data` / `trace_id` / `duration_ms`) and project
 * only the human-readable content layer into previewLines. Full payload stays in raw.
 */
export const unwrapToolContentLayer = (
  toolName: string,
  parsed: unknown,
  raw?: string,
  argsPreview?: string,
): UnwrappedToolContent => {
  const normalized = normalizeToolName(toolName);
  const record = toRecord(parsed);
  const details = getDetailsRecord(record);
  const argsRecord = toRecord(parsePreview(argsPreview));
  const contentText = sanitizeContentText(extractContentLayerText(parsed, raw));

  const artifactized = details?.artifactized === true
    || (typeof details?.ref === 'string' && details.ref.startsWith('session://'))
    || (typeof details?.uri === 'string' && details.uri.startsWith('session://'));
  if (artifactized) {
    const ref = sanitizeContentText(stringifyPreview(
      details?.ref ?? details?.uri ?? argsRecord?.uri,
    ));
    const hash = sanitizeContentText(stringifyPreview(details?.hash));
    const summary = sanitizeContentText(stringifyPreview(details?.summary)) || contentText;
    const shortHash = hash ? hash.slice(0, 8) : '';
    return {
      previewKind: 'file',
      pathChip: ref || undefined,
      chips: shortHash ? [shortHash] : undefined,
      bodyText: [ref, shortHash].filter(Boolean).join(' · ') || summary || undefined,
      previewLines: summary ? filterEnvelopeLines(createDetailLines(summary, 4)) : [],
    };
  }

  if (normalized === 'shell' || normalized.includes('shell')) {
    const commandText = sanitizeContentText(
      stringifyPreview(
        argsRecord?.command
        ?? readNestedValue(argsRecord ?? {}, ['rdx', 'operation'])
        ?? argsRecord?.cmd
        ?? details?.command
        ?? record?.command
        ?? readNestedValue(record ?? {}, ['data', 'details', 'command']),
      ),
    );
    const stdout = sanitizeContentText(
      stringifyPreview(
        record?.stdout
        ?? readNestedValue(record ?? {}, ['result', 'stdout'])
        ?? details?.stdout,
      ) || contentText,
    );
    if (isLikelyBinaryText(stdout)) {
      return {
        previewKind: 'shell',
        commandText: commandText || undefined,
        previewLines: ['Binary content omitted from preview.'],
      };
    }
    const previewLines = filterEnvelopeLines(createDetailLines(stdout, SHELL_PREVIEW_MAX_LINES));
    return {
      previewKind: 'shell',
      commandText: commandText || undefined,
      previewLines,
    };
  }

  if (normalized === 'code_interpreter') {
    const code = sanitizeContentText(stringifyPreview(argsRecord?.code ?? details?.code));
    const previewLines = filterEnvelopeLines(createDetailLines(contentText, SHELL_PREVIEW_MAX_LINES));
    return {
      previewKind: 'shell',
      commandText: code || undefined,
      bodyText: code || contentText || undefined,
      previewLines,
    };
  }

  if (normalized === 'skill_read') {
    const description = sanitizeContentText(
      stringifyPreview(details?.description)
      || extractSkillDescription(contentText),
    );
    const pathChip = sanitizeContentText(
      stringifyPreview(
        details?.sourcePath
        ?? details?.path
        ?? record?.sourcePath
        ?? record?.path,
      ),
    );
    const previewLines = description
      ? [compactText(description.replace(/\s+/g, ' ').trim(), SKILL_DESCRIPTION_MAX)]
      : [];
    const skillName = sanitizeContentText(stringifyPreview(
      details?.skillId ?? argsRecord?.skill_id ?? argsRecord?.skillId,
    ));
    return {
      previewKind: 'skill',
      pathChip: pathChip || undefined,
      bodyText: previewLines[0] || undefined,
      previewLines,
      chips: skillName ? [skillName] : undefined,
    };
  }

  if (normalized === 'skills') {
    const names = collectReadableText(record?.skills ?? details?.skills ?? record?.items, 6);
    return {
      previewKind: 'generic',
      chips: names.slice(0, 4),
      bodyText: names.length > 0 ? `${names.length} skills` : contentText || undefined,
      previewLines: names,
    };
  }

  if (normalized.startsWith('memory_')) {
    const subject = sanitizeContentText(stringifyPreview(
      argsRecord?.key ?? argsRecord?.query ?? details?.key ?? details?.query ?? argsRecord?.path,
    ));
    const scope = sanitizeContentText(stringifyPreview(argsRecord?.scope ?? details?.scope));
    const chips = [subject, scope].filter(Boolean);
    const previewLines = filterEnvelopeLines(createDetailLines(contentText, 6));
    return {
      previewKind: 'generic',
      chips,
      bodyText: previewLines[0] || subject || undefined,
      previewLines,
    };
  }

  if (normalized === 'mcp' || normalized.startsWith('mcp__')) {
    const target = formatMcpTarget(toolName);
    const [server, tool] = target.split('/');
    const chips = [server ? `MCP · ${server}` : 'MCP', tool].filter(Boolean);
    const previewLines = filterEnvelopeLines(createDetailLines(contentText, 6));
    const pathChip = sanitizeContentText(stringifyPreview(argsRecord?.path ?? details?.path));
    return {
      previewKind: 'generic',
      chips,
      pathChip: pathChip || undefined,
      bodyText: previewLines[0] || target || undefined,
      previewLines,
    };
  }

  if (normalized === 'tool_search') {
    const hits = collectReadableText(record?.matches ?? record?.tools ?? details?.matches, 8);
    return {
      previewKind: 'generic',
      bodyText: hits.length > 0 ? `${hits.length} tools` : contentText || undefined,
      bodyLines: hits.slice(0, 3),
      previewLines: hits,
    };
  }

  if (normalized === 'output_register' || normalized === 'plan_artifact') {
    const pathChip = sanitizeContentText(stringifyPreview(
      argsRecord?.path ?? details?.path ?? details?.outputPath,
    ));
    return {
      previewKind: 'generic',
      pathChip: pathChip || undefined,
      bodyText: pathChip || contentText || undefined,
      previewLines: filterEnvelopeLines(createDetailLines(contentText, 6)),
    };
  }

  if (normalized === 'rdx_context' || normalized === 'agent_handoff') {
    const target = sanitizeContentText(stringifyPreview(
      argsRecord?.target ?? argsRecord?.agent ?? details?.target,
    ));
    return {
      previewKind: 'generic',
      chips: target ? [target] : undefined,
      bodyText: contentText || target || undefined,
      previewLines: filterEnvelopeLines(createDetailLines(contentText, 6)),
    };
  }

  if (normalized === 'glob' || normalized === 'grep') {
    const fromContent = contentText ? createDetailLines(contentText, 8) : [];
    const fromMatches = collectReadableText(
      record?.matches
      ?? record?.files
      ?? record?.paths
      ?? readNestedValue(record ?? {}, ['data', 'matches'])
      ?? readNestedValue(record ?? {}, ['data', 'files']),
      8,
    );
    const previewLines = filterEnvelopeLines(fromContent.length > 0 ? fromContent : fromMatches);
    const truncated = Boolean(details?.truncated ?? record?.truncated);

    let bodyText = '';
    if (normalized === 'glob') {
      const matched = asFiniteNumber(details?.matched ?? record?.matched) ?? (
        previewLines.length > 0 ? previewLines.length : undefined
      );
      if (matched != null) {
        bodyText = `${matched} file${matched === 1 ? '' : 's'}${truncated ? '+' : ''}`;
      }
    } else {
      const matchedLines = asFiniteNumber(
        details?.matchedLines ?? details?.matched ?? record?.matchedLines ?? record?.matched,
      ) ?? (previewLines.length > 0 ? previewLines.length : undefined);
      const matchedFiles = asFiniteNumber(details?.matchedFiles ?? record?.matchedFiles);
      const parts: string[] = [];
      if (matchedLines != null) parts.push(`${matchedLines} match${matchedLines === 1 ? '' : 'es'}`);
      if (matchedFiles != null) parts.push(`${matchedFiles} file${matchedFiles === 1 ? '' : 's'}`);
      bodyText = parts.join(' · ');
      if (truncated && bodyText) bodyText += '+';
    }

    const bodyLines = previewLines.slice(0, 3);
    if (!bodyText && bodyLines.length > 0) {
      bodyText = bodyLines.length === 1
        ? bodyLines[0]
        : `${compactText(bodyLines[0], 48)} · +${previewLines.length - 1}`;
    }

    return {
      previewKind: 'generic',
      bodyText: bodyText || undefined,
      bodyLines: bodyLines.length > 0 ? bodyLines : undefined,
      previewLines,
    };
  }

  if (FILE_TOOL_NAMES.test(normalized)) {
    const pathChip = sanitizeContentText(
      stringifyPreview(
        argsRecord?.uri
        ?? argsRecord?.ref
        ?? argsRecord?.path
        ?? argsRecord?.file
        ?? argsRecord?.filePath
        ?? argsRecord?.filepath
        ?? argsRecord?.destination
        ?? argsRecord?.dest
        ?? argsRecord?.source
        ?? details?.uri
        ?? details?.ref
        ?? details?.path
        ?? record?.path,
      ),
    );
    const isRead = /read_file|^read$/i.test(normalized);
    const previewLineLimit = isRead ? 4 : 3;
    const baseLines = contentText
      ? createDetailLines(contentText, previewLineLimit)
      : extractReadableResultLines(parsed, undefined, previewLineLimit);
    const binarySafe = isLikelyBinaryText(baseLines.join('\n'))
      ? ['Binary content omitted from preview.']
      : filterEnvelopeLines(baseLines);
    const previewLines = filterEnvelopeLines(enhanceToolPreviewLines(
      toolName,
      parsed,
      contentText || undefined,
      binarySafe,
    ));
    const totalLines = asFiniteNumber(
      details?.totalLines
      ?? details?.lineCount
      ?? record?.totalLines
      ?? record?.lineCount
      ?? readNestedValue(record ?? {}, ['meta', 'lineCount']),
    );
    let bodyText = pathChip || undefined;
    if (isRead && bodyText && totalLines != null) {
      bodyText = `${bodyText} · ${totalLines} lines`;
    } else if (!isRead && previewLines.length > 0 && !bodyText) {
      bodyText = previewLines[0];
    }

    return {
      previewKind: 'file',
      pathChip: pathChip || undefined,
      bodyText,
      previewLines,
    };
  }

  if (normalized === 'web_search' || normalized === 'web_fetch') {
    const detailsKind = stringifyPreview(details?.kind);
    if (normalized === 'web_search' || detailsKind === 'search') {
      const resultCount = asFiniteNumber(
        details?.resultCount
        ?? record?.resultCount
        ?? (Array.isArray(details?.results) ? details.results.length : undefined),
      );
      const query = stringifyPreview(argsRecord?.query ?? details?.query ?? record?.query);
      const countLabel = resultCount != null
        ? `${String(resultCount)} 来源`
        : '来源';
      const summary = query
        ? `${countLabel}的 “${compactText(query, 36)}”`
        : countLabel;
      const enhanced = enhanceToolPreviewLines(
        toolName,
        parsed,
        contentText || undefined,
        filterEnvelopeLines(createDetailLines(contentText, 3)),
      );
      return {
        previewKind: 'web',
        bodyText: summary,
        previewLines: filterEnvelopeLines([summary, ...enhanced.filter((line) => line !== summary)]).slice(0, 8),
      };
    }

    const status = asFiniteNumber(details?.status ?? record?.status);
    const bytes = asFiniteNumber(details?.bytes ?? record?.bytes);
    const statusBits: string[] = [];
    if (status != null) statusBits.push(`HTTP ${status}`);
    if (bytes != null) statusBits.push(`${bytes} bytes`);
    const enhanced = enhanceToolPreviewLines(
      toolName,
      parsed,
      contentText || undefined,
      filterEnvelopeLines(createDetailLines(contentText, 3)),
    );
    const previewLines = filterEnvelopeLines([
      ...(statusBits.length > 0 ? [statusBits.join(' · ')] : []),
      ...enhanced,
    ]);
    return {
      previewKind: 'web',
      bodyText: statusBits.length > 0 ? statusBits.join(' · ') : undefined,
      previewLines,
    };
  }

  const previewLineLimit = 6;
  const baseLines = contentText
    ? createDetailLines(contentText, previewLineLimit)
    : extractReadableResultLines(parsed, undefined, previewLineLimit);
  const binarySafe = isLikelyBinaryText(baseLines.join('\n'))
    ? ['Binary content omitted from preview.']
    : filterEnvelopeLines(baseLines);
  const previewLines = filterEnvelopeLines(enhanceToolPreviewLines(
    toolName,
    parsed,
    contentText || undefined,
    binarySafe,
  ));
  const total = asFiniteNumber(
    details?.total
    ?? details?.matched
    ?? details?.count
    ?? record?.total
    ?? record?.matched,
  );
  const bodyLines = previewLines.slice(0, 3);
  let bodyText = total != null ? `${total} items` : undefined;
  if (!bodyText && previewLines[0]) {
    bodyText = compactText(previewLines[0].replace(/\s+/g, ' ').trim(), 72);
  }

  return {
    previewKind: 'generic',
    bodyText,
    bodyLines: bodyLines.length > 0 ? bodyLines : undefined,
    previewLines,
  };
};

const asFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
};

const extractContentLayerText = (parsed: unknown, raw?: string): string => {
  const collected = collectReadableText(parsed, 40);
  if (collected.length > 0) {
    return collected.join('\n');
  }
  if (typeof parsed === 'string') {
    const extracted = extractContentTextFromJsonishString(parsed);
    if (extracted) return extracted;
    if (!isEnvelopeText(parsed)) return parsed;
  }
  if (raw) {
    const extracted = extractContentTextFromJsonishString(raw);
    if (extracted) return extracted;
    if (!isEnvelopeText(raw) && !isJsonLike(raw)) return raw;
  }
  return '';
};

const extractSkillDescription = (contentText: string): string => {
  const text = contentText.trim();
  if (!text) return '';
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(text);
  if (frontmatter) {
    const descMatch = /(?:^|\n)description:\s*(?:>-?\s*)?([^\n]+)/i.exec(frontmatter[1]);
    if (descMatch?.[1]) return descMatch[1].trim().replace(/^['"]|['"]$/g, '');
    const body = frontmatter[2].trim();
    if (body) {
      const paragraph = body.split(/\n\s*\n/).map((part) => part.replace(/^#+\s+.*/gm, '').trim()).find(Boolean);
      if (paragraph) return paragraph;
    }
  }
  const paragraph = text
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^#+\s+.*/gm, '').replace(/\s+/g, ' ').trim())
    .find((part) => part && !part.startsWith('---'));
  return paragraph ?? '';
};

const sanitizeContentText = (value: string): string => {
  if (!value) return '';
  return value
    // eslint-disable-next-line no-control-regex -- Tool output sanitization intentionally removes NUL bytes.
    .replace(/\u0000/g, '')
    .replace(/\uFFFD/g, '')
    // eslint-disable-next-line no-control-regex -- Tool output sanitization intentionally removes unsafe C0 controls.
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, '');
};

const isEnvelopeText = (value: string): boolean => {
  const text = value.trim();
  if (!text) return false;
  if (/^\{\s*"?ok"?\s*:/i.test(text)) return true;
  if (/"trace_id"\s*:/.test(text) && /"duration_ms"\s*:/.test(text)) return true;
  return false;
};

const filterEnvelopeLines = (lines: string[]): string[] => (
  lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (ENVELOPE_KEY_PATTERN.test(trimmed.replace(/[",:]/g, '').split(/\s+/)[0] ?? '')) return false;
    if (/^[{[]/.test(trimmed) && /"(?:ok|trace_id|duration_ms)"\s*:/.test(trimmed)) return false;
    if (/^\s*"(?:ok|data|artifacts|trace_id|duration_ms)"\s*:/.test(trimmed)) return false;
    return true;
  })
);

const extractReadableResultLines = (parsed: unknown, raw?: string, maxLines = 3): string[] => {
  const collected = collectReadableText(parsed, maxLines);
  if (collected.length > 0) return collected.slice(0, maxLines);
  // Never dump the transport envelope into preview; raw tier owns the full payload.
  if (raw && !isEnvelopeText(raw) && !isJsonLike(raw)) {
    return createDetailLines(raw, maxLines);
  }
  return [];
};

const enhanceToolPreviewLines = (
  toolName: string,
  parsed: unknown,
  contentRaw: string | undefined,
  previewLines: string[],
): string[] => {
  const normalized = normalizeToolName(toolName);
  const record = toRecord(parsed);

  if (normalized === 'shell' || normalized.includes('shell')) {
    const stdout = stringifyPreview(
      record?.stdout
      ?? readNestedValue(record ?? {}, ['result', 'stdout'])
      ?? contentRaw,
    );
    const lines = filterEnvelopeLines(createDetailLines(stdout, SHELL_PREVIEW_MAX_LINES));
    if (lines.length > 0) return lines;
  }

  if (/grep|glob/.test(normalized)) {
    const matches = collectReadableText(
      record?.matches ?? record?.files ?? record?.paths ?? readNestedValue(record ?? {}, ['data', 'matches']),
      4,
    );
    if (matches.length > 0) return matches;
  }

  if (/read_file|^read$/.test(normalized)) {
    const lineCount = record?.lineCount
      ?? record?.lines
      ?? record?.totalLines
      ?? readNestedValue(record ?? {}, ['meta', 'lineCount'])
      ?? readNestedValue(record ?? {}, ['data', 'details', 'totalLines'])
      ?? readNestedValue(record ?? {}, ['data', 'details', 'lineCount']);
    if (lineCount !== undefined && lineCount !== null) {
      return [`${String(lineCount)} lines`, ...previewLines].filter(Boolean).slice(0, 4);
    }
  }

  if (normalized.startsWith('git_')) {
    const summary = stringifyPreview(record?.summary ?? record?.status ?? record?.output ?? contentRaw);
    const lines = filterEnvelopeLines(createDetailLines(summary, 3));
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
    const taskRecord = Array.isArray(record?.tasks) ? toRecord(record.tasks[0]) : null;
    const summary = stringifyPreview(
      record?.subject
      ?? record?.name
      ?? record?.taskId
      ?? record?.id
      ?? record?.title
      ?? taskRecord?.subject
      ?? taskRecord?.name
      ?? taskRecord?.title,
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
  pageChip?: {
    domain: string;
    url: string;
    pathLabel?: string;
    title?: string;
    status?: number;
    bytes?: number;
  };
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

  if (normalized === 'web_fetch' || details?.kind === 'fetch') {
    const url = stringifyPreview(
      details?.url
      ?? record?.url
      ?? readNestedValue(record ?? {}, ['data', 'details', 'url']),
    );
    if (!url) return {};
    const domain = resolveUrlHostname(url);
    if (!domain) return {};
    let pathLabel: string | undefined;
    try {
      const parsed = new URL(url);
      const combined = `${parsed.pathname || '/'}${parsed.search || ''}`;
      if (combined && combined !== '/') {
        pathLabel = combined.length > 48 ? `${combined.slice(0, 47)}…` : combined;
      }
    } catch {
      pathLabel = undefined;
    }
    const statusRaw = details?.status ?? record?.status ?? readNestedValue(record ?? {}, ['data', 'details', 'status']);
    const bytesRaw = details?.bytes ?? record?.bytes ?? readNestedValue(record ?? {}, ['data', 'details', 'bytes']);
    const title = stringifyPreview(
      details?.title
      ?? record?.title
      ?? readNestedValue(record ?? {}, ['data', 'details', 'title']),
    ) || undefined;
    const status = typeof statusRaw === 'number' && Number.isFinite(statusRaw) ? statusRaw : undefined;
    const bytes = typeof bytesRaw === 'number' && Number.isFinite(bytesRaw) ? bytesRaw : undefined;
    return {
      pageChip: {
        domain,
        url,
        ...(pathLabel ? { pathLabel } : {}),
        ...(title ? { title } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(bytes !== undefined ? { bytes } : {}),
      },
    };
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

  for (const key of ['results', 'entries', 'files', 'items', 'matches', 'tasks']) {
    const nested = collectReadableText(readNestedValue(record, ['data', key]) ?? record[key], maxLines);
    if (nested.length > 0) return nested;
  }

  const detailsResults = collectReadableText(readNestedValue(record, ['data', 'details', 'results']), maxLines);
  if (detailsResults.length > 0) return detailsResults;

  for (const key of ['subject', 'name', 'title', 'summary', 'output', 'path', 'message', 'capturePath']) {
    const nested = stringifyPreview(record[key]);
    if (nested && !isEnvelopeText(nested)) return createDetailLines(nested, maxLines);
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

const LINE_NUMBER_GUTTER = /^\s*\d+\s*(?:→|->|\||>)\s?/;

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
