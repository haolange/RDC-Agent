import { cancelWorkTrace } from '@shared/conversation/cancelWorkTrace';
import { loopTextItems, loopThinkingItems, presentedTextPhase, sameProviderBlock, settleTextPhase, supersededAnswerLoopIds } from '@shared/conversation/loopItems';
import { nowMs } from '@shared/utils/id';
import { normalizeToolName } from '../agent-runtime/orchestration/RuntimeToolPolicy';
import { normalizeWorkBlockKind, providerOutputRefKey } from './StoredWorkTrace';
import type { ProviderOutputRef, ThinkingArtifact } from '@shared/types/reasoning';
import type {
  ConversationLoopItem,
  ConversationLoopOutputPhase,
  ConversationLoopResult,
  ConversationLoopResultStatus,
  ConversationLoopStopReason,
  ConversationReasoningState,
  ConversationThinkingStatus,
  ConversationToolCall,
  ConversationWorkBlock,
  ConversationWorkTrace,
} from '@shared/types/conversation';

interface LoopTraceOptions {
  loopId?: string;
  loopResultStatus?: ConversationLoopResultStatus;
  loopStopReason?: ConversationLoopStopReason;
  loopOutputPhase?: ConversationLoopOutputPhase;
  loopProviderOutputRefs?: ProviderOutputRef[];
  loopReasoningState?: ConversationReasoningState;
}

/** Loop-level facts a provider event settles; text and thinking arrive as items instead. */
export interface LoopResultPatch {
  status?: ConversationLoopResultStatus;
  stopReason?: ConversationLoopStopReason;
  outputPhase?: ConversationLoopOutputPhase;
  reasoningState?: ConversationReasoningState;
  providerOutputRefs?: ProviderOutputRef[];
}

function createWorkBlock(
  id: string,
  title: string,
  stage?: string,
  kind: ConversationWorkBlock['kind'] = 'reasoning',
): ConversationWorkBlock {
  const block: ConversationWorkBlock = {
    id,
    kind,
    title,
    stage,
    status: 'pending',
    toolCalls: [],
    startedAt: nowMs(),
  };
  if (block.kind === 'llm_turn') {
    block.result = normalizeLoopResult(undefined, block.status, []);
  }
  return block;
}

export function createDraftWorkTrace(summary?: string, blocks: ConversationWorkBlock[] = []): ConversationWorkTrace {
  return {
    status: 'running',
    summary,
    blocks: blocks.map(cloneWorkBlock),
    updatedAt: nowMs(),
  };
}

function cloneToolCall(toolCall: ConversationToolCall): ConversationToolCall {
  return {
    ...toolCall,
    hookDiagnostics: toolCall.hookDiagnostics?.map((diagnostic) => ({ ...diagnostic })),
    providerOutputRef: toolCall.providerOutputRef ? { ...toolCall.providerOutputRef } : undefined,
    userInputQuestions: toolCall.userInputQuestions?.map((question) => ({
      ...question,
      options: question.options.map((option) => ({ ...option })),
    })),
    planReview: toolCall.planReview ? { ...toolCall.planReview, summary: [...toolCall.planReview.summary], sections: toolCall.planReview.sections.map((section) => ({ ...section })), handoffOptions: toolCall.planReview.handoffOptions.map((option) => ({ ...option,
      ...(option.labelTranslations ? { labelTranslations: { ...option.labelTranslations } } : {}),
    })), decision: toolCall.planReview.decision ? { ...toolCall.planReview.decision } : undefined } : undefined,
    resourceRefs: toolCall.resourceRefs?.map((resource) => ({ ...resource })),
    imagePreviews: toolCall.imagePreviews?.map((preview) => ({ ...preview })),
    approval: toolCall.approval ? { ...toolCall.approval } : undefined,
  };
}

function cloneThinkingArtifact(thinking: ThinkingArtifact | undefined): ThinkingArtifact | undefined {
  return thinking
    ? {
        ...thinking,
        continuation: thinking.continuation ? { ...thinking.continuation } : undefined,
      }
    : undefined;
}

function cloneLoopResult(result: ConversationLoopResult | undefined): ConversationLoopResult | undefined {
  return result
    ? {
        ...result,
        providerOutputRefs: result.providerOutputRefs?.map((ref) => ({ ...ref })),
        toolCallIds: result.toolCallIds.slice(),
      }
    : undefined;
}

