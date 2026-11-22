import { type ConversationWorkBlock, type ConversationReasoningState, type ConversationLoopStopReason, type ConversationLoopOutputPhase, type ConversationThinkingItem, type ConversationWorkTrace } from '@shared/types/conversation';
import { lastLoopThinking } from '@shared/conversation/loopItems';
import { normalizeWorkProcessText, formatDurationMs } from './workProcessFormat';
import { groupImageRows } from './groupImageRows';
import { isMeaningfulText, getMeaningfulBlockSummary, isNoisyText } from './workProcessBlockText';
import { createApprovalRow } from './workProcessDecisionRows';
import { createToolRowForPresentation } from './workProcessToolRows';
import { countWorkActions } from './workProcessSectionModel';
import { type WorkProcessRow, type WorkProcessPresentation } from './workProcessTypes';
import { buildPresentationUnits, presentationUnitsToDetailRows, type ThinkingItemPresentation } from './workProcessBlockProjection';
import { markReadSearchResults, mergeWebReadsAcrossSteps } from './workProcessWebFlow';
import type { Translator } from '../../i18n/messages';

const INTERNAL_BLOCK_IDS = new Set(['runtime-run', 'assistant-output', 'runtime-reasoning']);

const normalizeThinkingDedupKey = (value: string): string => (
  normalizeWorkProcessText(value).replace(/\s+/g, ' ').toLowerCase()
);

const resolveReasoningState = (block: ConversationWorkBlock): ConversationReasoningState => {
  if (block.reasoningState) return block.reasoningState;
  const thinking = lastLoopThinking(block);
  if (!thinking) return 'none';
  if (thinking.kind === 'raw') return 'raw';
  if (thinking.kind === 'summary') return 'summary';
  if (thinking.kind === 'unknown') return 'unknown';
  if (thinking.kind === 'opaque') return 'opaque';
  return 'none';
};

const isNonFinalStopReason = (stopReason?: ConversationLoopStopReason): boolean => (
  stopReason === 'max_tokens' || stopReason === 'refusal' || stopReason === 'aborted'
);

const resolveOutputPhase = (
  block: ConversationWorkBlock,
  _hasVisibleProcessEvidence: boolean,
): ConversationLoopOutputPhase => {
  // Runtime phase is authoritative. Before it settles, a loop without tools reads as the
  // answering loop; its text items stream in place and take their phase when the loop settles.
  if (block.result?.outputPhase) return block.result.outputPhase;
  if (block.toolCalls.length > 0 || isNonFinalStopReason(block.result?.stopReason)) {
    return 'commentary';
  }
  if (block.status === 'running' || block.status === 'pending') {
    return 'final_answer';
  }
  return 'final_answer';
};

/**
 * "Thought for" only when this block's own reasoning start and settle times are known and apart; never the step's
 * time, and never an invented instant.
 */
const resolveSettledThinkingLabel = (item: ConversationThinkingItem, t: Translator): string =>
  item.startedAt !== undefined && item.completedAt !== undefined && item.completedAt > item.startedAt
    ? t('chat.workProcessThoughtFor', { duration: formatDurationMs(item.startedAt, item.completedAt) })
    : t('chat.workProcessThinkingComplete');

/**
 * One provider thinking block as a Work Process row. Visible raw, summary and unknown reasoning with text
 * becomes a row; opaque or hidden reasoning never renders, not even as a placeholder.
 */
const resolveThinkingItem = (
  block: ConversationWorkBlock,
  item: ConversationThinkingItem,
  t: Translator,
): ThinkingItemPresentation | null => {
  const { thinking } = item;
  if (thinking.kind === 'opaque' || thinking.visibility === 'hidden') return null;
  const preview = normalizeWorkProcessText(thinking.text ?? '');
  if (!preview) return null;
  const isActiveBlock = block.status === 'running' || block.status === 'pending';
  const status = isActiveBlock ? item.status : 'complete';
  return {
    preview,
    label: status === 'streaming' ? t('chat.workProcessThinkingStreaming') : resolveSettledThinkingLabel(item, t),
    kind: thinking.kind,
    visibility: thinking.visibility,
    status,
    // Expand while the block streams; fold once it settles (the row keeps a user's sticky choice).
    openByDefault: status === 'streaming',
  };
};

