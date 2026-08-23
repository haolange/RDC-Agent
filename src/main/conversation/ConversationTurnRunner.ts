import type {
  ConversationLoopOutputPhase,
  ConversationMessage,
  ConversationMessageDiagnostic,
  ConversationStreamEvent,
  ConversationThinkingStatus,
  ConversationTurnResult,
  ConversationWorkTrace,
} from '@shared/types/conversation';
import { ROOT_BRANCH_ID } from '@shared/types/conversationBranch';
import type { AgentRole } from '@shared/types/agent';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type { ExecutionIdentity, RequestPlan } from '@shared/types/providerCapability';
import type { ProviderOutputRef, ThinkingArtifact } from '@shared/types/reasoning';
import type { AppMode, SessionAttachmentRecord } from '@shared/types/session';
import { generateEventId, nowMs } from '@shared/utils/id';
import { agentOrchestrator, type PreparedAgentTurnContext } from '../workflow/debugger/AgentOrchestrator';
import { agentUserInputRequestService } from '../agent-runtime/interactions/AgentUserInputRequestService';
import { agentToolApprovalRequestService } from '../agent-runtime/permissions/AgentToolApprovalRequestService';
import { storageAdapter } from '../sessions/StorageAdapter';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { canonicalizeSessionContextTurnEntry } from './SessionContextJournal';
import type { Message as AgentRuntimeMessage } from '../agent-runtime/core/types';
import { ConversationStreamPatchScheduler, type ConversationStreamPatchCommitOptions } from './ConversationStreamPatchScheduler';
import { finalizeTrace, upsertWorkBlock } from './ConversationWorkTrace';
import { attachToolExecutionEvidence } from './ConversationToolEvidence';
import type { ConversationLoopContinuationState } from '@shared/conversation/loopOutputPhase';
import { beginAssistantContentLoopIfPending } from './ConversationLoopRuntimeState';
import { EMPTY_CANONICAL_ASSISTANT_OUTPUT, requireCanonicalFinalAnswer } from './CanonicalAssistantOutput';
import { hydrateFrozenUserContent } from './ConversationAttachmentMaterializer';
import { createAgentEventHandler } from './ConversationTurnAgentEventHandler';
import type {
  ActiveConversationTurn,
  AgentRoutePreflightOk,
  PreparedConversationPrompt,
  ResolvedConversationContext,
} from './ConversationRoutePreflight';
import {
  createTurnFailedDiagnostic,
  getAgentLabel,
  isActiveRun,
  recordLlmDiagnostic,
} from './ConversationRoutePreflight';

export interface CompleteProfileTurnInput {
    context: ResolvedConversationContext;
    requestedMode: AppMode;
    requestedAgentId: AgentRole;
    rawMessage: string;
    importedAttachments: SessionAttachmentRecord[];
    userMessage: ConversationMessage;
    assistantDraftMessage: ConversationMessage;
    requestId: string;
    routePreflight: AgentRoutePreflightOk;
    planning: {
      ok: true;
      plan: RequestPlan;
      controls: ConversationTurnControls;
      warnings: string[];
    };
    preparedPrompt: PreparedConversationPrompt;
    preparedTurn: PreparedAgentTurnContext;
  }

export interface ConversationTurnRunnerHost {
  persistConversationSnapshot(sessionId: string | null | undefined, message: ConversationMessage): Error | null;
  emitConversationEvent(event: ConversationStreamEvent): void;
  publishConversationTrace(traceSessionId: string, messages: ConversationMessage[], persistedSessionId?: string | null): void;
  registerActiveTurn(turn: ActiveConversationTurn): void;
  clearActiveTurn(turnId: string, controller: AbortController): void;
  assertTerminalContextOwnership(
    sessionId: string,
    turnId: string,
    userMessageId: string,
    assistantMessageId: string,
    branchId: string,
  ): void;
  ephemeralTraceSessionId(turnId: string): string;
  setPendingHandoff(sessionId: string, handoff: { toProfile: AgentRole; prompt: string }): void;
}