function cloneLoopItem(item: ConversationLoopItem): ConversationLoopItem {
  return item.kind === 'text'
    ? { ...item, providerOutputRef: { ...item.providerOutputRef } }
    : { ...item, providerOutputRef: { ...item.providerOutputRef }, thinking: cloneThinkingArtifact(item.thinking)! };
}

function cloneWorkBlock(block: ConversationWorkBlock): ConversationWorkBlock {
  const toolCalls = block.toolCalls.map(cloneToolCall);
  const result = block.kind === 'llm_turn'
    ? normalizeLoopResult(block.result, block.status, toolCalls)
    : cloneLoopResult(block.result);
  return {
    ...block,
    ...(result ? { result } : {}),
    ...(block.items ? { items: block.items.map(cloneLoopItem) } : {}),
    toolCalls,
  };
}

function ensureLoopBlock(trace: ConversationWorkTrace, loopId: string): ConversationWorkBlock {
  let block = writableBlock(trace, (entry) => entry.id === loopId);
  if (!block) {
    block = createWorkBlock(loopId, 'LLM turn', 'model', 'llm_turn');
    block.status = 'running';
    trace.blocks.push(block);
    demoteSupersededAnswers(trace);
  }
  return block;
}

/** A new loop means the previous answer did not end the turn; its text is recorded as commentary. */
function demoteSupersededAnswers(trace: ConversationWorkTrace): void {
  for (const loopId of supersededAnswerLoopIds(trace.blocks)) {
    const loop = writableBlock(trace, (entry) => entry.id === loopId)!;
    loop.result = { ...loop.result!, outputPhase: 'commentary' };
    for (const item of loop.items ?? []) if (item.kind === 'text') item.phase = presentedTextPhase(item.phase, true);
  }
}

/** Text of one provider block. It keeps the position it first appeared at, whatever arrives later. */
export function upsertLoopTextItem(
  trace: ConversationWorkTrace | null | undefined,
  loopId: string,
  ref: ProviderOutputRef,
  text: string,
  phase: ConversationLoopOutputPhase | undefined,
  status: 'streaming' | 'complete',
): ConversationWorkTrace {
  const nextTrace = cloneTrace(trace);
  if (nextTrace.status === 'stopped') return nextTrace;
  const block = ensureLoopBlock(nextTrace, loopId);
  const items = block.items ?? [];
  const existing = items.find((item) => item.kind === 'text' && providerOutputRefKey(item.providerOutputRef) === providerOutputRefKey(ref));
  if (existing?.kind === 'text') {
    existing.text = text;
    existing.phase = phase ?? existing.phase;
    existing.status = status;
  } else {
    items.push({ kind: 'text', providerOutputRef: { ...ref }, text, phase, status, displayOrder: nextDisplayOrder(nextTrace) });
  }
  block.items = items;
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}

/**
 * One provider thinking block. Each block is its own item, so a loop that thinks, calls a tool and thinks
 * again keeps both passages in place instead of the last one overwriting the first.
 */
export function upsertLoopThinkingItem(
  trace: ConversationWorkTrace | null | undefined,
  loopId: string,
  ref: ProviderOutputRef,
  thinking: ThinkingArtifact,
  status: ConversationThinkingStatus,
): ConversationWorkTrace {
  const nextTrace = cloneTrace(trace);
  if (nextTrace.status === 'stopped') return nextTrace;
  const block = ensureLoopBlock(nextTrace, loopId);
  const items = block.items ?? [];
  const existing = items.find((item) => item.kind === 'thinking' && providerOutputRefKey(item.providerOutputRef) === providerOutputRefKey(ref));
  const now = nowMs();
  const visible = Boolean(thinking.text?.trim());
  // Text that first shows up already complete (a whole summary) was thought out while the loop waited for it,
  // so it is timed from the loop's start rather than reading as an instant.
  const visibleSince = status === 'complete' ? block.startedAt ?? now : now;
  if (existing?.kind === 'thinking') {
    if (shouldReplaceThinking(existing.thinking, thinking)) existing.thinking = cloneThinkingArtifact(thinking)!;
    if (existing.startedAt === undefined && visible) existing.startedAt = visibleSince;
    if (status === 'complete' && existing.status !== 'complete' && existing.startedAt !== undefined) existing.completedAt = now;
    existing.status = status;
  } else {
    items.push({
      kind: 'thinking', providerOutputRef: { ...ref }, thinking: cloneThinkingArtifact(thinking)!, status,
      displayOrder: nextDisplayOrder(nextTrace),
      ...(visible ? { startedAt: visibleSince } : {}),
      ...(visible && status === 'complete' ? { completedAt: now } : {}),
    });
  }
  block.items = items;
  if (block.status !== 'running') {
    block.status = 'running';
    delete block.completedAt;
  }
  nextTrace.status = 'running';
  nextTrace.updatedAt = now;
  return nextTrace;
}

