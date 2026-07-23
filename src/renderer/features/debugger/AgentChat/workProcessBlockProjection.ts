import type {
  ConversationLoopOutputPhase,
  ConversationLoopStopReason,
  ConversationReasoningState,
  ConversationWorkBlock,
} from '@shared/types/conversation';
import type { ThinkingArtifact } from '@shared/types/reasoning';
import { formatDurationMs, normalizeWorkProcessText } from './workProcessFormat';
import type {
  LoopPresentationUnit,
  PresentationUnit,
  StandalonePresentationUnit,
} from './workProcessUnits';
import { aggregateSectionSteps } from './workProcessToolAggregate';
import type { WorkProcessRow } from './workProcessTypes';

export type { LoopPresentationUnit, PresentationUnit, StandalonePresentationUnit } from './workProcessUnits';

export interface BlockProjectionContext {
  visibleThinkingKeys: Set<string>;
  hasVisibleProcessEvidence: boolean;
  createToolRow: (call: import('@shared/types/conversation').ConversationToolCall) => WorkProcessRow;
  groupProcessRows: (rows: WorkProcessRow[]) => WorkProcessRow[];
  blocksToDetailRows: (blocks: ConversationWorkBlock[]) => WorkProcessRow[];
}

export interface LoopProjectionDeps {
  resolveOutputPhase: (block: ConversationWorkBlock, hasVisibleProcessEvidence: boolean) => ConversationLoopOutputPhase;
  resolveReasoningState: (block: ConversationWorkBlock) => ConversationReasoningState;
  resolveSectionProse: (
    block: ConversationWorkBlock,
    outputPhase: ConversationLoopOutputPhase,
  ) => {
    proseText: string;
    proseStreaming: boolean;
  };
  resolveSectionThinking: (
    block: ConversationWorkBlock,
    hasVisibleEvidence: boolean,
  ) => {
    preview: string;
    label: string;
    kind?: ThinkingArtifact['kind'];
    source?: string;
    visibility?: ThinkingArtifact['visibility'];
    status?: ConversationWorkBlock['thinkingStatus'];
    expandable: boolean;
    openByDefault: boolean;
  };
  resolveResponseThinking: (block: ConversationWorkBlock) => {
    preview: string;
    label: string;
    kind?: ThinkingArtifact['kind'];
    visibility?: ThinkingArtifact['visibility'];
    status?: ConversationWorkBlock['thinkingStatus'];
    expandable: boolean;
    openByDefault: boolean;
  };
  isNonFinalStopReason: (stopReason?: ConversationLoopStopReason) => boolean;
  normalizeThinkingDedupKey: (value: string) => string;
  createReasoningIndicatorRow: (
    block: ConversationWorkBlock,
    state: Extract<ConversationReasoningState, 'opaque' | 'hidden'>,
  ) => Extract<WorkProcessRow, { type: 'reasoningIndicator' }>;
  createApprovalRow: (block: ConversationWorkBlock) => WorkProcessRow;
  createDiagnosticRow: (block: ConversationWorkBlock) => WorkProcessRow;
  shouldSkipBlock: (block: ConversationWorkBlock) => boolean;
  getMeaningfulBlockSummary: (block: ConversationWorkBlock) => string;
  countToolSteps: (rows: WorkProcessRow[]) => number;
}

