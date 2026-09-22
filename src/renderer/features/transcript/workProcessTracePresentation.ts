import { normalizeWorkProcessText, formatDurationMs } from './workProcessFormat';
import { type ConversationWorkBlock, type ConversationReasoningState, type ConversationLoopStopReason, type ConversationLoopOutputPhase, type ConversationWorkTrace } from '@shared/types/conversation';
import { isMeaningfulText, getMeaningfulBlockSummary, isNoisyText } from './workProcessBlockText';
import { type ThinkingArtifact } from '@shared/types/reasoning';
import { createApprovalRow } from './workProcessDecisionRows';
import { createToolRowForPresentation } from './workProcessToolRows';
import { type WorkProcessRow, type WorkProcessPresentation } from './workProcessTypes';
import { buildPresentationUnits, presentationUnitsToDetailRows, markLastSectionOpen } from './workProcessBlockProjection';

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
  createToolRow: typeof createToolRowForPresentation;
  groupProcessRows: typeof groupProcessRows;
  blocksToDetailRows: typeof blocksToDetailRows;
} => ({
  visibleThinkingKeys: new Set(),
  hasVisibleProcessEvidence: false,
  createToolRow: createToolRowForPresentation,
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