/**
 * A new trace that shares every block with the old one. Updates copy only the block they change
 * (writableBlock), so a streaming delta costs one block, not the whole trace, and earlier snapshots
 * handed to the renderer or the store never change underneath them.
 */
function cloneTrace(trace: ConversationWorkTrace | null | undefined): ConversationWorkTrace {
  return trace
    ? {
        ...trace,
        toolEvidence: trace.toolEvidence ? { ...trace.toolEvidence } : undefined,
        blocks: trace.blocks.slice(),
      }
    : {
        status: 'idle',
        blocks: [],
        updatedAt: nowMs(),
      };
}

/** Copies the first matching block into the (already copied) blocks array and returns the copy to edit. */
function writableBlock(
  trace: ConversationWorkTrace,
  matches: (block: ConversationWorkBlock) => boolean,
): ConversationWorkBlock | undefined {
  const index = trace.blocks.findIndex(matches);
  if (index < 0) return undefined;
  const copy = cloneWorkBlock(trace.blocks[index]!);
  trace.blocks[index] = copy;
  return copy;
}

function nextDisplayOrder(trace: ConversationWorkTrace): number {
  return trace.blocks.reduce((highest, block) => {
    const withBlock = Math.max(highest, block.displayOrder ?? 0);
    const withTools = block.toolCalls.reduce((value, call) => Math.max(value, call.displayOrder ?? 0), withBlock);
    return (block.items ?? []).reduce((value, item) => Math.max(value, item.displayOrder), withTools);
  }, 0) + 1;
}

export function upsertWorkBlock(
  trace: ConversationWorkTrace | null | undefined,
  blockId: string,
  patch: Partial<ConversationWorkBlock>,
): ConversationWorkTrace {
  const nextTrace = cloneTrace(trace);
  const blockIndex = nextTrace.blocks.findIndex((block) => block.id === blockId);
  if (blockIndex >= 0) {
    nextTrace.blocks[blockIndex] = cloneWorkBlock({
      ...nextTrace.blocks[blockIndex],
      ...patch,
      toolCalls: patch.toolCalls
        ? patch.toolCalls.map(cloneToolCall)
        : nextTrace.blocks[blockIndex].toolCalls.map(cloneToolCall),
    });
  } else {
    const kind = patch.kind && normalizeWorkBlockKind(patch.kind) ? patch.kind : 'reasoning';
    nextTrace.blocks.push(cloneWorkBlock({
      ...createWorkBlock(blockId, patch.title || blockId, patch.stage, kind),
      ...patch,
      ...(kind === 'task_snapshot' ? { displayOrder: patch.displayOrder ?? nextDisplayOrder(nextTrace) } : {}),
      kind,
      toolCalls: patch.toolCalls ? patch.toolCalls.map(cloneToolCall) : [],
    }));
  }
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}