const getLoopProjectionDeps = (t: Translator) => ({
  resolveOutputPhase,
  resolveReasoningState,
  resolveThinkingItem: (block: ConversationWorkBlock, item: ConversationThinkingItem) => resolveThinkingItem(block, item, t),
  isNonFinalStopReason,
  normalizeThinkingDedupKey,
  createApprovalRow: (block: ConversationWorkBlock) => createApprovalRow(block, t),
  createDiagnosticRow: (block: ConversationWorkBlock) => createDiagnosticRow(block, t),
  shouldSkipBlock,
  getMeaningfulBlockSummary,
  countToolSteps,
});

const buildProjectionContext = (t: Translator): {
  visibleThinkingKeys: Set<string>;
  hasVisibleProcessEvidence: boolean;
  createToolRow: (call: import('@shared/types/conversation').ConversationToolCall) => WorkProcessRow;
  groupProcessRows: typeof groupProcessRows;
  blocksToDetailRows: (blocks: ConversationWorkBlock[]) => WorkProcessRow[];
  t: Translator;
} => ({
  visibleThinkingKeys: new Set(),
  hasVisibleProcessEvidence: false,
  createToolRow: (call) => createToolRowForPresentation(call, t),
  groupProcessRows,
  blocksToDetailRows: (blocks) => blocksToDetailRows(blocks, t),
  t,
});

function blocksToDetailRows(blocks: ConversationWorkBlock[], t: Translator): WorkProcessRow[] {
  const ctx = buildProjectionContext(t);
  const units = buildPresentationUnits(blocks, getLoopProjectionDeps(t), ctx);
  return presentationUnitsToDetailRows(units);
}

export const buildWorkProcessPresentation = (
  trace: ConversationWorkTrace,
  t: Translator,
): WorkProcessPresentation => {
  const blocks = Array.isArray(trace.blocks) ? trace.blocks : [];
  const rows = markReadSearchResults(mergeWebReadsAcrossSteps(blocksToDetailRows(blocks, t)));
  const toolCount = countToolSteps(rows);
  const stepCount = countSteps(rows);
  const important = trace.status === 'error' || rowsHaveAttention(rows);
  const summary = isMeaningfulText(trace.summary) ? trace.summary?.trim() ?? '' : '';

  return {
    rows,
    stepCount,
    toolCount,
    actionCount: countWorkActions(rows),
    summary,
    toolEvidence: trace.toolEvidence ? { ...trace.toolEvidence } : undefined,
    duration: formatTraceDuration(blocks),
    important,
  };
};

const groupProcessRows = groupImageRows;

const countToolSteps = (rows: WorkProcessRow[]): number => rows.reduce((total, row) => {
  if (row.type === 'section') return total + countToolSteps(row.steps);
  if (row.type === 'toolAggregate') return total + row.children.length;
  if (row.type === 'tool') return total + (row.imageCalls?.length ?? 1);
  if (row.type === 'userInput') return total + 1;
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

const createDiagnosticRow = (block: ConversationWorkBlock, t: Translator): WorkProcessRow => ({
  type: 'diagnostic',
  id: block.id,
  status: block.status === 'error' ? 'error' : block.status,
  severity: block.diagnosticSeverity ?? (block.status === 'error' ? 'error' : 'info'),
  isHookDiagnostic: block.id.startsWith('diagnostic-hook.') || block.id.startsWith('runtime-diagnostic-hook.'),
  message: getMeaningfulBlockSummary(block) || block.title || t('chat.runtimeDiagnostic'),
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