export async function completeProfileTurn(
  host: ConversationTurnRunnerHost,
  input: CompleteProfileTurnInput,
): Promise<void> {
  let assistantMessage = input.assistantDraftMessage;
  const sessionId = input.context.session?.sessionId ?? null;
  const traceSessionId = sessionId ?? host.ephemeralTraceSessionId(input.assistantDraftMessage.turnId);
  const abortController = new AbortController();
  const conversationAgentId: AgentRole = input.requestedAgentId;
  const capturedBranchId = input.assistantDraftMessage.branchId
    ?? input.userMessage.branchId
    ?? ROOT_BRANCH_ID;
  const agentLabel = getAgentLabel(conversationAgentId);
  const showWorkTrace = true;

  const capability = input.preparedTurn.effectiveModel;
  const planning = input.planning;
  const turnControls = planning.controls;
  if (sessionId && turnControls) {
    storageAdapter.updateSession(sessionId, { turnControls });
  }

  let streamScheduler: ConversationStreamPatchScheduler | null = null;
  let conversationPersistenceError: Error | null = null;
  let deferredTerminalEventType: ConversationStreamEvent['type'] | null = null;
  let lastTracePublishedAt = 0;
  const TRACE_PUBLISH_MIN_INTERVAL_MS = 160;
  const terminalContext: { value: {
    messages: AgentRuntimeMessage[];
    executionIdentity: ExecutionIdentity;
    status: 'complete' | 'stopped' | 'error';
  } | null } = { value: null };
  let terminalHandoff: import('../workflow/debugger/TurnCoordinator').PendingHandoff | null = null;

  const applyAssistantMessagePatch = (
    type: ConversationStreamEvent['type'],
    patch: Partial<ConversationMessage>,
    options: ConversationStreamPatchCommitOptions = { persist: true, publishTrace: true, emit: true },
  ) => {
    if (abortController.signal.aborted && patch.status !== 'stopped') {
      return;
    }
    assistantMessage = {
      ...assistantMessage,
      ...patch,
      updatedAt: nowMs(),
    };
    if (options.persist) {
      const persistError = host.persistConversationSnapshot(sessionId, assistantMessage);
      if (persistError) {
        conversationPersistenceError ??= persistError;
        abortController.abort();
        assistantMessage = {
          ...assistantMessage,
          status: 'error',
          diagnostic: {
            code: 'CONVERSATION_LLM_REQUEST_FAILED',
            severity: 'error',
            userMessage: 'Conversation state could not be saved. Retry before continuing.',
            technicalMessage: persistError.message,
          },
          updatedAt: nowMs(),
        };
        host.emitConversationEvent({
          type: 'message_errored',
          sessionId: sessionId ?? '',
          turnId: assistantMessage.turnId,
          message: assistantMessage,
        });
        host.publishConversationTrace(traceSessionId, [input.userMessage, assistantMessage], sessionId);
        return;
      }
    }
    if (options.emit) {
      host.emitConversationEvent({
        type,
        sessionId: sessionId ?? '',
        turnId: assistantMessage.turnId,
        message: assistantMessage,
      } as ConversationStreamEvent);
    }
    if (options.publishTrace) {
      const now = nowMs();
      const isTerminal = type === 'message_completed' || type === 'message_errored'
        || patch.status === 'stopped'
        || patch.status === 'complete'
        || patch.status === 'error';
      if (isTerminal || now - lastTracePublishedAt >= TRACE_PUBLISH_MIN_INTERVAL_MS) {
        lastTracePublishedAt = now;
        host.publishConversationTrace(traceSessionId, [input.userMessage, assistantMessage], sessionId);
      }
    }
  };

  streamScheduler = new ConversationStreamPatchScheduler({
    commit: ({ type, patch, options }) => applyAssistantMessagePatch(type, patch, options),
  });

  const commitAssistantMessage = (
    type: ConversationStreamEvent['type'],
    patch: Partial<ConversationMessage>,
    options: Partial<ConversationStreamPatchCommitOptions> = {},
  ) => {
    streamScheduler?.commitImmediate(type, patch, options);
  };

  const commitTerminalAssistantMessage = (
    type: ConversationStreamEvent['type'],
    patch: Partial<ConversationMessage>,
  ) => {
    if (sessionId) deferredTerminalEventType = type;
    streamScheduler?.commitTerminal(
      type,
      patch,
      sessionId ? { persist: false, publishTrace: false, emit: false } : undefined,
    );
  };

  const commitStoppedMessage = () => {
    agentUserInputRequestService.cancelTurn(assistantMessage.turnId);
    agentToolApprovalRequestService.cancelTurn(assistantMessage.turnId);
    commitTerminalAssistantMessage('message_completed', {
      status: 'stopped',
      content: assistantMessage.content || '当前请求已停止。',
      workTrace: finalizeTrace(
        upsertWorkBlock(assistantMessage.workTrace, 'assistant-output', {
          status: 'complete',
          summary: '用户已停止当前请求。',
          completedAt: nowMs(),
        }),
        'stopped',
        '请求已停止',
      ),
    });
  };

  let settleStopped = () => {};
  const stopped = new Promise<void>((resolve) => {
    settleStopped = resolve;
  });
  host.registerActiveTurn({
    requestId: input.requestId,
    turnId: assistantMessage.turnId,
    sessionId,
    startedAt: nowMs(),
    abortController,
    stopped,
    stop: () => {
      if (!abortController.signal.aborted) {
        try {
          // Persist pending deltas without broadcasting streaming patches; the
          // terminal stopped commit is the single authoritative UI transition.
          streamScheduler?.flushPending({ forcePersist: true, publishTrace: false, emit: false });
        } catch (error) {
          console.error('[ConversationService] stop flush failed:', error);
        }
        abortController.abort();
      }
    },
  });

  try {

  const commitVisibleAssistantText = () => {
    streamScheduler?.queueText({
      status: 'streaming',
      content: visibleResponse,
    });
  };

  const commitThinkingTrace = (workTrace: ConversationWorkTrace) => {
    streamScheduler?.queueTrace({ workTrace });
  };

  const withWorkTrace = (workTrace: ConversationWorkTrace): Partial<ConversationMessage> => (
    showWorkTrace ? { workTrace } : {}
  );

  let visibleResponse = '';
  let canonicalOutput = EMPTY_CANONICAL_ASSISTANT_OUTPUT;
  // Assistant turns are split into LLM loop turns. The loop result is model output;
  let currentLoopText = '';
  let currentLoopProviderOutputRefs: ProviderOutputRef[] = [];
  let currentLoopThinking: ThinkingArtifact | undefined;
  let currentLoopThinkingStatus: ConversationThinkingStatus | undefined;
  let loopSeq = 1;
  let loopHasTools = false;
  let pendingNewLoop = false;
  let currentLoopOutputPhase: ConversationLoopOutputPhase | undefined;
  /** Once true for this turn, process commentary must not stream into the answer bubble. */
  let turnHasProcessEvidence = false;
  /** After ask_user pause, subsequent assistant content must not reuse the ask commentary loop. */
  let turnHadAskPause = false;
  const pendingContinuation: ConversationLoopContinuationState = {
    approval: false,
    userInput: false,
    subagent: false,
    handoff: false,
  };
  const markProcessEvidence = () => {
    turnHasProcessEvidence = true;
  };
  const markLoopCommentary = () => {
    // Commentary evidence is monotonic within a loop. Final-answer phase is
    // assigned only by assistant.completed after the stop reason is known.
    currentLoopOutputPhase = 'commentary';
    markProcessEvidence();
  };
  const hasPendingContinuation = () => (
    pendingContinuation.approval
    || pendingContinuation.userInput
    || pendingContinuation.subagent
    || pendingContinuation.handoff
  );
  const resolveStreamingOutputPhase = (): ConversationLoopOutputPhase | undefined => {
    return currentLoopOutputPhase;
  };
  const syncVisibleResponseForStreaming = () => {
    const phase = resolveStreamingOutputPhase();
    const thinkingInFlight = currentLoopThinkingStatus === 'streaming';
    // Stream into the bubble only for clear finals — never while thinking/tools/ask are active.
    if (
      phase === 'final_answer'
      && !thinkingInFlight
      && !loopHasTools
      && !hasPendingContinuation()
    ) {
      visibleResponse = currentLoopText;
    } else if (
      phase === undefined
      && !turnHasProcessEvidence
      && !loopHasTools
      && !currentLoopThinking
      && !hasPendingContinuation()
      && !turnHadAskPause
    ) {
      visibleResponse = currentLoopText;
    } else if (visibleResponse) {
      visibleResponse = '';
    }
  };
  let errorViewModel: ConversationTurnResult['errorViewModel'] = null;
  let llmDiagnostic: ConversationMessageDiagnostic | null = null;
  let runWasCancelled = false;
  const seenCompactionSummaries = new Set<string>();
  const turnStreamState = {} as import('./ConversationTurnAgentEventHandler').TurnStreamState;
  Object.defineProperty(turnStreamState, 'currentLoopText', { get: () => currentLoopText, set: (value) => { currentLoopText = value; } });
  Object.defineProperty(turnStreamState, 'currentLoopThinking', { get: () => currentLoopThinking, set: (value) => { currentLoopThinking = value; } });
  Object.defineProperty(turnStreamState, 'currentLoopThinkingStatus', { get: () => currentLoopThinkingStatus, set: (value) => { currentLoopThinkingStatus = value; } });
  Object.defineProperty(turnStreamState, 'currentLoopProviderOutputRefs', { get: () => currentLoopProviderOutputRefs, set: (value) => { currentLoopProviderOutputRefs = value; } });
  Object.defineProperty(turnStreamState, 'loopHasTools', { get: () => loopHasTools, set: (value) => { loopHasTools = value; } });
  Object.defineProperty(turnStreamState, 'visibleResponse', { get: () => visibleResponse, set: (value) => { visibleResponse = value; } });
  Object.defineProperty(turnStreamState, 'canonicalOutput', { get: () => canonicalOutput, set: (value) => { canonicalOutput = value; } });
  Object.defineProperty(turnStreamState, 'runWasCancelled', { get: () => runWasCancelled, set: (value) => { runWasCancelled = value; } });
  Object.defineProperty(turnStreamState, 'loopSeq', { get: () => loopSeq, set: (value) => { loopSeq = value; } });
  Object.defineProperty(turnStreamState, 'pendingNewLoop', { get: () => pendingNewLoop, set: (value) => { pendingNewLoop = value; } });
  Object.defineProperty(turnStreamState, 'currentLoopOutputPhase', { get: () => currentLoopOutputPhase, set: (value) => { currentLoopOutputPhase = value; } });
  Object.defineProperty(turnStreamState, 'turnHasProcessEvidence', { get: () => turnHasProcessEvidence, set: (value) => { turnHasProcessEvidence = value; } });
  Object.defineProperty(turnStreamState, 'turnHadAskPause', { get: () => turnHadAskPause, set: (value) => { turnHadAskPause = value; } });
  Object.defineProperty(turnStreamState, 'assistantMessage', { get: () => assistantMessage, set: (value) => { assistantMessage = value; } });
  Object.defineProperty(turnStreamState, 'errorViewModel', { get: () => errorViewModel, set: (value) => { errorViewModel = value; } });
  Object.defineProperty(turnStreamState, 'llmDiagnostic', { get: () => llmDiagnostic, set: (value) => { llmDiagnostic = value; } });
  const currentLoopId = () => `runtime-loop-${loopSeq}`;
  const recordProviderOutputRefs = (refs: ProviderOutputRef[] | undefined) => {
    for (const ref of refs ?? []) {
      const duplicate = currentLoopProviderOutputRefs.some((candidate) => (
        candidate.protocol === ref.protocol
        && candidate.responseId === ref.responseId
        && candidate.providerBlockKey === ref.providerBlockKey
        && candidate.sourceIndex === ref.sourceIndex
        && candidate.itemId === ref.itemId
      ));
      if (!duplicate) currentLoopProviderOutputRefs.push({ ...ref });
    }
  };
  const routePreflight = input.routePreflight;
  const currentLoopOptions = () => ({
    loopId: currentLoopId(),
    loopResultText: currentLoopText.trim() || undefined,
    loopProviderOutputRefs: currentLoopProviderOutputRefs,
    loopThinking: currentLoopThinking,
    loopThinkingStatus: currentLoopThinkingStatus,
  });
  const beginAssistantContentLoop = () => {
    const previousLoopSeq = loopSeq;
    const next = beginAssistantContentLoopIfPending({
      loopSeq,
      currentLoopText,
      currentLoopThinking,
      currentLoopThinkingStatus,
      loopHasTools,
      pendingNewLoop,
      visibleResponse,
    });
    loopSeq = next.loopSeq;
    currentLoopText = next.currentLoopText;
    currentLoopThinking = next.currentLoopThinking;
    currentLoopThinkingStatus = next.currentLoopThinkingStatus;
    loopHasTools = next.loopHasTools;
    pendingNewLoop = next.pendingNewLoop;
    visibleResponse = next.visibleResponse;
    if (next.loopSeq !== previousLoopSeq) {
      currentLoopOutputPhase = undefined;
      currentLoopProviderOutputRefs = [];
    }
  };

  if (routePreflight.aliasRemap) {
    runtimeLogService.log({
      scope: sessionId ? 'session' : 'app',
      namespace: 'llm',
      severity: 'info',
      title: 'Canonical model alias remap',
      summary: `${routePreflight.providerId}/${routePreflight.aliasRemap.from} -> ${routePreflight.aliasRemap.to}`,
      sessionId,
      projectId: input.context.projectId,
      runId: isActiveRun(input.context.currentRun) ? input.context.currentRun.runId : null,
      raw: routePreflight.aliasRemap,
    });
  }

  try {
      if (!capability) {
        throw new Error(`MODEL_UNAVAILABLE: ${routePreflight.providerId}/${routePreflight.modelId}`);
      }
      const prepared = input.preparedPrompt;
      const userInput = {
        content: await hydrateFrozenUserContent(
          input.preparedTurn.frozenUserContent,
          input.preparedTurn.attachmentManifest,
          input.importedAttachments,
        ),
      };
      await agentOrchestrator.sendProfileMessage(
        conversationAgentId,
        input.rawMessage,
        {
          sessionId: input.context.session?.sessionId,
          runId: isActiveRun(input.context.currentRun) ? input.context.currentRun.runId : undefined,
          turnId: assistantMessage.turnId,
          stage: 'investigate',
          projectRootPath: prepared.projectRootPath,
          projectId: input.context.projectId,
          systemPrompt: prepared.promptPlan.systemPrompt,
          promptPlan: prepared.promptPlan,
          signal: abortController.signal,
          turnControls,
          requestPlan: planning.plan,
          preparedTurn: input.preparedTurn,
          userContent: userInput.content,
          visibleTurnIds: prepared.visibleTurnIds,
          activeBranchId: assistantMessage.branchId ?? input.userMessage.branchId ?? ROOT_BRANCH_ID,
          onTerminalContext: (result) => {
            terminalContext.value = {
              messages: result.messages,
              executionIdentity: result.executionIdentity,
              status: result.status,
            };
            terminalHandoff = result.pendingHandoff ?? null;
          },
          onEvent: createAgentEventHandler({
            host, sessionId, input, agentLabel, turnStreamState,
            commitAssistantMessage, commitVisibleAssistantText, commitThinkingTrace,
            beginAssistantContentLoop, markProcessEvidence, markLoopCommentary,
            currentLoopId, resolveStreamingOutputPhase, syncVisibleResponseForStreaming,
            seenCompactionSummaries, showWorkTrace, withWorkTrace, recordProviderOutputRefs,
            currentLoopOptions, pendingContinuation,
            hasPendingContinuation: () => Boolean(hasPendingContinuation()),
          }),
        },
      );

      requireCanonicalFinalAnswer(canonicalOutput);
    } catch (error) {
      llmDiagnostic = createTurnFailedDiagnostic(routePreflight, error);
      errorViewModel = {
        code: llmDiagnostic.code,
        message: llmDiagnostic.userMessage,
        technicalMessage: llmDiagnostic.technicalMessage,
      };
      visibleResponse = llmDiagnostic.userMessage;
      currentLoopText = llmDiagnostic.userMessage;
      recordLlmDiagnostic(input.context, llmDiagnostic);
      commitVisibleAssistantText();
    }

  if (abortController.signal.aborted || runWasCancelled) return;
  const assistantContent = llmDiagnostic
    ? llmDiagnostic.userMessage.trim()
    : requireCanonicalFinalAnswer(canonicalOutput);
  visibleResponse = assistantContent;
  const isRouteMissingDiagnostic = llmDiagnostic?.code === 'CONVERSATION_LLM_ROUTE_MISSING';
  const finalStatus: ConversationMessage['status'] = runWasCancelled
    ? 'stopped'
    : errorViewModel && !isRouteMissingDiagnostic
      ? 'error'
      : 'complete';
  const traceStatus: ConversationWorkTrace['status'] = runWasCancelled
    ? 'stopped'
    : errorViewModel && !isRouteMissingDiagnostic
      ? 'error'
      : 'complete';

  if (abortController.signal.aborted || runWasCancelled) return;

  const outputSummary = llmDiagnostic
    ? llmDiagnostic.code === 'CONVERSATION_LLM_ROUTE_MISSING'
      ? 'Model route unavailable; configuration diagnostic returned.'
      : llmDiagnostic.code === 'CONVERSATION_AGENT_LOOP_STALLED'
        ? 'Agent loop stopped after three identical tool rounds.'
        : llmDiagnostic.code === 'CONVERSATION_AGENT_TURN_LIMIT_EXCEEDED'
          ? 'Agent loop stopped at the configured turn limit.'
          : llmDiagnostic.code === 'CONVERSATION_PROVIDER_STREAM_PROTOCOL_VIOLATION'
            ? 'Provider stream protocol integrity check failed.'
            : 'Model request failed; diagnostic recorded.'
    : 'Final answer generated.';

  const traceWithOutput = upsertWorkBlock(assistantMessage.workTrace, 'assistant-output', {
    kind: 'output',
    status: finalStatus === 'error' ? 'error' : 'complete',
    summary: outputSummary,
    completedAt: nowMs(),
  });
  const traceWithEvidence = attachToolExecutionEvidence(traceWithOutput);
  const terminalSummary = (traceWithEvidence.toolEvidence?.total ?? 0) > 0
    ? undefined
    : llmDiagnostic
      ? finalStatus === 'error'
        ? '回复失败'
        : '等待模型配置'
      : '回复已完成';

  commitTerminalAssistantMessage(finalStatus === 'error' ? 'message_errored' : 'message_completed', {
    status: finalStatus,
    content: assistantContent,
    diagnostic: llmDiagnostic,
    ...withWorkTrace(finalizeTrace(
      traceWithEvidence,
      traceStatus,
      terminalSummary,
    )),
  });
  const handoff = terminalHandoff as import('../workflow/debugger/TurnCoordinator').PendingHandoff | null;
  const frozenPlan = input.preparedTurn.runtime.effectivePlan;
  const handoffTargetAllowed = (target: string): boolean => frozenPlan.enabledProfileIds.includes(target)
    && (frozenPlan.profileHandoffs.length === 0 || frozenPlan.profileHandoffs.some((declared) => declared.agent === target));
  if (
    finalStatus !== 'error'
    && input.context.session
    && handoff
    && handoff.turnId === assistantMessage.turnId
    && handoff.sessionId === input.context.session.sessionId
    && handoff.toProfile
    && handoffTargetAllowed(handoff.toProfile)
  ) {
    host.setPendingHandoff(input.context.session.sessionId, {
      toProfile: handoff.toProfile,
      prompt: handoff.prompt,
    });
    host.emitConversationEvent({
      type: 'agent_event',
      sessionId: input.context.session.sessionId,
      turnId: assistantMessage.turnId,
      event: {
        id: generateEventId('agent-event'),
        type: 'handoff.requested',
        timestamp: nowMs(),
        sessionId: input.context.session.sessionId,
        agentId: handoff.fromAgentId,
        payload: {
          fromAgentId: handoff.fromAgentId,
          toProfile: handoff.toProfile,
          prompt: handoff.prompt,
          label: handoff.label,
        },
      },
    });
  }

  } finally {
    if (abortController.signal.aborted && !conversationPersistenceError && assistantMessage.status === 'streaming') {
      try {
        commitStoppedMessage();
      } catch (error) {
        console.error('[ConversationService] terminal stop commit failed:', error);
      }
    }
    if (sessionId && deferredTerminalEventType && !conversationPersistenceError) {
      const terminalStatus = assistantMessage.status === 'stopped'
        ? 'stopped'
        : assistantMessage.status === 'error'
          ? 'error'
          : 'complete';
      const capturedContext = terminalContext.value ?? {
        executionIdentity: planning.plan.executionIdentity,
        status: terminalStatus,
        messages: [
          {
            role: 'user' as const,
            content: input.rawMessage,
            timestamp: input.userMessage.createdAt,
          },
          {
            role: 'assistant' as const,
            content: assistantMessage.content
              ? [{ type: 'text' as const, text: assistantMessage.content }]
              : [],
            model: planning.plan.effectiveModelId,
            provider: planning.plan.providerId,
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            stopReason: terminalStatus === 'stopped' ? 'aborted' as const : terminalStatus === 'error' ? 'error' as const : 'stop' as const,
            timestamp: assistantMessage.updatedAt ?? nowMs(),
          },
        ],
      };
      try {
        host.assertTerminalContextOwnership(
          sessionId,
          assistantMessage.turnId,
          input.userMessage.id,
          assistantMessage.id,
          capturedBranchId,
        );
        const contextEntry = canonicalizeSessionContextTurnEntry({
          schemaVersion: 2,
          turnId: assistantMessage.turnId,
          userMessageId: input.userMessage.id,
          assistantMessageId: assistantMessage.id,
          branchId: capturedBranchId,
          agentId: conversationAgentId,
          executionIdentity: capturedContext.executionIdentity,
          controls: turnControls ?? { reasoningLevel: 'off', maxContextMode: false, fastModel: false },
          status: terminalStatus === 'complete' ? capturedContext.status : terminalStatus,
          messages: capturedContext.messages,
          createdAt: input.userMessage.createdAt,
          completedAt: assistantMessage.updatedAt ?? nowMs(),
        });
        storageAdapter.commitConversationTerminal(
          sessionId,
          input.requestId,
          assistantMessage.turnId,
          assistantMessage,
          contextEntry,
        );
        host.emitConversationEvent({
          type: deferredTerminalEventType,
          sessionId,
          turnId: assistantMessage.turnId,
          message: assistantMessage,
        } as ConversationStreamEvent);
        host.publishConversationTrace(traceSessionId, [input.userMessage, assistantMessage], sessionId);
      } catch (error) {
        console.error(`[ConversationService] Terminal transaction failed for ${assistantMessage.turnId}:`, error);
        assistantMessage = {
          ...assistantMessage,
          status: 'error',
          diagnostic: {
            code: 'CONVERSATION_LLM_REQUEST_FAILED',
            severity: 'error',
            userMessage: 'Conversation state could not be committed. Restart before continuing.',
            technicalMessage: error instanceof Error ? error.message : String(error),
          },
          updatedAt: nowMs(),
        };
        host.emitConversationEvent({
          type: 'message_errored',
          sessionId,
          turnId: assistantMessage.turnId,
          message: assistantMessage,
        });
        host.publishConversationTrace(traceSessionId, [input.userMessage, assistantMessage], sessionId);
      }
    }
    host.clearActiveTurn(assistantMessage.turnId, abortController);
    const ownedRun = input.context.currentRun;
    if (sessionId && isActiveRun(ownedRun)) {
      const terminalRunStatus = assistantMessage.status === 'stopped'
        ? 'cancelled'
        : assistantMessage.status === 'error'
          ? 'failed'
          : 'completed';
      try {
        await storageAdapter.updateRun(sessionId, ownedRun.runId, {
          status: terminalRunStatus,
          finishedAt: nowMs(),
          lastStage: 'finalize',
          runtime: { workflow_stage: 'finalize' },
        });
      } catch (error) {
        console.error(`[ConversationService] Failed to finalize run ${ownedRun.runId}:`, error);
      }
    }
    await input.preparedTurn.runtime.mcpLease?.release();
    agentOrchestrator.releaseProviderRuntimeCredentials(input.preparedTurn.runtime.credentialHandle);
    settleStopped();
  }
}