export function finalizeTrace(
  trace: ConversationWorkTrace | null | undefined,
  status: ConversationWorkTrace['status'],
  summary?: string,
  terminalAt = nowMs(),
): ConversationWorkTrace {
  const nextTrace = cloneTrace(trace);
  if (status === 'stopped') return cancelWorkTrace(nextTrace, terminalAt);
  const terminalBlockStatus: ConversationWorkBlock['status'] | null =
    status === 'complete'
      ? 'complete'
      : status === 'error'
        ? 'error'
        : null;

  if (terminalBlockStatus) {
    nextTrace.blocks = nextTrace.blocks.map((block) => {
      const isTaskLifecycleBlock = block.stage === 'task';
      const blockStatus = !isTaskLifecycleBlock && (block.status === 'pending' || block.status === 'running')
        ? terminalBlockStatus
        : block.status;
      const blockCompletedAt = isTaskLifecycleBlock
        ? block.completedAt
        : block.completedAt ?? terminalAt;
      const toolCalls = block.toolCalls.map((toolCall) => {
        const cloned = cloneToolCall(toolCall);
        if (status === 'error' && cloned.planReview?.status === 'awaiting') {
          cloned.planReview = { ...cloned.planReview, status: 'cancelled' };
        }
        if (toolCall.status !== 'pending' && toolCall.status !== 'running') {
          return cloned;
        }
        const terminalToolStatus: ConversationToolCall['status'] = toolCall.status === 'pending'
          ? 'skipped'
          : 'error';
        return {
          ...cloned,
          status: terminalToolStatus,
          completedAt: toolCall.completedAt ?? terminalAt,
          resultPreview: terminalToolStatus === 'skipped'
            ? (toolCall.resultPreview ?? (status === 'complete'
                ? 'Run completed before this tool call executed.'
                : 'Run ended before this tool call executed.'))
            : toolCall.resultPreview,
          error: terminalToolStatus === 'error'
            ? (toolCall.error ?? 'Run ended before this tool call completed.')
            : toolCall.error,
        };
      });
      const result = block.kind === 'llm_turn'
        ? {
            ...ensureLoopResult({ ...block, toolCalls }),
            status: 'complete' as const,
            toolCallIds: uniqueStrings([...(block.result?.toolCallIds ?? []), ...toolCalls.map((toolCall) => toolCall.id)]),
          }
        : block.result;
      return {
        ...block,
        status: blockStatus,
        completedAt: blockCompletedAt,
        ...(result ? { result } : {}),
        ...(block.items ? { items: block.items.map((item) => ({ ...cloneLoopItem(item), status: 'complete' as const })) } : {}),
        toolCalls,
      };
    });
  }

  nextTrace.status = status;
  nextTrace.summary = summary ?? nextTrace.summary;
  nextTrace.updatedAt = terminalAt;
  return nextTrace;
}

