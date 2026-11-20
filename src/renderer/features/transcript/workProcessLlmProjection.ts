import { loopTextItems, loopThinkingItems } from '@shared/conversation/loopItems';
import { formatDurationMs } from './workProcessFormat';
import type { ConversationToolCall, ConversationWorkBlock } from '@shared/types/conversation';
import type { LoopPresentationUnit, StandalonePresentationUnit } from './workProcessUnits';
import type { WorkProcessRow } from './workProcessTypes';
import type { BlockProjectionContext, LoopProjectionDeps, ThinkingItemPresentation } from './workProcessBlockProjection';

export function isVisibleToolCall(call: ConversationToolCall): boolean {
  if (call.approval || call.planReview || call.userInputQuestions) return true;
  return call.status === 'error' || call.status === 'running' || call.status === 'complete'
    || call.executionStartedAt !== undefined;
}

const isTaskLifecycleTool = (toolName: string): boolean => /^task_(?:create|update|get|list|stop)$/u.test(toolName.trim());

export function projectLlmTurn(
  block: ConversationWorkBlock,
  deps: LoopProjectionDeps,
  ctx: BlockProjectionContext,
  snapshots: ConversationWorkBlock[] = [],
  interactions: ConversationWorkBlock[] = [],
): LoopPresentationUnit | StandalonePresentationUnit | null {
  const outputPhase = deps.resolveOutputPhase(block, ctx.hasVisibleProcessEvidence);
  const reasoningState = deps.resolveReasoningState(block);
  const stopReason = block.result?.stopReason;
  // Successful TaskRegistry mutations already have authoritative snapshots;
  // pending approval and failed mutations still need their own interaction/error.
  const orderedSteps = [
    ...block.toolCalls
      .filter((call) => isVisibleToolCall(call) && (!isTaskLifecycleTool(call.toolName)
        || call.status === 'error' || Boolean(call.approval && call.approval.status !== 'approved')))
      .map((call) => ({ order: call.displayOrder, time: call.executionStartedAt ?? call.approval?.requestedAt ?? call.startedAt,
        row: call.delegation ? {
        type: 'subagent', id: call.id, status: call.status,
        profile: call.delegation.profile, task: call.delegation.task, mode: call.delegation.mode,
        argsPreview: call.argsPreview ?? '', resultPreview: call.resultPreview ?? '',
        executionId: call.delegation.executionId, generation: call.delegation.generation,
        duration: formatDurationMs(call.executionStartedAt, call.completedAt),
      } as WorkProcessRow : ctx.createToolRow(call) })),
    ...snapshots.filter((snapshot) => snapshot.taskSnapshot).map((snapshot) => ({
      order: snapshot.displayOrder, time: snapshot.startedAt,
      row: { type: 'taskSnapshot', id: snapshot.id, status: snapshot.status,
        change: snapshot.taskSnapshot!.change, completed: snapshot.taskSnapshot!.completed,
        total: snapshot.taskSnapshot!.total, items: snapshot.taskSnapshot!.items,
        duration: formatDurationMs(snapshot.startedAt, snapshot.completedAt) } as WorkProcessRow,
    })),
    ...interactions.flatMap((interaction) => interaction.toolCalls.filter(isVisibleToolCall).map((call) => ({
      order: call.displayOrder, time: call.executionStartedAt ?? call.approval?.requestedAt ?? call.startedAt,
      row: ctx.createToolRow(call),
    }))),
    ...loopTextItems(block).map((item) => ({
      order: item.displayOrder, time: block.startedAt,
      row: { type: 'output', id: `${block.id}:output:${item.providerOutputRef.contentIndex}`,
        status: item.status === 'streaming' ? 'running' : 'complete', text: item.text, phase: item.phase, duration: '' } as WorkProcessRow,
    })),
  ];
  // Each visible thinking block is its own row at the position it first streamed in.
  const thinkingRows = loopThinkingItems(block).flatMap((item) => {
    const presented = deps.resolveThinkingItem(block, item);
    if (!presented || isDuplicateThinking(presented, ctx, deps)) return [];
    return [{
      order: item.displayOrder,
      time: block.startedAt,
      row: { type: 'thinking', id: `${block.id}:thinking:${item.providerOutputRef.providerBlockKey}:${item.providerOutputRef.contentIndex}`,
        duration: '', status: presented.status === 'streaming' ? 'running' : 'complete',
        preview: presented.preview, label: presented.label, kind: presented.kind, source: '',
        visibility: presented.visibility, thinkingStatus: presented.status, expandable: true,
        openByDefault: presented.openByDefault } as WorkProcessRow,
      presented,
    }];
  });
  const loopRows: WorkProcessRow[] = [];
  const isFinalAnswer = outputPhase === 'final_answer' && !deps.isNonFinalStopReason(stopReason);
  // An answer-only loop with nothing else to show leaves the answer body as its only surface.
  if (isFinalAnswer && orderedSteps.length === 0 && thinkingRows.length === 0) return null;
  if ((reasoningState === 'opaque' || reasoningState === 'hidden') && orderedSteps.length === 0) return null;

  const hasDisplayableThinking = thinkingRows.length > 0;
  const hasSummaryThinking = thinkingRows.some((entry) => entry.presented.kind === 'summary');
  // Order is the shared display sequence only; every entry carries one.
  const ordered = [...orderedSteps, ...thinkingRows.map(({ order, time, row }) => ({ order, time, row }))]
    .sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER));
  const steps = ctx.groupProcessRows(ordered.map((entry) => entry.row));
  const shouldRenderSection = steps.length > 0;

  if (!shouldRenderSection) {
    return null;
  }

  if (shouldRenderSection) {
    loopRows.push({
      type: 'section',
      id: block.id,
      loopId: block.id,
      status: block.status,
      hasActiveTools: block.toolCalls.some((call) => isTaskLifecycleTool(call.toolName) && call.status === 'running'
        && call.executionStartedAt !== undefined && (!call.approval || call.approval.status === 'approved')),
      stepCount: deps.countToolSteps(steps),
      duration: formatDurationMs(block.startedAt, block.completedAt),
      defaultOpen: false,
      steps,
      visibleSteps: steps,
      outputPhase,
      stopReason,
    });
  }

  ctx.hasVisibleProcessEvidence = true;

  return {
    kind: 'loop',
    loopId: block.id,
    rows: loopRows,
    hasDisplayableThinking,
    hasSummaryThinking,
  };
}

/** Summaries repeated verbatim across loops show once; raw thinking is never collapsed this way. */
function isDuplicateThinking(
  presented: ThinkingItemPresentation,
  ctx: BlockProjectionContext,
  deps: LoopProjectionDeps,
): boolean {
  if (presented.kind === 'raw') return false;
  const key = deps.normalizeThinkingDedupKey(presented.preview);
  if (ctx.visibleThinkingKeys.has(key)) return true;
  ctx.visibleThinkingKeys.add(key);
  return false;
}
