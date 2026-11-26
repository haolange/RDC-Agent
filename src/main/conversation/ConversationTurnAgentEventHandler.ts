import { assertNever } from '@shared/utils/assertNever';
import { rootScopeId } from '@shared/utils/executionScope';
import { isAutomaticToolApproval } from '@shared/utils/toolApproval';
import { nowMs } from '@shared/utils/id';
import { buildToolResultPreview } from '@shared/utils/toolResultPreview';
import { normalizeAskUserQuestions } from '@shared/utils/askUser';
import {
  resolveConversationLoopOutputPhase,
  resolveConversationReasoningState,
  type ConversationLoopContinuationState,
} from '@shared/conversation/loopOutputPhase';
import { lastLoopThinking, sameProviderBlock } from '@shared/conversation/loopItems';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { redactCredentialLikeText, redactedArgumentsPreview } from '../runtime/secretRedaction';
import { normalizeToolName } from '../agent-runtime/orchestration/RuntimeToolPolicy';
import { shouldProjectDiagnosticToWorkProcess } from '../agent-runtime/workTrace/workProcessDiagnosticPolicy';
import {
  attachRuntimeHookDiagnostic,
  upsertRuntimeToolApproval,
  upsertRuntimeToolCall,
  upsertLoopResult,
  discardLoopAttempt,
  settleLoopItems,
  upsertLoopTextItem,
  upsertLoopThinkingItem,
  upsertWorkBlock,
} from '../agent-runtime/workTrace/ConversationWorkTrace';
import { delegationTraceStore } from '../agent-runtime/workTrace/DelegationTraceStore';
import { normalizeTaskSnapshotItems } from '../agent-runtime/workTrace/ConversationTaskSnapshot';
import { mergeThinkingPayload } from '../agent-runtime/workTrace/ConversationThinkingArtifacts';
import { isActiveRun, isLoopTool, summarizeRuntimePayload } from './ConversationRoutePreflight';
import {
  applyPlanReviewAnswered,
  applyPlanReviewRequested,
  isPlanReviewApprovalPayload,
} from './ConversationPlanReviewEvents';
import { buildConversationToolCompletion } from './ConversationToolCompletion';
import type { ProviderOutputRef } from '@shared/types/reasoning';
import type {
  ConversationLoopOutputPhase,
  ConversationMessage,
  ConversationWorkTrace,
} from '@shared/types/conversation';
import type { AgentEvent, AgentEventOf } from '@shared/types/agentRuntime';
import type { ConversationTurnOutput, CompleteProfileTurnInput } from './ConversationTurnRunner';

/** The streaming state of the turn's current loop that the event phases read and advance. */
export interface TurnStreamState {
  currentLoopText: string;
  currentLoopProviderOutputRefs: ProviderOutputRef[];
  loopHasTools: boolean;
  runWasCancelled: boolean;
  pendingNewLoop: boolean;
  currentLoopOutputPhase: ConversationLoopOutputPhase | undefined;
  assistantMessage: ConversationMessage;
}

/** The conversation turn the agent events update (ConversationTurnCompletion implements it). */
export interface AgentEventTurn {
  readonly host: Pick<
    ConversationTurnOutput,
    'emitConversationEvent' | 'persistConversationSnapshot' | 'publishConversationTrace'
  >;
  readonly sessionId: string | null;
  readonly input: Pick<CompleteProfileTurnInput, 'userMessage' | 'context' | 'preparedTurn'>;
  readonly agentLabel: string;
  readonly turnStreamState: TurnStreamState;
  readonly seenCompactionSummaries: Set<string>;
  readonly pendingContinuation: ConversationLoopContinuationState;
  readonly commitAssistantMessage: (
    type: import('@shared/conversation/messageUpdateEvent').MessageUpdateType,
    patch: Partial<ConversationMessage>,
    options?: Partial<import('./ConversationStreamPatchScheduler').ConversationStreamPatchCommitOptions>,
  ) => void;
  readonly commitThinkingTrace: (workTrace: ConversationWorkTrace) => void;
  readonly beginAssistantContentLoop: () => void;
  readonly markLoopCommentary: () => void;
  readonly currentLoopId: () => string;
  readonly resolveStreamingOutputPhase: () => ConversationLoopOutputPhase | undefined;
  readonly recordProviderOutputRefs: (refs?: ProviderOutputRef[]) => void;
  readonly currentLoopOptions: () => { loopId: string; loopProviderOutputRefs: ProviderOutputRef[] };
}