export function upsertRuntimeToolCall(
  trace: ConversationWorkTrace | null | undefined,
  patch: Partial<ConversationToolCall> & { id: string; toolName: string },
  options?: LoopTraceOptions,
): ConversationWorkTrace {
  const nextTrace = cloneTrace(trace);
  if (nextTrace.status === 'stopped') return nextTrace;
  const blockMeta = getRuntimeToolBlockMeta(patch.toolName, patch.id, options?.loopId);
  const blockId = blockMeta.id;
  if (options?.loopId && (blockMeta.kind === 'user_input' || blockMeta.kind === 'plan_review')
    && !nextTrace.blocks.some((entry) => entry.id === options.loopId)) {
    const owner = createWorkBlock(options.loopId, 'LLM turn', 'model', 'llm_turn');
    owner.status = 'running';
    nextTrace.blocks.push(owner);
  }
  const existingBlock = writableBlock(nextTrace, (entry) => (
    entry.toolCalls.some((toolCall) => toolCall.id === patch.id)
  ));
  let block = existingBlock ?? writableBlock(nextTrace, (entry) => entry.id === blockId);
  if (!block) {
    block = createWorkBlock(blockId, blockMeta.title, blockMeta.stage, blockMeta.kind);
    block.status = 'running';
    nextTrace.blocks.push(block);
  }
  if (options?.loopId && (block.kind === 'user_input' || block.kind === 'plan_review')) {
    block.parentLoopId ??= options.loopId;
  }
  if (options?.loopId && blockId === options.loopId) {
    applyLoopFields(block, options);
  }
  const toolIndex = block.toolCalls.findIndex((toolCall) => toolCall.id === patch.id);
  const becomesVisible = Boolean(patch.approval || patch.planReview || patch.userInputQuestions
    || patch.executionStartedAt !== undefined || patch.status === 'running' || patch.status === 'complete' || patch.status === 'error');
  if (toolIndex >= 0) {
    const existingToolCall = block.toolCalls[toolIndex];
    const nextApproval = patch.approval
      ? existingToolCall.approval?.approvalId === patch.approval.approvalId
        ? { ...existingToolCall.approval, ...patch.approval }
        : { ...patch.approval }
      : existingToolCall.approval ? { ...existingToolCall.approval } : undefined;
    block.toolCalls[toolIndex] = {
      ...existingToolCall,
      ...patch,
      displayOrder: existingToolCall.displayOrder ?? (becomesVisible ? nextDisplayOrder(nextTrace) : undefined),
      executionStartedAt: existingToolCall.executionStartedAt ?? patch.executionStartedAt,
      status: existingToolCall.completedAt || (existingToolCall.executionStartedAt && patch.status === 'pending')
        ? existingToolCall.status : patch.status ?? existingToolCall.status,
      userInputQuestions: patch.userInputQuestions
        ? patch.userInputQuestions.map((question) => ({
            ...question,
            options: question.options.map((option) => ({ ...option })),
          }))
        : existingToolCall.userInputQuestions,
      planReview: patch.planReview ?? existingToolCall.planReview,
      resourceRefs: patch.resourceRefs
        ? patch.resourceRefs.map((resource) => ({ ...resource }))
        : existingToolCall.resourceRefs?.map((resource) => ({ ...resource })),
      hookDiagnostics: patch.hookDiagnostics
        ? patch.hookDiagnostics.map((diagnostic) => ({ ...diagnostic }))
        : existingToolCall.hookDiagnostics?.map((diagnostic) => ({ ...diagnostic })),
      approval: nextApproval,
    };
  } else {
    block.toolCalls.push({
      id: patch.id,
      toolName: patch.toolName,
      delegatedRequest: patch.delegatedRequest,
      status: patch.status ?? 'pending',
      providerOutputRef: patch.providerOutputRef ? { ...patch.providerOutputRef } : undefined,
      userInputQuestions: patch.userInputQuestions?.map((question) => ({
        ...question,
        options: question.options.map((option) => ({ ...option })),
      })),
      planReview: patch.planReview,
      argsPreview: patch.argsPreview,
      resultPreview: patch.resultPreview,
      resourceRefs: patch.resourceRefs?.map((resource) => ({ ...resource })),
      imagePreviews: patch.imagePreviews?.map((preview) => ({ ...preview })),
      hookDiagnostics: patch.hookDiagnostics?.map((diagnostic) => ({ ...diagnostic })),
      error: patch.error,
      approval: patch.approval ? { ...patch.approval } : undefined,
      executionStartedAt: patch.executionStartedAt,
      displayOrder: becomesVisible ? nextDisplayOrder(nextTrace) : undefined,
      startedAt: patch.startedAt ?? nowMs(),
      completedAt: patch.completedAt,
    });
  }
  syncLoopResultToolIds(block);
  if (block.toolCalls.length > 0 && block.toolCalls.every((toolCall) => (
    toolCall.status === 'complete' || toolCall.status === 'error' || toolCall.status === 'skipped' || toolCall.status === 'cancelled'
  ))) {
    block.status = block.toolCalls.some((toolCall) => toolCall.status === 'error') ? 'error'
      : block.toolCalls.some((toolCall) => toolCall.status === 'cancelled') ? 'cancelled' : 'complete';
    block.completedAt ??= nowMs();
    if (block.kind === 'llm_turn') {
      block.result = { ...ensureLoopResult(block), status: 'complete' };
    }
  }
  nextTrace.status = 'running';
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}

/** Associate a runtime Hook with its exact tool call; never infer ownership from row order. */
export function attachRuntimeHookDiagnostic(
  trace: ConversationWorkTrace | null | undefined,
  toolCallId: string,
  diagnostic: NonNullable<ConversationToolCall['hookDiagnostics']>[number],
): ConversationWorkTrace | null {
  if (!toolCallId) return null;
  const nextTrace = cloneTrace(trace);
  const block = writableBlock(nextTrace, (entry) => entry.toolCalls.some((call) => call.id === toolCallId));
  const call = block?.toolCalls.find((entry) => entry.id === toolCallId);
  if (!call) return null;
  if (!call.hookDiagnostics?.some((entry) => entry.id === diagnostic.id)) {
    call.hookDiagnostics = [...(call.hookDiagnostics ?? []), { ...diagnostic }];
    nextTrace.updatedAt = nowMs();
  }
  return nextTrace;
}

