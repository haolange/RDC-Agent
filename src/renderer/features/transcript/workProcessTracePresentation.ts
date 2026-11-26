import {
  type ConversationWorkBlock,
  type ConversationReasoningState,
  type ConversationLoopStopReason,
  type ConversationLoopOutputPhase,
  type ConversationThinkingItem,
  type ConversationWorkTrace,
} from '@shared/types/conversation';
import { lastLoopThinking } from '@shared/conversation/loopItems';
import { normalizeWorkProcessText, formatDurationMs } from './workProcessFormat';
import { groupImageRows } from './groupImageRows';
import { isMeaningfulText, getMeaningfulBlockSummary, isNoisyText } from './workProcessBlockText';
import { createApprovalRow } from './workProcessDecisionRows';
import { createToolRowForPresentation } from './workProcessToolRows';
import { countFailedActions, countWorkActions } from './workProcessSectionModel';
import { type WorkProcessRow, type WorkProcessPresentation } from './workProcessTypes';
import {
  buildPresentationUnits,
  presentationUnitsToDetailRows,
  type ThinkingItemPresentation,
} from './workProcessBlockProjection';
import { markReadSearchResults, mergeWebReadsAcrossSteps } from './workProcessWebFlow';
import { hasVisibleThinkingMarkdown } from './workProcessThinkingContent';
import type { LocalizedTranslator } from '../../i18n/messages';
import type { AppLanguage } from '@shared/types/settings';

const INTERNAL_BLOCK_IDS = new Set(['runtime-run', 'assistant-output', 'runtime-reasoning']);

const normalizeThinkingDedupKey = (value: string): string =>
  normalizeWorkProcessText(value).replace(/\s+/g, ' ').toLowerCase();

const resolveReasoningState = (block: ConversationWorkBlock): ConversationReasoningState => {
  if (block.reasoningState) return block.reasoningState;
  const thinking = lastLoopThinking(block);
  return thinking ? thinking.kind : 'none';
};

const isNonFinalStopReason = (stopReason?: ConversationLoopStopReason): boolean =>
  stopReason === 'max_tokens' || stopReason === 'refusal' || stopReason === 'aborted';

const resolveOutputPhase = (block: ConversationWorkBlock): ConversationLoopOutputPhase => {
  // Runtime phase is authoritative. Before it settles, a loop without tools reads as the
  // answering loop; its text items stream in place and take their phase when the loop settles.
  if (block.result?.outputPhase) return block.result.outputPhase;
  if (block.toolCalls.length > 0 || isNonFinalStopReason(block.result?.stopReason)) {
    return 'commentary';
  }
  return 'final_answer';
};

/**
 * "Thought for" only when this block's own reasoning start and settle times are known and apart; never the step's
 * time, and never an invented instant.
 */
const resolveSettledThinkingLabel = (item: ConversationThinkingItem, t: LocalizedTranslator): string =>
  item.startedAt !== undefined && item.completedAt !== undefined && item.completedAt > item.startedAt
    ? t('chat.workProcessThoughtFor', { duration: formatDurationMs(t.language, item.startedAt, item.completedAt) })
    : t('chat.workProcessThinkingComplete');

/**
 * One provider thinking block as a Work Process row. Visible raw, summary and unknown reasoning with text
 * becomes a row; opaque or hidden reasoning never renders, not even as a placeholder.
 */