export function buildPresentationUnits(
  blocks: ConversationWorkBlock[],
  deps: LoopProjectionDeps,
  ctx: BlockProjectionContext,
): PresentationUnit[] {
  const units: PresentationUnit[] = [];

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];

    if (block.kind === 'llm_turn') {
      const unit = projectLlmTurn(block, deps, ctx);
      if (unit) units.push(unit);
      continue;
    }

    if (block.kind === 'user_input') {
      const userInputRows = ctx.groupProcessRows(block.toolCalls.map((call) => ctx.createToolRow(call)));
      if (userInputRows.length > 0) {
        ctx.hasVisibleProcessEvidence = true;
        const lastUnit = units[units.length - 1];
        if (lastUnit?.kind === 'loop') {
          const sectionRow = lastUnit.rows.find((row): row is Extract<WorkProcessRow, { type: 'section' }> => row.type === 'section');
          if (sectionRow) {
            sectionRow.steps.push(...userInputRows);
            const shouldDeferMergedRows = shouldDeferMergedSectionSteps(sectionRow);
            sectionRow.stepsDisclosure = shouldDeferMergedRows ? 'deferred' : 'visible';
            sectionRow.visibleSteps = aggregateSectionSteps(
              createVisibleSectionSteps(sectionRow.steps, shouldDeferMergedRows),
            );
            sectionRow.stepCount = deps.countToolSteps(sectionRow.steps);
            if (sectionRow.status === 'complete' && userInputRows.some((child) => child.status === 'running' || child.status === 'pending')) {
              sectionRow.status = 'running';
            }
            if (userInputRows.some((child) => child.status === 'error')) {
              sectionRow.status = 'error';
              sectionRow.defaultOpen = true;
            }
            continue;
          }
        }
        units.push({
          kind: 'standalone',
          rows: userInputRows,
          loopIds: [],
        } satisfies StandalonePresentationUnit);
      }
      continue;
    }

    if (block.kind === 'output' || shouldSkipStandalone(block, deps)) {
      continue;
    }

    if (block.kind === 'approval') {
      ctx.hasVisibleProcessEvidence = true;
      units.push({
        kind: 'standalone',
        rows: [deps.createApprovalRow(block)],
        loopIds: [],
      });
      continue;
    }

    if (block.kind === 'subagent') {
      const childRows = block.children ? ctx.blocksToDetailRows(block.children) : [];
      ctx.hasVisibleProcessEvidence = true;
      units.push({
        kind: 'standalone',
        rows: [{
          type: 'subagent',
          id: block.id,
          status: block.status,
          profile: block.title.replace(/^Sub-agent[:?]\s*/, '').trim() || 'sub-agent',
          summary: deps.getMeaningfulBlockSummary(block) || block.summary || '',
          duration: formatDurationMs(block.startedAt, block.completedAt),
          children: childRows,
        }],
        loopIds: [block.id],
      });
      continue;
    }

    if (block.kind === 'compaction') {
      ctx.hasVisibleProcessEvidence = true;
      units.push({
        kind: 'standalone',
        rows: [{
          type: 'summary',
          id: block.id,
          status: block.status,
          text: deps.getMeaningfulBlockSummary(block) || block.title || '上下文压缩',
          detailLines: [],
          duration: formatDurationMs(block.startedAt, block.completedAt),
        }],
        loopIds: [block.id],
      });
      continue;
    }

    if (block.kind === 'command') {
      const summaryText = deps.getMeaningfulBlockSummary(block);
      if (summaryText) {
        ctx.hasVisibleProcessEvidence = true;
        const taskStatus = block.status === 'error'
          ? 'failed'
          : block.status === 'running'
            ? 'in_progress'
            : block.status === 'pending'
              ? 'pending'
              : 'completed';
        units.push({
          kind: 'standalone',
          rows: [{
            type: 'task',
            id: block.id,
            taskId: block.id,
            status: block.status,
            title: summaryText,
            taskStatus,
            duration: formatDurationMs(block.startedAt, block.completedAt),
          }],
          loopIds: [block.id],
        });
      }
      continue;
    }

    if (block.kind === 'diagnostic' || block.status === 'error') {
      ctx.hasVisibleProcessEvidence = true;
      units.push({
        kind: 'standalone',
        rows: [deps.createDiagnosticRow(block)],
        loopIds: [block.id],
      });
      continue;
    }

    const summaryText = deps.getMeaningfulBlockSummary(block);
    if (summaryText) {
      ctx.hasVisibleProcessEvidence = true;
      units.push({
        kind: 'standalone',
        rows: [{
          type: 'summary',
          id: block.id,
          status: block.status,
          text: summaryText,
          detailLines: [],
          duration: formatDurationMs(block.startedAt, block.completedAt),
        }],
        loopIds: [block.id],
      });
    }
  }

  return units;
}

function shouldSkipStandalone(block: ConversationWorkBlock, deps: LoopProjectionDeps): boolean {
  return deps.shouldSkipBlock(block);
}

function shouldDeferMergedSectionSteps(row: Extract<WorkProcessRow, { type: 'section' }>): boolean {
  if (row.steps.length === 0) return false;
  const hasStreamingThinking = row.thinkingStatus === 'streaming'
    && Boolean(row.thinkingLabel || row.thinkingPreview);
  const hasStreamingProse = row.proseStreaming && Boolean(row.proseText);
  return hasStreamingThinking || hasStreamingProse;
}