export function supersedePreviousPlanReviews(
  trace: ConversationWorkTrace | null | undefined,
  currentToolCallId: string,
): ConversationWorkTrace {
  const nextTrace = cloneTrace(trace);
  const supersedes = (toolCall: ConversationToolCall) => toolCall.id !== currentToolCallId
    && toolCall.toolName === 'plan_artifact' && toolCall.planReview?.status === 'awaiting';
  nextTrace.blocks = nextTrace.blocks.map((original) => {
    if (!original.toolCalls.some(supersedes)) return original;
    const block = cloneWorkBlock(original);
    for (const [index, toolCall] of block.toolCalls.entries()) {
      if (!supersedes(toolCall) || !toolCall.planReview) continue;
      block.toolCalls[index] = {
        ...toolCall,
        planReview: {
          ...toolCall.planReview,
          status: 'superseded',
        },
      };
    }
    return block;
  });
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}

export function upsertRuntimeToolApproval(
  trace: ConversationWorkTrace | null | undefined,
  input: {
    approvalId: string;
    toolCallId: string;
    toolName: string;
    status: string;
    reason?: string;
    risk?: unknown;
    reviewer?: unknown;
    reviewMethod?: unknown;
    errorCode?: unknown;
    answer?: unknown;
  },
  options?: LoopTraceOptions,
): ConversationWorkTrace {
  const status = normalizeToolApprovalStatus(input.status);
  const failed = status === 'rejected';
  const superseded = status === 'cancelled' && input.errorCode === 'PERMISSION_MODE_CHANGED';
  const toolCancelled = status === 'cancelled' && !superseded;
  const existingToolCall = trace?.blocks
    .flatMap((block) => block.toolCalls)
    .find((toolCall) => toolCall.id === input.toolCallId);
  const settled = existingToolCall && existingToolCall.status !== 'pending' && existingToolCall.status !== 'running';
  const now = nowMs();
  const approval: NonNullable<ConversationToolCall['approval']> = {
    approvalId: input.approvalId,
    status,
  };
  if (input.reason) approval.reason = input.reason;
  const risk = stringifyApprovalField(input.risk);
  if (risk) approval.risk = risk as NonNullable<ConversationToolCall['approval']>['risk'];
  const reviewer = stringifyApprovalField(input.reviewer);
  if (reviewer) approval.reviewer = reviewer as NonNullable<ConversationToolCall['approval']>['reviewer'];
  if (input.reviewMethod === 'rule' || input.reviewMethod === 'model') approval.reviewMethod = input.reviewMethod;
  if (typeof input.errorCode === 'string' && input.errorCode) approval.errorCode = input.errorCode;
  const answer = stringifyApprovalField(input.answer);
  if (answer) approval.answer = answer;
  if (status === 'pending') approval.requestedAt = now;
  if (status !== 'pending') approval.resolvedAt = now;

  const toolPatch: Partial<ConversationToolCall> & { id: string; toolName: string } = {
    id: input.toolCallId,
    toolName: input.toolName,
    status: settled || superseded ? existingToolCall?.status ?? 'pending' : toolCancelled ? 'cancelled' : failed
      ? 'error'
      : existingToolCall?.status === 'complete'
        ? 'complete'
        : existingToolCall?.executionStartedAt !== undefined ? 'running' : 'pending',
    approval,
  };
  if (toolCancelled && !settled) toolPatch.completedAt = existingToolCall?.completedAt ?? now;
  if (failed && !settled) {
    toolPatch.error = answer || input.reason || 'Tool approval was denied.';
    toolPatch.completedAt = now;
  }

  return upsertRuntimeToolCall(trace, toolPatch, options);
}

function normalizeToolApprovalStatus(status: string): NonNullable<ConversationToolCall['approval']>['status'] {
  if (status === 'approved') return 'approved';
  if (status === 'rejected') return 'rejected';
  if (status === 'cancelled') return 'cancelled';
  return 'pending';
}

function stringifyApprovalField(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value.trim() : String(value).trim();
}