const resolveThinkingItem = (
  block: ConversationWorkBlock,
  item: ConversationThinkingItem,
  t: LocalizedTranslator,
): ThinkingItemPresentation | null => {
  const { thinking } = item;
  if (thinking.kind === 'opaque' || thinking.visibility === 'hidden') return null;
  const preview = (thinking.text ?? '').replace(/\r\n?/gu, '\n');
  if (!hasVisibleThinkingMarkdown(preview)) return null;
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

const getLoopProjectionDeps = (t: LocalizedTranslator) => ({
  resolveOutputPhase,
  resolveReasoningState,
  resolveThinkingItem: (block: ConversationWorkBlock, item: ConversationThinkingItem) =>
    resolveThinkingItem(block, item, t),
  isNonFinalStopReason,
  normalizeThinkingDedupKey,
  createApprovalRow: (block: ConversationWorkBlock) => createApprovalRow(block, t),
  createDiagnosticRow: (block: ConversationWorkBlock) => createDiagnosticRow(block, t),
  shouldSkipBlock,
  getMeaningfulBlockSummary,
  countToolSteps,
});

const buildProjectionContext = (
  t: LocalizedTranslator,
): {
  visibleThinkingKeys: Set<string>;
  createToolRow: (call: import('@shared/types/conversation').ConversationToolCall) => WorkProcessRow;
  groupProcessRows: typeof groupProcessRows;
  blocksToDetailRows: (blocks: ConversationWorkBlock[]) => WorkProcessRow[];
  t: LocalizedTranslator;
} => ({
  visibleThinkingKeys: new Set(),
  createToolRow: (call) => createToolRowForPresentation(call, t),
  groupProcessRows,
  blocksToDetailRows: (blocks) => blocksToDetailRows(blocks, t),
  t,
});

function blocksToDetailRows(blocks: ConversationWorkBlock[], t: LocalizedTranslator): WorkProcessRow[] {
  const ctx = buildProjectionContext(t);
  const units = buildPresentationUnits(blocks, getLoopProjectionDeps(t), ctx);
  return presentationUnitsToDetailRows(units);
}

export const buildWorkProcessPresentation = (
  trace: ConversationWorkTrace,
  t: LocalizedTranslator,
  owner?: { reply: string },
): WorkProcessPresentation => {
  const blocks = Array.isArray(trace.blocks) ? trace.blocks : [];
  const reply = owner?.reply.trim();
  const processBlocks = owner
    ? blocks.map((block) =>
        block.items?.length
          ? {
              ...block,
              items: block.items.filter(
                (item) =>
                  item.kind !== 'text' || (item.phase !== 'final_answer' && (!reply || item.text.trim() !== reply)),
              ),
            }
          : block,
      )
    : blocks;
  const rows = markReadSearchResults(mergeWebReadsAcrossSteps(blocksToDetailRows(processBlocks, t), t.language));
  const toolCount = countToolSteps(rows);
  const stepCount = countSteps(rows);
  const important = trace.status === 'error' || rowsHaveAttention(rows);
  const summary = isMeaningfulText(trace.summary) ? trace.summary.trim() : '';

  return {
    rows,
    stepCount,
    toolCount,
    actionCount: countWorkActions(rows),
    failureCount: countFailedActions(rows),
    summary,
    toolEvidence: trace.toolEvidence ? { ...trace.toolEvidence } : undefined,
    important,
  };
};

const groupProcessRows = groupImageRows;

const countToolSteps = (rows: WorkProcessRow[]): number =>
  rows.reduce((total, row) => {
    if (row.type === 'section') return total + countToolSteps(row.steps);
    if (row.type === 'tool') return total + (row.imageCalls?.length ?? 1);
    if (row.type === 'userInput' || row.type === 'planReview') return total + 1;
    return total;
  }, 0);

const countSteps = (rows: WorkProcessRow[]): number =>
  rows.reduce((total, row) => {
    if (row.type === 'section') return total + 1 + countSteps(row.steps);
    return total + 1;
  }, 0);

const rowsHaveAttention = (rows: WorkProcessRow[]): boolean =>
  rows.some((row) => {
    if (row.type === 'section')
      return (
        row.status === 'running' || row.status === 'error' || row.status === 'skipped' || rowsHaveAttention(row.steps)
      );
    return row.status === 'error' || row.status === 'running' || row.status === 'skipped';
  });

/** How long the turn has worked: from its first block to its last settled one, or to `now` while a block still runs. */
export const formatTraceDuration = (blocks: ConversationWorkBlock[], language: AppLanguage, now?: number): string => {
  const timestamps = blocks.flatMap((block) => [block.startedAt, block.completedAt].filter(isNumber));
  if (timestamps.length === 0) return '';
  return formatDurationMs(
    language,
    Math.min(...timestamps),
    blocks.some((block) => !block.completedAt) ? now : Math.max(...timestamps),
  );
};

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const createDiagnosticRow = (block: ConversationWorkBlock, t: LocalizedTranslator): WorkProcessRow => ({
  type: 'diagnostic',
  id: block.id,
  status: block.status === 'error' ? 'error' : block.status,
  severity: block.diagnosticSeverity ?? (block.status === 'error' ? 'error' : 'info'),
  isHookDiagnostic: block.id.startsWith('diagnostic-hook.') || block.id.startsWith('runtime-diagnostic-hook.'),
  message: getMeaningfulBlockSummary(block) || block.title || t('chat.runtimeDiagnostic'),
  detailLines: [],
  duration: formatDurationMs(t.language, block.startedAt, block.completedAt),
});

const shouldSkipBlock = (block: ConversationWorkBlock): boolean => {
  if (INTERNAL_BLOCK_IDS.has(block.id) || block.kind === 'output') return true;
  if (block.kind === 'user_input') return true;
  if (block.kind === 'approval' && block.status === 'complete') return true;
  if (!block.summary && isNoisyText(block.title)) return true;
  return false;
};