/** Projects one agent event onto the turn's assistant message, one named phase per event type. */
export function createAgentEventHandler(turn: AgentEventTurn): (event: AgentEvent) => void {
  return (event: AgentEvent) => {
    turn.host.emitConversationEvent({
      type: 'agent_event',
      sessionId: turn.sessionId ?? '',
      turnId: turn.turnStreamState.assistantMessage.turnId,
      event,
    });
    switch (event.type) {
      case 'run.started':
        return onRunStarted(turn, event);
      case 'context.compacted':
        return onContextCompacted(turn, event);
      case 'assistant.delta':
        return onAssistantDelta(turn, event);
      case 'assistant.text_end':
        return onAssistantTextEnd(turn, event);
      case 'assistant.thinking_delta':
      case 'assistant.thinking_end':
        return onAssistantThinking(turn, event);
      case 'diagnostic':
        return onDiagnostic(turn, event);
      case 'tool.requested':
        return onToolRequested(turn, event);
      case 'tool.started':
        return onToolStarted(turn, event);
      case 'tool.progress':
        // Streamed to the renderer above; progress is never part of the persisted message or the model's view.
        return;
      case 'tool.denied':
        return onToolDenied(turn, event);
      case 'approval.requested':
        if (!onDelegatedInteraction(turn, event)) onApprovalRequested(turn, event);
        return;
      case 'approval.answered':
        if (!onDelegatedInteraction(turn, event)) onApprovalAnswered(turn, event);
        return;
      case 'tool.completed':
        return onToolCompleted(turn, event);
      case 'task.created':
      case 'task.updated':
        return onTaskChanged(turn, event);
      case 'assistant.completed':
        return onAssistantCompleted(turn, event);
      case 'run.completed':
        return onRunCompleted(turn);
      case 'run.failed':
        return onRunFailed(turn, event);
      case 'run.cancelled':
        return onRunCancelled(turn);
      default:
        return assertNever(event);
    }
  };
}

const currentLoopItem = (turn: AgentEventTurn, kind: 'text' | 'thinking', ref: ProviderOutputRef) =>
  turn.turnStreamState.assistantMessage.workTrace?.blocks
    .find((block) => block.id === turn.currentLoopId())
    ?.items?.find((item) => item.kind === kind && sameProviderBlock(item.providerOutputRef, ref));

/** The retried request streams the loop again from its first token; nothing from the failed try survives. */
function discardFailedAttempt(turn: AgentEventTurn): void {
  const { turnStreamState } = turn;
  turn.commitThinkingTrace(discardLoopAttempt(turnStreamState.assistantMessage.workTrace, turn.currentLoopId()));
  turnStreamState.currentLoopText = '';
  turnStreamState.currentLoopProviderOutputRefs = [];
  turnStreamState.currentLoopOutputPhase = undefined;
  turnStreamState.loopHasTools = false;
}