function applyLoopFields(block: ConversationWorkBlock, options: LoopTraceOptions): void {
  if (block.kind === 'llm_turn') {
    const result = ensureLoopResult(block);
    if (options.loopResultStatus) {
      result.status = options.loopResultStatus;
      // Text resuming on a settled loop without a declared phase drops the stale commentary/final
      // marker, so earlier settlement cannot flash new text as an answer.
      if (options.loopResultStatus === 'streaming' && !options.loopOutputPhase) {
        delete result.outputPhase;
        delete result.stopReason;
      }
    }
    if (options.loopStopReason) {
      result.stopReason = options.loopStopReason;
    }
    if (options.loopOutputPhase) {
      result.outputPhase = options.loopOutputPhase;
    }
    if (options.loopProviderOutputRefs) {
      result.providerOutputRefs = uniqueProviderOutputRefs([
        ...(result.providerOutputRefs ?? []),
        ...options.loopProviderOutputRefs,
      ]);
    }
    block.result = result;
  }
  if (options.loopReasoningState) {
    block.reasoningState = options.loopReasoningState;
  }
}

/**
 * A provider attempt that fails mid-stream is retried from the start. Its partial text and thinking, and
 * tool calls it declared but never started, are dropped so the retry does not show them twice.
 * A loop that already settled is not part of the retried attempt and stays as it is.
 */
export function discardLoopAttempt(trace: ConversationWorkTrace | null | undefined, loopId: string): ConversationWorkTrace {
  const nextTrace = cloneTrace(trace);
  const current = nextTrace.blocks.find((entry) => entry.id === loopId && entry.kind === 'llm_turn');
  if (!current || nextTrace.status === 'stopped' || current.result?.status === 'complete') return nextTrace;
  const block = writableBlock(nextTrace, (entry) => entry === current)!;
  delete block.items;
  block.toolCalls = block.toolCalls.filter((call) => call.status !== 'pending' || call.executionStartedAt !== undefined);
  block.result = normalizeLoopResult({ status: 'streaming', toolCallIds: [] }, 'running', block.toolCalls);
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}

/**
 * Settles a loop's items when the provider completes it: each text block gets its phase from the one
 * shared rule, and every thinking block takes its final content (signatures arrive at the end).
 */
export function settleLoopItems(
  trace: ConversationWorkTrace,
  loopId: string,
  loop: { stopReason?: ConversationLoopStopReason; outputPhase?: ConversationLoopOutputPhase },
  completed: {
    textItems?: Array<{ text: string; phase?: ConversationLoopOutputPhase; providerOutputRef: ProviderOutputRef }>;
    thinking?: ThinkingArtifact[];
  } = {},
): ConversationWorkTrace {
  let next = trace;
  const block = next.blocks.find((entry) => entry.id === loopId);
  const existingText = loopTextItems(block);
  for (const item of completed.textItems ?? existingText) {
    const prior = existingText.find((candidate) => sameProviderBlock(candidate.providerOutputRef, item.providerOutputRef));
    next = upsertLoopTextItem(next, loopId, item.providerOutputRef, item.text,
      settleTextPhase(item.phase ?? prior?.phase, loop), 'complete');
  }
  const completedThinking = (completed.thinking ?? []).filter((artifact) => artifact.providerOutputRef);
  for (const artifact of completedThinking) {
    next = upsertLoopThinkingItem(next, loopId, artifact.providerOutputRef!, artifact, 'complete');
  }
  for (const item of loopThinkingItems(next.blocks.find((entry) => entry.id === loopId))) {
    if (item.status !== 'complete') next = upsertLoopThinkingItem(next, loopId, item.providerOutputRef, item.thinking, 'complete');
  }
  return next;
}

