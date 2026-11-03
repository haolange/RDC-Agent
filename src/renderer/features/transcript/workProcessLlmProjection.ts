import type { ConversationToolCall, ConversationWorkBlock } from '@shared/types/conversation';
import { formatDurationMs, normalizeWorkProcessText } from './workProcessFormat';
import type { LoopPresentationUnit, StandalonePresentationUnit } from './workProcessUnits';
import type { WorkProcessRow } from './workProcessTypes';
import type { BlockProjectionContext, LoopProjectionDeps } from './workProcessBlockProjection';

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
): LoopPresentationUnit | StandalonePresentationUnit | null {
  const outputPhase = deps.resolveOutputPhase(block, ctx.hasVisibleProcessEvidence);
  const reasoningState = deps.resolveReasoningState(block);
  const stopReason = block.result?.stopReason;
  // Successful TaskRegistry mutations already have authoritative snapshots;
  // pending approval and failed mutations still need their own interaction/error.
  const steps = ctx.groupProcessRows(
    block.toolCalls
      .filter((call) => isVisibleToolCall(call) && (!isTaskLifecycleTool(call.toolName)
        || call.status === 'error' || Boolean(call.approval && call.approval.status !== 'approved')))
      .map((call): WorkProcessRow => call.delegation ? {
        type: 'subagent', id: call.id, status: call.status,
        profile: call.delegation.profile, task: call.delegation.task, mode: call.delegation.mode,
        argsPreview: call.argsPreview ?? '', resultPreview: call.resultPreview ?? '',
        executionId: call.delegation.executionId, generation: call.delegation.generation,
        duration: formatDurationMs(call.executionStartedAt, call.completedAt),
      } : ctx.createToolRow(call)),
  );
  const loopRows: WorkProcessRow[] = [];

  const isFinalAnswer = outputPhase === 'final_answer' && !deps.isNonFinalStopReason(stopReason);

  if (isFinalAnswer) {
    // Answer-only turns never create a Reply boundary row. Provider-visible closing
    // thinking folds into a quiet thinking-only section; otherwise the turn is silent
    // and the assistant body below the Work Process is the only final-answer surface.
    // Opaque/hidden reasoning never renders a CoT placeholder — answer body only.
    if (reasoningState === 'opaque' || reasoningState === 'hidden') {
      return null;
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

  // Opaque/hidden never becomes WP thinking or a placeholder; only real tools/prose/visible thinking remain.
  const shouldRenderSection = steps.length > 0
    || Boolean(sectionProse.proseText)
    || sectionThinking.label
    || sectionThinking.expandable;

  if (!shouldRenderSection) {
    return null;
  }

  if (shouldRenderSection) {
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