function shouldDeferSectionSteps(
  steps: WorkProcessRow[],
  sectionProse: ReturnType<LoopProjectionDeps['resolveSectionProse']>,
  sectionThinking: ReturnType<LoopProjectionDeps['resolveSectionThinking']>,
): boolean {
  if (steps.length === 0) return false;
  const hasStreamingThinking = sectionThinking.status === 'streaming'
    && Boolean(sectionThinking.label || sectionThinking.preview);
  const hasStreamingProse = sectionProse.proseStreaming && Boolean(sectionProse.proseText);
  return hasStreamingThinking || hasStreamingProse;
}

function createDeferredVisibleStep(row: WorkProcessRow): WorkProcessRow {
  if (row.type === 'tool') {
    return {
      ...row,
      argsLines: [],
      previewLines: [],
      rawLines: [],
      bodyText: undefined,
      bodyLines: undefined,
      approval: row.approval
        ? { ...row.approval, message: '', metaLines: [] }
        : undefined,
      sourcePills: undefined,
      pageChip: undefined,
    };
  }
  if (row.type === 'userInput') {
    return {
      ...row,
      items: [...row.items],
    };
  }
  return row;
}

function createVisibleSectionSteps(steps: WorkProcessRow[], deferred: boolean): WorkProcessRow[] {
  return deferred ? steps.map(createDeferredVisibleStep) : [...steps];
}
function projectLlmTurn(
  block: ConversationWorkBlock,
  deps: LoopProjectionDeps,
  ctx: BlockProjectionContext,
): LoopPresentationUnit | StandalonePresentationUnit | null {
  const outputPhase = deps.resolveOutputPhase(block, ctx.hasVisibleProcessEvidence);
  const reasoningState = deps.resolveReasoningState(block);
  const stopReason = block.result?.stopReason;
  const steps = ctx.groupProcessRows(block.toolCalls.map((call) => ctx.createToolRow(call)));
  const loopRows: WorkProcessRow[] = [];

  const isFinalAnswer = outputPhase === 'final_answer' && !deps.isNonFinalStopReason(stopReason);

  if (isFinalAnswer) {
    // Answer-only turns never create a Reply boundary row. Provider-visible closing
    // thinking folds into a quiet thinking-only section; otherwise the turn is silent
    // and the assistant body below the Work Process is the only final-answer surface.
    // Opaque/hidden reasoning stays as an indicator only — never as WP prose.
    if (reasoningState === 'opaque' || reasoningState === 'hidden') {
      const hasThinkingText = Boolean(normalizeWorkProcessText(block.thinking?.text ?? ''));
      if (hasThinkingText) {
        if (!ctx.hasVisibleProcessEvidence) return null;
        return null;
      }
      ctx.hasVisibleProcessEvidence = true;
      return {
        kind: 'loop',
        loopId: block.id,
        rows: [deps.createReasoningIndicatorRow(block, reasoningState)],
        hasDisplayableThinking: false,
        hasSummaryThinking: false,
      };
    }
    const thinking = deps.resolveResponseThinking(block);
    if (!thinking.label && !thinking.preview) {
      if (!ctx.hasVisibleProcessEvidence) return null;
      return null;
    }
    const sectionThinking = {
      preview: thinking.preview,
      label: thinking.label,
      kind: thinking.kind,
      source: '',
      visibility: thinking.visibility,
      status: thinking.status,
      expandable: thinking.expandable,
      openByDefault: thinking.openByDefault,
    };
    dedupeSectionThinking(sectionThinking, ctx, deps);
    if (!sectionThinking.label && !sectionThinking.preview) {
      return null;
    }
    ctx.hasVisibleProcessEvidence = true;
    return {
      kind: 'loop',
      loopId: block.id,
      rows: [{
        type: 'section',
        id: block.id,
        loopId: block.id,
        status: block.status,
        proseText: '',
        proseStreaming: false,
        thinkingPreview: sectionThinking.preview,
        thinkingLabel: sectionThinking.label,
        thinkingKind: sectionThinking.kind,
        thinkingSource: sectionThinking.source,
        thinkingVisibility: sectionThinking.visibility,
        thinkingStatus: sectionThinking.status,
        thinkingExpandable: sectionThinking.expandable,
        thinkingOpenByDefault: sectionThinking.openByDefault,
        stepCount: 0,
        stepsDisclosure: 'visible',
        duration: formatDurationMs(block.startedAt, block.completedAt),
        defaultOpen: false,
        steps: [],
        visibleSteps: [],
        outputPhase,
        stopReason,
      }],
      hasDisplayableThinking: sectionThinking.expandable && Boolean(sectionThinking.preview),
      hasSummaryThinking: sectionThinking.kind === 'summary' && Boolean(sectionThinking.preview),
    };
  }

  if (reasoningState === 'opaque' || reasoningState === 'hidden') {
    const hasThinkingText = Boolean(normalizeWorkProcessText(block.thinking?.text ?? ''));
    if (!hasThinkingText) {
      loopRows.push(deps.createReasoningIndicatorRow(block, reasoningState));
    }
  }

  const sectionProse = deps.resolveSectionProse(block, outputPhase);
  const sectionThinking = deps.resolveSectionThinking(
    block,
    steps.length > 0
      || reasoningState === 'raw'
      || reasoningState === 'summary'
      || reasoningState === 'unknown'
      || ctx.hasVisibleProcessEvidence
      || Boolean(normalizeWorkProcessText(block.result?.text ?? '')),
  );
  dedupeSectionThinking(sectionThinking, ctx, deps);

  const hasIndicator = loopRows.some((row) => row.type === 'reasoningIndicator');
  const shouldRenderSection = steps.length > 0
    || Boolean(sectionProse.proseText)
    || sectionThinking.label
    || sectionThinking.expandable;

  if (
    !shouldRenderSection
    && !hasIndicator
  ) {
    return null;
  }

  if (shouldRenderSection) {
    const deferSteps = shouldDeferSectionSteps(steps, sectionProse, sectionThinking);
    const visibleSteps = aggregateSectionSteps(createVisibleSectionSteps(steps, deferSteps));
    loopRows.push({
      type: 'section',
      id: block.id,
      loopId: block.id,
      status: block.status,
      proseText: sectionProse.proseText,
      proseStreaming: sectionProse.proseStreaming,
      thinkingPreview: sectionThinking.preview,
      thinkingLabel: sectionThinking.label,
      thinkingKind: sectionThinking.kind,
      thinkingSource: sectionThinking.source,
      thinkingVisibility: sectionThinking.visibility,
      thinkingStatus: sectionThinking.status,
      thinkingExpandable: sectionThinking.expandable,
      thinkingOpenByDefault: sectionThinking.openByDefault,
      stepCount: deps.countToolSteps(steps),
      stepsDisclosure: deferSteps ? 'deferred' : 'visible',
      duration: formatDurationMs(block.startedAt, block.completedAt),
      defaultOpen: false,
      steps,
      visibleSteps,
      outputPhase,
      stopReason,
    });
  }

  ctx.hasVisibleProcessEvidence = true;

  return {
    kind: 'loop',
    loopId: block.id,
    rows: loopRows,
    hasDisplayableThinking: sectionThinking.expandable && Boolean(sectionThinking.preview),
    hasSummaryThinking: sectionThinking.kind === 'summary' && Boolean(sectionThinking.preview),
  };
}