export function upsertLoopResult(
  trace: ConversationWorkTrace | null | undefined,
  loopId: string,
  patch: LoopResultPatch = {},
): ConversationWorkTrace {
  const nextTrace = cloneTrace(trace);
  if (nextTrace.status === 'stopped') return nextTrace;
  const block = ensureLoopBlock(nextTrace, loopId);
  const resultStatus = patch.status ?? 'streaming';
  applyLoopFields(block, {
    loopId,
    loopResultStatus: resultStatus,
    loopStopReason: patch.stopReason,
    loopOutputPhase: patch.outputPhase,
    loopProviderOutputRefs: patch.providerOutputRefs,
    loopReasoningState: patch.reasoningState,
  });
  const hasActiveTools = block.toolCalls.some((call) => call.status === 'pending' || call.status === 'running');
  if (resultStatus === 'streaming' || hasActiveTools) {
    block.status = 'running';
    delete block.completedAt;
  } else {
    block.status = block.toolCalls.some((call) => call.status === 'error') ? 'error'
      : block.toolCalls.some((call) => call.status === 'cancelled') ? 'cancelled' : 'complete';
    block.completedAt ??= nowMs();
  }
  nextTrace.status = 'running';
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}

function ensureLoopResult(block: ConversationWorkBlock): ConversationLoopResult {
  const status: ConversationLoopResultStatus = block.status === 'running' || block.status === 'pending' ? 'streaming' : 'complete';
  const result = normalizeLoopResult(block.result, status, block.toolCalls);
  block.result = result;
  return result;
}

function normalizeLoopResult(
  result: ConversationLoopResult | undefined,
  blockStatus: ConversationWorkBlock['status'] | ConversationLoopResultStatus,
  toolCalls: ConversationToolCall[],
): ConversationLoopResult {
  const status: ConversationLoopResultStatus = result?.status
    ?? (blockStatus === 'running' || blockStatus === 'pending' || blockStatus === 'streaming' ? 'streaming' : 'complete');
  return {
    ...(result?.stopReason ? { stopReason: result.stopReason } : {}),
    ...(result?.outputPhase ? { outputPhase: result.outputPhase } : {}),
    ...(result?.providerOutputRefs?.length
      ? { providerOutputRefs: uniqueProviderOutputRefs(result.providerOutputRefs) }
      : {}),
    status,
    toolCallIds: uniqueStrings([...(result?.toolCallIds ?? []), ...toolCalls.map((toolCall) => toolCall.id)]),
  };
}

function syncLoopResultToolIds(block: ConversationWorkBlock): void {
  if (block.kind !== 'llm_turn') return;
  const result = ensureLoopResult(block);
  result.toolCallIds = uniqueStrings([...result.toolCallIds, ...block.toolCalls.map((toolCall) => toolCall.id)]);
  block.result = result;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueProviderOutputRefs(refs: ProviderOutputRef[]): ProviderOutputRef[] {
  const seen = new Set<string>();
  const unique: ProviderOutputRef[] = [];
  for (const ref of refs) {
    const key = [
      ref.protocol,
      ref.responseId ?? '',
      ref.providerBlockKey,
      ref.sourceIndex ?? '',
      ref.itemId ?? '',
      ref.contentIndex,
    ].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...ref });
  }
  return unique;
}

function shouldReplaceThinking(current: ThinkingArtifact | undefined, next: ThinkingArtifact): boolean {
  if (!current) return true;
  if (next.continuation && !current.continuation) return true;
  if (next.continuation && JSON.stringify(next.continuation) !== JSON.stringify(current.continuation)) return true;
  return (next.text?.length ?? 0) >= (current.text?.length ?? 0);
}

function getRuntimeToolBlockMeta(
  toolName: string,
  toolCallId: string,
  loopId?: string,
): Pick<ConversationWorkBlock, 'id' | 'title' | 'stage' | 'kind'> {
  const normalizedToolName = normalizeToolName(toolName);
  if (normalizedToolName === 'ask_user') {
    return {
      id: `runtime-user-input-${toolCallId}`,
      title: 'User input requested',
      stage: 'decision',
      kind: 'user_input',
    };
  }
  if (normalizedToolName === 'plan_artifact') {
    return {
      id: `runtime-plan-review-${toolCallId}`,
      title: 'Plan review requested',
      stage: 'decision',
      kind: 'plan_review',
    };
  }
  if (normalizedToolName === 'agent_handoff') {
    return {
      id: 'runtime-handoff',
      title: 'Preparing handoff',
      stage: 'handoff',
      kind: 'handoff',
    };
  }
  return {
    id: loopId ?? 'runtime-llm-turn',
    title: 'LLM turn',
    stage: 'model',
    kind: 'llm_turn',
  };
}