/** The loop started: the run block names the model and the tools. */
function onRunStarted(turn: AgentEventTurn, event: AgentEventOf<'run.started'>): void {
  const { agentLabel, commitAssistantMessage, turnStreamState } = turn;
  const { payload } = event;
  const details = [
    payload.providerId && payload.modelId ? `Model: ${payload.providerId} / ${payload.modelId}` : '',
    payload.toolAllowlist.length > 0 ? `Tools: ${payload.toolAllowlist.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  commitAssistantMessage('message_patched', {
    workTrace: upsertWorkBlock(turnStreamState.assistantMessage.workTrace, 'runtime-run', {
      kind: 'reasoning',
      title: 'Start Agent Loop',
      stage: 'preflight',
      status: 'running',
      summary: [`${agentLabel} started the model and tool loop.`, details].filter(Boolean).join('\n'),
      startedAt: nowMs(),
    }),
  });
}

/** Automatic compaction progress, once per compaction and status. */
function onContextCompacted(turn: AgentEventTurn, event: AgentEventOf<'context.compacted'>): void {
  const { commitAssistantMessage, seenCompactionSummaries, turnStreamState } = turn;
  const { payload } = event;
  const summary = payload.summary.trim();
  const status = payload.status ?? 'complete';
  const identity = payload.compactionId ?? event.id;
  const notificationKey = `${identity}:${status}`;
  if (summary && !seenCompactionSummaries.has(notificationKey)) {
    seenCompactionSummaries.add(notificationKey);
    commitAssistantMessage('message_patched', {
      workTrace: upsertWorkBlock(turnStreamState.assistantMessage.workTrace, `compaction-${identity}`, {
        kind: 'compaction',
        title: status === 'running' ? '正在整理上下文' : status === 'complete' ? '上下文已自动压缩' : '上下文整理失败',
        stage: 'context',
        status,
        summary,
        compactionStats: {
          provenance: 'auto',
          usage: payload.usage,
          sourceUri: payload.sourceUri,
          sourceHash: payload.sourceHash,
          tokensBefore: payload.tokensBefore,
          tokensAfter: payload.tokensAfter,
        },
        ...(status === 'running' ? { startedAt: nowMs() } : { completedAt: nowMs() }),
      }),
    });
  }
}

/** Streamed assistant text extends its text item in the current loop. */
function onAssistantDelta(turn: AgentEventTurn, event: AgentEventOf<'assistant.delta'>): void {
  const {
    commitThinkingTrace,
    beginAssistantContentLoop,
    currentLoopId,
    resolveStreamingOutputPhase,
    recordProviderOutputRefs,
    turnStreamState,
  } = turn;
  const { payload } = event;
  const chunk = payload.text;
  if (chunk) {
    beginAssistantContentLoop();
    recordProviderOutputRefs([payload.providerOutputRef]);
    turnStreamState.currentLoopText += chunk;
    const previous = currentLoopItem(turn, 'text', payload.providerOutputRef);
    const trace = upsertLoopResult(turnStreamState.assistantMessage.workTrace, currentLoopId(), {
      status: 'streaming',
      outputPhase: resolveStreamingOutputPhase(),
      providerOutputRefs: turnStreamState.currentLoopProviderOutputRefs,
    });
    commitThinkingTrace(
      upsertLoopTextItem(
        trace,
        currentLoopId(),
        payload.providerOutputRef,
        (previous?.kind === 'text' ? previous.text : '') + chunk,
        payload.phase,
        'streaming',
      ),
    );
  }
}

/** A text block closed. */
function onAssistantTextEnd(turn: AgentEventTurn, event: AgentEventOf<'assistant.text_end'>): void {
  const { commitThinkingTrace, beginAssistantContentLoop, currentLoopId, recordProviderOutputRefs, turnStreamState } =
    turn;
  const { payload } = event;
  beginAssistantContentLoop();
  recordProviderOutputRefs([payload.providerOutputRef]);
  const trace = turnStreamState.assistantMessage.workTrace;
  if (trace)
    commitThinkingTrace(
      upsertLoopTextItem(trace, currentLoopId(), payload.providerOutputRef, payload.text, payload.phase, 'complete'),
    );
}

/** Readable thinking extends or closes its thinking item. */
function onAssistantThinking(
  turn: AgentEventTurn,
  event: AgentEventOf<'assistant.thinking_delta' | 'assistant.thinking_end'>,
): void {
  const { commitThinkingTrace, beginAssistantContentLoop, currentLoopId, turnStreamState } = turn;
  const { payload } = event;
  beginAssistantContentLoop();
  // Each provider thinking block is its own item, keyed by its output ref.
  const previous = currentLoopItem(turn, 'thinking', payload.providerOutputRef);
  const thinking = mergeThinkingPayload(
    previous?.kind === 'thinking' ? previous.thinking : undefined,
    payload.thinking,
    payload.text,
  );
  if (thinking) {
    commitThinkingTrace(
      upsertLoopThinkingItem(
        turnStreamState.assistantMessage.workTrace,
        currentLoopId(),
        payload.providerOutputRef,
        thinking,
        event.type === 'assistant.thinking_end' ? 'complete' : 'streaming',
      ),
    );
  }
}

/** Runtime diagnostics: retries discard the failed attempt; others become diagnostic blocks. */
function onDiagnostic(turn: AgentEventTurn, event: AgentEventOf<'diagnostic'>): void {
  const { sessionId, input, commitAssistantMessage, turnStreamState } = turn;
  const { payload } = event;
  const summary = payload.message || 'Received runtime diagnostic.';
  if (!shouldProjectDiagnosticToWorkProcess(payload.code)) {
    // Recovery / thinking-lifecycle telemetry stays in Agent Activity only.
    const isRecovery = payload.code.startsWith('error_recovery_');
    if (isRecovery) {
      runtimeLogService.log({
        scope: sessionId ? 'session' : 'app',
        namespace: 'agent',
        severity: payload.severity === 'error' ? 'error' : payload.severity === 'warning' ? 'warning' : 'info',
        title: payload.phase === 'started' ? 'Provider recovery' : 'Provider recovery complete',
        summary,
        sessionId,
        projectId: input.context.projectId,
        runId: isActiveRun(input.context.currentRun) ? input.context.currentRun.runId : null,
        raw: {
          code: payload.code,
          phase: payload.phase,
          surface: 'runtime-log',
        },
      });
      if (payload.phase === 'started') discardFailedAttempt(turn);
    }
    return;
  }
  const blockStatus = payload.phase === 'started' ? 'running' : payload.severity === 'error' ? 'error' : 'complete';
  const hookTrace =
    payload.code.startsWith('hook.') && payload.toolCallId !== undefined
      ? attachRuntimeHookDiagnostic(turnStreamState.assistantMessage.workTrace, payload.toolCallId, {
          id: event.id,
          code: payload.code,
          severity: payload.severity,
          message: summary,
          timestamp: event.timestamp,
        })
      : null;
  commitAssistantMessage('message_patched', {
    workTrace:
      hookTrace ??
      upsertWorkBlock(
        turnStreamState.assistantMessage.workTrace,
        `runtime-diagnostic-${payload.code.startsWith('hook.') ? `hook.${event.id}` : payload.code}`,
        {
          kind: 'diagnostic',
          status: blockStatus,
          diagnosticSeverity: payload.severity,
          title: 'Runtime diagnostic',
          summary,
          completedAt: blockStatus === 'running' ? undefined : nowMs(),
        },
      ),
  });
}

/** A structured tool call was requested in the current loop. */
function onToolRequested(turn: AgentEventTurn, event: AgentEventOf<'tool.requested'>): void {
  const {
    commitAssistantMessage,
    commitThinkingTrace,
    beginAssistantContentLoop,
    markLoopCommentary,
    currentLoopId,
    currentLoopOptions,
    turnStreamState,
  } = turn;
  const { payload } = event;
  if (payload.toolCall.id && payload.toolCall.name) {
    beginAssistantContentLoop();
    turnStreamState.loopHasTools = true;
    markLoopCommentary();
    let trace = turnStreamState.assistantMessage.workTrace;
    const textItems = (trace?.blocks.find((block) => block.id === currentLoopId())?.items ?? []).filter(
      (item) => item.kind === 'text',
    );
    for (const item of textItems) {
      if (trace && !item.phase)
        trace = upsertLoopTextItem(
          trace,
          currentLoopId(),
          item.providerOutputRef,
          item.text,
          'commentary',
          item.status,
        );
    }
    if (trace && textItems.length) commitThinkingTrace(trace);
    // Stamp commentary explicitly so projection does not hide pre-tool narrative.
    if (turnStreamState.currentLoopText.trim()) {
      commitThinkingTrace(
        upsertLoopResult(turnStreamState.assistantMessage.workTrace, currentLoopId(), {
          status: 'streaming',
          outputPhase: 'commentary',
          providerOutputRefs: turnStreamState.currentLoopProviderOutputRefs,
        }),
      );
    }
    commitAssistantMessage('message_patched', {
      workTrace: upsertRuntimeToolCall(
        turnStreamState.assistantMessage.workTrace,
        {
          id: payload.toolCall.id,
          toolName: payload.toolCall.name,
          status: 'pending',
          providerOutputRef: { ...payload.providerOutputRef },
          argsPreview: redactedArgumentsPreview(payload.toolCall.arguments),
          startedAt: nowMs(),
        },
        currentLoopOptions(),
      ),
    });
  }
}

/** A tool call started executing. */
function onToolStarted(turn: AgentEventTurn, event: AgentEventOf<'tool.started'>): void {
  const { commitAssistantMessage, markLoopCommentary, currentLoopOptions, turnStreamState } = turn;
  const { payload } = event;
  const loopScoped = isLoopTool(payload.toolName);
  const isSubagent = normalizeToolName(payload.toolName) === 'subagent';
  if (loopScoped) {
    // Tool execution belongs to the provider loop that requested it. Only a
    // subsequent assistant semantic event may consume turnStreamState.pendingNewLoop.
    turnStreamState.loopHasTools = true;
    markLoopCommentary();
  }
  commitAssistantMessage('message_patched', {
    workTrace: upsertRuntimeToolCall(
      turnStreamState.assistantMessage.workTrace,
      {
        id: payload.toolCallId,
        toolName: payload.toolName,
        status: 'running',
        executionStartedAt: event.timestamp,
        argsPreview: redactedArgumentsPreview(payload.args),
        ...(isSubagent
          ? {
              delegation: {
                task: redactCredentialLikeText(String(payload.args.task ?? '')),
                profile: String(payload.args.profile ?? event.agentId ?? ''),
                mode: payload.args.mode === 'background' ? ('background' as const) : ('wait' as const),
              },
            }
          : {}),
        startedAt: nowMs(),
      },
      loopScoped ? currentLoopOptions() : undefined,
    ),
  });
}

/** A tool call was denied before execution. */
function onToolDenied(turn: AgentEventTurn, event: AgentEventOf<'tool.denied'>): void {
  const { commitAssistantMessage, markLoopCommentary, currentLoopOptions, turnStreamState } = turn;
  const { payload } = event;
  const { reason } = payload;
  const loopScopedDenied = isLoopTool(payload.toolName);
  if (loopScopedDenied) {
    turnStreamState.loopHasTools = true;
    markLoopCommentary();
  }
  commitAssistantMessage('message_patched', {
    workTrace: upsertRuntimeToolCall(
      turnStreamState.assistantMessage.workTrace,
      {
        id: payload.toolCallId,
        toolName: payload.toolName,
        status: 'error',
        resultPreview: buildToolResultPreview(payload.result ?? { reason }),
        error: reason,
        completedAt: nowMs(),
      },
      loopScopedDenied ? currentLoopOptions() : undefined,
    ),
  });
}

/** A child execution's approval or question is projected without touching the parent's loop; true when handled. */
function onDelegatedInteraction(
  turn: AgentEventTurn,
  event: AgentEventOf<'approval.requested' | 'approval.answered'>,
): boolean {
  const { host, sessionId, input, turnStreamState } = turn;
  const { payload } = event;
  if (payload.delegatedRequest) {
    const originalToolCallId = payload.toolCallId ?? payload.approvalId;
    const delegatedRequest = { ...payload.delegatedRequest, toolCallId: originalToolCallId };
    const pending = payload.status === 'pending';
    const rejected = payload.status === 'rejected' || payload.status === 'cancelled';
    if (event.sessionId !== sessionId && event.sessionId !== delegatedRequest.childSessionId) return true;
    const message = {
      ...turnStreamState.assistantMessage,
      updatedAt: nowMs(),
      workTrace: upsertRuntimeToolCall(turnStreamState.assistantMessage.workTrace, {
        id: `${delegatedRequest.childSessionId}::${originalToolCallId}`,
        toolName: payload.toolName ?? 'approval',
        delegatedRequest,
        status: pending ? 'running' : rejected ? 'error' : 'complete',
        argsPreview: `Child execution ${delegatedRequest.executionId}`,
        userInputQuestions:
          payload.kind === 'ask_user' ? normalizeAskUserQuestions({ questions: payload.questions }) : undefined,
        planReview: payload.kind === 'plan_review' ? payload.planReview : undefined,
        resultPreview: pending ? undefined : String(payload.answer ?? 'Response delivered to child execution.'),
        approval:
          payload.kind === 'ask_user' || payload.kind === 'plan_review'
            ? undefined
            : {
                approvalId: payload.approvalId,
                status: payload.status,
                reason: payload.reason,
                risk: payload.risk,
                reviewer: payload.reviewer,
                reviewMethod: payload.reviewMethod,
                errorCode: payload.errorCode,
              },
      }),
    };
    const failure = host.persistConversationSnapshot(sessionId, message);
    if (failure) throw failure;
    turnStreamState.assistantMessage = message;
    host.emitConversationEvent({
      type: 'message_patched',
      sessionId: sessionId ?? '',
      turnId: message.turnId,
      message,
    });
    host.publishConversationTrace(sessionId ?? '', [input.userMessage, message], sessionId);
    // A child question does not retract the parent's final reply or mutate its loop continuation.
    return true;
  }
  return false;
}

/** The turn asks for approval, a user answer or plan review. */
function onApprovalRequested(turn: AgentEventTurn, event: AgentEventOf<'approval.requested'>): void {
  const {
    commitAssistantMessage,
    markLoopCommentary,
    currentLoopId,
    currentLoopOptions,
    pendingContinuation,
    turnStreamState,
  } = turn;
  const { payload } = event;
  const { approvalId } = payload;
  const toolCallId = payload.toolCallId ?? approvalId;
  const toolName = payload.toolName ?? 'approval';
  if (isPlanReviewApprovalPayload({ kind: payload.kind, toolName })) {
    pendingContinuation.planReview = true;
    turnStreamState.pendingNewLoop = true;
    markLoopCommentary();
    if (!payload.planReview) return;
    commitAssistantMessage('message_patched', {
      workTrace: applyPlanReviewRequested({
        payload,
        workTrace: turnStreamState.assistantMessage.workTrace,
        loopId: currentLoopId(),
      }),
    });
    return;
  }
  if (payload.kind === 'ask_user' || normalizeToolName(toolName) === 'ask_user') {
    pendingContinuation.userInput = true;
    // The user interaction stays with the response that requested it.
    turnStreamState.pendingNewLoop = true;
    markLoopCommentary();
    const questions = normalizeAskUserQuestions({ questions: payload.questions });
    commitAssistantMessage('message_patched', {
      workTrace: upsertLoopResult(
        upsertRuntimeToolCall(
          turnStreamState.assistantMessage.workTrace,
          {
            id: toolCallId,
            toolName: 'ask_user',
            status: 'running',
            userInputQuestions: questions,
            argsPreview: questions
              .map((question) => question.prompt)
              .join(' | ')
              .slice(0, 600),
            startedAt: nowMs(),
          },
          currentLoopOptions(),
        ),
        currentLoopId(),
        {
          status: 'complete',
          stopReason: 'tool_use',
          outputPhase: 'commentary',
          providerOutputRefs: turnStreamState.currentLoopProviderOutputRefs,
        },
      ),
    });
    return;
  }
  const reason = payload.reason || 'This action requires user approval before it can run.';
  if (!isAutomaticToolApproval(payload)) pendingContinuation.approval = true;
  markLoopCommentary();
  commitAssistantMessage('message_patched', {
    workTrace: upsertRuntimeToolApproval(
      turnStreamState.assistantMessage.workTrace,
      {
        approvalId,
        toolCallId,
        toolName,
        status: 'pending',
        reason,
        risk: payload.risk,
        reviewer: payload.reviewer,
        reviewMethod: payload.reviewMethod,
        errorCode: payload.errorCode,
      },
      currentLoopOptions(),
    ),
  });
}

/** An approval, answer or plan review decision arrived. */
function onApprovalAnswered(turn: AgentEventTurn, event: AgentEventOf<'approval.answered'>): void {
  const { commitAssistantMessage, currentLoopOptions, pendingContinuation, turnStreamState } = turn;
  const { payload } = event;
  const { approvalId } = payload;
  if (isPlanReviewApprovalPayload({ kind: payload.kind, toolName: payload.toolName })) {
    if (payload.status !== 'cancelled') {
      pendingContinuation.planReview = false;
    }
    commitAssistantMessage('message_patched', {
      workTrace: applyPlanReviewAnswered({
        payload,
        workTrace: turnStreamState.assistantMessage.workTrace,
      }),
    });
    return;
  }
  if (payload.kind === 'ask_user' || normalizeToolName(payload.toolName ?? '') === 'ask_user') {
    const failed = payload.status === 'rejected' || payload.status === 'cancelled';
    if (!failed) {
      pendingContinuation.userInput = false;
    }
    const resultPreview = failed
      ? String(payload.answer ?? 'User input request was cancelled.')
      : JSON.stringify({ answers: payload.answers ?? [] });
    commitAssistantMessage('message_patched', {
      workTrace: upsertRuntimeToolCall(turnStreamState.assistantMessage.workTrace, {
        id: payload.toolCallId ?? approvalId,
        toolName: 'ask_user',
        status: failed ? 'error' : 'running',
        resultPreview,
        error: failed ? String(payload.answer ?? 'User input request was cancelled.') : undefined,
        completedAt: failed ? nowMs() : undefined,
      }),
    });
    return;
  }
  const approvalStatus = payload.status;
  pendingContinuation.approval = (turnStreamState.assistantMessage.workTrace?.blocks ?? []).some((block) =>
    block.toolCalls.some(
      (call) =>
        !call.delegatedRequest &&
        call.approval?.status === 'pending' &&
        call.approval.approvalId !== approvalId &&
        !isAutomaticToolApproval(call.approval),
    ),
  );
  const answerText =
    payload.answer === undefined || payload.answer === null
      ? ''
      : typeof payload.answer === 'string'
        ? payload.answer.trim()
        : String(payload.answer).trim();
  commitAssistantMessage('message_patched', {
    workTrace: upsertRuntimeToolApproval(
      turnStreamState.assistantMessage.workTrace,
      {
        approvalId,
        toolCallId: payload.toolCallId ?? approvalId,
        toolName: payload.toolName ?? 'approval',
        status: approvalStatus,
        answer: answerText,
        reviewMethod: payload.reviewMethod,
        errorCode: payload.errorCode,
      },
      currentLoopOptions(),
    ),
  });
}

/** A tool call completed with its result. */
function onToolCompleted(turn: AgentEventTurn, event: AgentEventOf<'tool.completed'>): void {
  const { sessionId, commitAssistantMessage, currentLoopOptions, pendingContinuation, turnStreamState } = turn;
  const { toolCallId, toolName, result } = event.payload;
  if (sessionId && normalizeToolName(toolName) === 'subagent') {
    delegationTraceStore.setParentReceipt(rootScopeId(sessionId), toolCallId, result);
  }
  const isAskUserTool = normalizeToolName(toolName) === 'ask_user';
  const isPlanArtifactTool = normalizeToolName(toolName) === 'plan_artifact';
  if (isAskUserTool && result.ok) {
    pendingContinuation.userInput = false;
  }
  if (isPlanArtifactTool && result.ok) {
    pendingContinuation.planReview = false;
  }
  const existing = turnStreamState.assistantMessage.workTrace?.blocks
    .flatMap((block) => block.toolCalls)
    .find((call) => call.id === toolCallId);
  const toolCallPatch = buildConversationToolCompletion(toolCallId, toolName, result, existing, nowMs());
  const loopScopedCompleted = isLoopTool(toolName);
  commitAssistantMessage('message_patched', {
    workTrace: upsertRuntimeToolCall(
      turnStreamState.assistantMessage.workTrace,
      toolCallPatch,
      loopScopedCompleted ? currentLoopOptions() : undefined,
    ),
  });
}

/** Task snapshots for the Tasks history card. */
function onTaskChanged(turn: AgentEventTurn, event: AgentEventOf<'task.created' | 'task.updated'>): void {
  const { commitAssistantMessage, currentLoopId, turnStreamState } = turn;
  const items = normalizeTaskSnapshotItems(event.payload);
  const completed = items.filter((item) => item.status === 'completed').length;
  const snapshotId = `task-snapshot-${event.id}`;
  commitAssistantMessage('message_patched', {
    workTrace: upsertWorkBlock(turnStreamState.assistantMessage.workTrace, snapshotId, {
      kind: 'task_snapshot',
      parentLoopId: currentLoopId(),
      title: event.type === 'task.created' ? 'Tasks added' : 'Tasks updated',
      stage: 'task',
      status: 'complete',
      taskSnapshot: {
        change: event.type === 'task.created' ? 'created' : 'updated',
        completed,
        total: items.length,
        items,
      },
      summary: `${completed} of ${items.length} completed`,
      startedAt: event.timestamp,
      completedAt: event.timestamp,
    }),
  });
}

/** The provider finished one loop: its result, stop reason and phase settle. */
function onAssistantCompleted(turn: AgentEventTurn, event: AgentEventOf<'assistant.completed'>): void {
  const {
    input,
    commitAssistantMessage,
    beginAssistantContentLoop,
    currentLoopId,
    recordProviderOutputRefs,
    pendingContinuation,
    turnStreamState,
  } = turn;
  const { payload } = event;
  beginAssistantContentLoop();
  const loopResult = payload.text.trim();
  recordProviderOutputRefs(payload.providerOutputRefs);
  const stopReason = payload.stopReason;
  const resolvedOutputPhase = resolveConversationLoopOutputPhase({
    stopReason,
    loopHasTools: turnStreamState.loopHasTools,
    hasPendingContinuation: pendingContinuation,
  });
  const outputPhase = turnStreamState.currentLoopOutputPhase ?? resolvedOutputPhase;
  turnStreamState.currentLoopOutputPhase = outputPhase;
  const completedTrace = turnStreamState.assistantMessage.workTrace;
  if (
    loopResult ||
    completedTrace?.blocks.some((block) => block.id === currentLoopId()) ||
    payload.thinking?.length ||
    stopReason
  ) {
    let trace = settleLoopItems(
      upsertLoopResult(completedTrace, currentLoopId(), {
        status: 'complete',
        stopReason,
        outputPhase,
        providerOutputRefs: turnStreamState.currentLoopProviderOutputRefs,
      }),
      currentLoopId(),
      { stopReason, outputPhase },
      { textItems: payload.textItems, thinking: payload.thinking },
    );
    const reasoningState = resolveConversationReasoningState(
      lastLoopThinking(trace.blocks.find((block) => block.id === currentLoopId())),
      input.preparedTurn.runtime.routeCapability.reasoningDelivery,
    );
    trace = upsertLoopResult(trace, currentLoopId(), { status: 'complete', reasoningState });
    commitAssistantMessage('message_patched', {
      workTrace: trace,
    });
  }
  // Provider completion closes this response, even when the host requests another one.
  // The owning turn's validated completion receipt is the only publisher of an answer.
  turnStreamState.pendingNewLoop = true;
}

/** The run finished. */
function onRunCompleted(turn: AgentEventTurn): void {
  const { commitAssistantMessage, turnStreamState } = turn;
  commitAssistantMessage('message_patched', {
    workTrace: upsertWorkBlock(turnStreamState.assistantMessage.workTrace, 'runtime-run', {
      kind: 'reasoning',
      title: 'Agent Loop completed',
      stage: 'respond',
      status: 'complete',
      summary: 'Model and tool loop completed.',
      completedAt: nowMs(),
    }),
  });
}

/** The run failed. */
function onRunFailed(turn: AgentEventTurn, event: AgentEventOf<'run.failed'>): void {
  const { commitAssistantMessage, turnStreamState } = turn;
  commitAssistantMessage('message_patched', {
    workTrace: upsertWorkBlock(turnStreamState.assistantMessage.workTrace, 'runtime-run', {
      kind: 'diagnostic',
      title: 'Agent Loop failed',
      stage: 'respond',
      status: 'error',
      summary: summarizeRuntimePayload(event.payload) || 'Agent Loop failed.',
      completedAt: nowMs(),
    }),
  });
}

/** The kernel cancelled the run without a session Stop. */
function onRunCancelled(turn: AgentEventTurn): void {
  const { turnStreamState } = turn;
  turnStreamState.runWasCancelled = true;
}