function dedupeSectionThinking(
  sectionThinking: ReturnType<LoopProjectionDeps['resolveSectionThinking']>,
  ctx: BlockProjectionContext,
  deps: LoopProjectionDeps,
): void {
  if (!sectionThinking.preview || sectionThinking.kind === 'raw') return;
  const thinkingKey = deps.normalizeThinkingDedupKey(sectionThinking.preview);
  if (ctx.visibleThinkingKeys.has(thinkingKey)) {
    sectionThinking.preview = '';
    sectionThinking.label = '';
    sectionThinking.source = '';
    sectionThinking.expandable = false;
    sectionThinking.openByDefault = false;
    return;
  }
  ctx.visibleThinkingKeys.add(thinkingKey);
}

export function markLastSectionOpen(rows: WorkProcessRow[]): void {
  let lastSectionIndex = -1;
  rows.forEach((row, index) => {
    if (row.type === 'section') lastSectionIndex = index;
  });
  if (lastSectionIndex < 0) return;
  const lastSection = rows[lastSectionIndex];
  if (lastSection.type === 'section' && lastSection.status !== 'complete') lastSection.defaultOpen = true;
}

export function presentationUnitsToDetailRows(units: PresentationUnit[]): WorkProcessRow[] {
  const rows = units.flatMap((unit) => unit.kind === 'loop' || unit.kind === 'standalone' ? unit.rows : []);
  markLastSectionOpen(rows);
  return rows;
}
