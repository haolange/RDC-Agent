import { ROOT_BRANCH_ID } from '@shared/types/conversationBranch';
import { buildMessageUpdateEvent, type MessageUpdateType } from '@shared/conversation/messageUpdateEvent';
import { nowMs } from '@shared/utils/id';
import { isHandoffOfferedAtTurnEnd } from '@shared/types/agentManifest';
import { AppError } from '@shared/errors/appError';
import { agentPlanReviewRequestService } from '../agent-runtime/interactions/AgentPlanReviewRequestService';
import { agentUserInputRequestService } from '../agent-runtime/interactions/AgentUserInputRequestService';
import { agentOrchestrator } from '../agent-runtime/orchestration/agentRuntimeRoot';
import { agentToolApprovalRequestService } from '../agent-runtime/permissions/AgentToolApprovalRequestService';
import { conversationHistoryStore, sessionRecordStore } from '../sessions/store/sessionStores';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { diagnosticText } from './diagnosticText';
import { shouldSnapshotHandoffSuggestions } from './missionHandoffSuggestions';
import { canonicalizeSessionContextTurnEntry } from './SessionContextJournal';
import { ConversationStreamPatchScheduler, type ConversationStreamPatchCommitOptions } from './ConversationStreamPatchScheduler';
import { finalizeTrace, upsertWorkBlock } from './ConversationWorkTrace';
import { attachToolExecutionEvidence } from './ConversationToolEvidence';
import { beginAssistantContentLoopIfPending } from './ConversationLoopRuntimeState';
import { verifyApprovedPlanExit } from './approvedPlanExit';
import { EMPTY_CANONICAL_ASSISTANT_OUTPUT, requireCanonicalFinalAnswer } from './CanonicalAssistantOutput';
import { hydrateFrozenUserContent } from './ConversationAttachmentMaterializer';
import { createAgentEventHandler } from './ConversationTurnAgentEventHandler';
import { createTurnFailedDiagnostic } from './ConversationTurnDiagnostic';
import { reconcileTerminalToolReceipts } from './ConversationTerminalToolReceipts';
import { assertTurnRuntimeEpochs } from './TurnRuntimeEpochs';
import {
  getAgentLabel,
  isActiveRun,
  recordLlmDiagnostic,
} from './ConversationRoutePreflight';
import type { PreparedAgentTurnContext } from '../agent-runtime/orchestration/orchestratorTypes';
import type {
  ActiveConversationTurn,
  AgentRoutePreflightOk,
  PreparedConversationPrompt,
  ResolvedConversationContext,
} from './ConversationRoutePreflight';
import type { PlanReviewHandoffSuggestion } from '@shared/types/planReview';
import type { TurnCompletionReceipt } from '../agent-runtime/agent/TurnCompletionValidator';
import type { ConversationLoopContinuationState } from '@shared/conversation/loopOutputPhase';
import type { Message as AgentRuntimeMessage } from '../agent-runtime/core/types';
import type { RunSummary, SessionAttachmentRecord } from '@shared/types/session';
import type { ProviderOutputRef } from '@shared/types/reasoning';
import type { ExecutionIdentity, RequestPlan } from '@shared/types/providerCapability';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type { AgentRole } from '@shared/types/agent';
import type {
  ConversationLoopOutputPhase,
  ConversationMessage,
  ConversationMessageDiagnostic,
  ConversationStreamEvent,
  ConversationTurnResult,
  ConversationWorkTrace,
} from '@shared/types/conversation';

export interface CompleteProfileTurnInput {
    context: ResolvedConversationContext;
    requestedProfileId: string;
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
    policyBudget?: import('../agent-runtime/orchestration/TurnCoordinator').PolicyBudgetState;
  }

export interface ConversationTurnRunnerHost {
  persistConversationSnapshot(sessionId: string | null | undefined, message: ConversationMessage): Error | null;
  emitConversationEvent(event: ConversationStreamEvent): void;
  publishRunStatus(sessionId: string, runId: string, status: RunSummary['status']): void;
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
    sessionRecordStore.updateSession(sessionId, { turnControls });
  }

  let streamScheduler: ConversationStreamPatchScheduler | null = null;
  let conversationPersistenceError: Error | null = null;
  let deferredTerminalEventType: MessageUpdateType | null = null;
  let lastTracePublishedAt = 0;
  const TRACE_PUBLISH_MIN_INTERVAL_MS = 160;
  const terminalContext: { value: {
    messages: AgentRuntimeMessage[];
    executionIdentity: ExecutionIdentity;
    status: 'complete' | 'stopped' | 'error';
    completionReceipt?: TurnCompletionReceipt;
    completionDeclaration?: import('../agent-runtime/orchestration/TurnCoordinator').TurnCompletionDeclaration | null;
  } | null } = { value: null };
  let approvedPlanExit = false;
  /** Set when the kernel reports cancellation (timeout or parent abort) without a session Stop. */
  let runWasCancelled = false;

  const applyAssistantMessagePatch = (
    type: MessageUpdateType,
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
          workTrace: finalizeTrace(assistantMessage.workTrace, 'error', diagnosticText('sessionStateSaveFailed')),
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
      host.emitConversationEvent(buildMessageUpdateEvent(type, sessionId, assistantMessage));
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
    type: MessageUpdateType,
    patch: Partial<ConversationMessage>,
    options: Partial<ConversationStreamPatchCommitOptions> = {},
  ) => {
    streamScheduler?.commitImmediate(type, patch, options);
  };

  const commitTerminalAssistantMessage = (
    type: MessageUpdateType,
    patch: Partial<ConversationMessage>,
  ) => {
    if (sessionId) deferredTerminalEventType = type;
    streamScheduler?.commitTerminal(
      type,
      patch,
      // Emit terminal UI immediately so Browser QA / renderer do not stay on Working
      // if the deferred finally SSE event is dropped. Disk atomicity remains in finally.
      sessionId ? { persist: false, publishTrace: true, emit: true } : undefined,
    );
  };

  const commitStoppedMessage = () => {
    agentUserInputRequestService.cancelTurn(assistantMessage.turnId);
    agentPlanReviewRequestService.cancelTurn(assistantMessage.turnId);
    agentToolApprovalRequestService.cancelTurn(assistantMessage.turnId);
    const stoppedTrace = reconcileTerminalToolReceipts(
      assistantMessage.workTrace, terminalContext.value?.messages ?? [], input.userMessage.createdAt,
    );
    commitTerminalAssistantMessage('message_completed', {
      status: 'stopped',
      content: assistantMessage.content,
      workTrace: finalizeTrace(stoppedTrace, 'stopped'),
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
    assistantMessage = { ...assistantMessage, workTrace };
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
  let loopSeq = 1;
  let loopHasTools = false;
  let pendingNewLoop = false;
  let currentLoopOutputPhase: ConversationLoopOutputPhase | undefined;
  const pendingContinuation: ConversationLoopContinuationState = {
    approval: false,
    userInput: false,
    planReview: false,
    handoff: false,
  };
  const markLoopCommentary = () => {
    // Commentary evidence is monotonic within a loop. Final-answer phase is
    // assigned only by assistant.completed after the stop reason is known.
    currentLoopOutputPhase = 'commentary';
  };
  const resolveStreamingOutputPhase = (): ConversationLoopOutputPhase | undefined => {
    return currentLoopOutputPhase;
  };
  let errorViewModel: ConversationTurnResult['errorViewModel'] = null;
  let llmDiagnostic: ConversationMessageDiagnostic | null = null;
  const seenCompactionSummaries = new Set<string>();
  const turnStreamState = {} as import('./ConversationTurnAgentEventHandler').TurnStreamState;
  Object.defineProperty(turnStreamState, 'currentLoopText', { get: () => currentLoopText, set: (value) => { currentLoopText = value; } });
  Object.defineProperty(turnStreamState, 'currentLoopProviderOutputRefs', { get: () => currentLoopProviderOutputRefs, set: (value) => { currentLoopProviderOutputRefs = value; } });
  Object.defineProperty(turnStreamState, 'loopHasTools', { get: () => loopHasTools, set: (value) => { loopHasTools = value; } });
  Object.defineProperty(turnStreamState, 'runWasCancelled', { get: () => runWasCancelled, set: (value) => { runWasCancelled = value; } });
  Object.defineProperty(turnStreamState, 'loopSeq', { get: () => loopSeq, set: (value) => { loopSeq = value; } });
  Object.defineProperty(turnStreamState, 'pendingNewLoop', { get: () => pendingNewLoop, set: (value) => { pendingNewLoop = value; } });
  Object.defineProperty(turnStreamState, 'currentLoopOutputPhase', { get: () => currentLoopOutputPhase, set: (value) => { currentLoopOutputPhase = value; } });
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
    loopProviderOutputRefs: currentLoopProviderOutputRefs,
  });
  const beginAssistantContentLoop = () => {
    const previousLoopSeq = loopSeq;
    const next = beginAssistantContentLoopIfPending({
      loopSeq,
      currentLoopText,
      loopHasTools,
      pendingNewLoop,
      visibleResponse,
    });
    loopSeq = next.loopSeq;
    currentLoopText = next.currentLoopText;
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
        throw new AppError('MODEL_UNAVAILABLE', `${routePreflight.providerId}/${routePreflight.modelId}`);
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
          requestId: input.requestId,
          projectRootPath: prepared.projectRootPath,
          projectId: input.context.projectId,
          systemPrompt: prepared.promptPlan.systemPrompt,
          promptPlan: prepared.promptPlan,
          signal: abortController.signal,
          turnControls,
          requestPlan: planning.plan,
          preparedTurn: input.preparedTurn,
          allowInformationalReply: input.userMessage.planReference?.intent !== 'execute',
          userContent: userInput.content,
          visibleTurnIds: prepared.visibleTurnIds,
          activeBranchId: assistantMessage.branchId ?? input.userMessage.branchId ?? ROOT_BRANCH_ID,
          policyBudget: input.policyBudget,
          beforeProviderRequestMessages: sessionId
            ? () => agentOrchestrator.backgroundSubagents.beforeParentProviderRequestMessages(sessionId)
            : undefined,
          onTerminalContext: (result) => {
            terminalContext.value = {
              messages: result.messages,
              executionIdentity: result.executionIdentity,
              status: result.status,
              completionReceipt: result.completionReceipt,
              completionDeclaration: result.completionDeclaration,
            };
            approvedPlanExit = result.status === 'complete' && verifyApprovedPlanExit(sessionId, assistantMessage.turnId, result.approvedPlan);
          },
          onEvent: createAgentEventHandler({
            host, sessionId, input, agentLabel, turnStreamState,
            commitAssistantMessage, commitThinkingTrace,
            beginAssistantContentLoop, markLoopCommentary,
            currentLoopId, resolveStreamingOutputPhase,
            seenCompactionSummaries, showWorkTrace, withWorkTrace, recordProviderOutputRefs,
            currentLoopOptions, pendingContinuation,
          }),
        },
      );

      const receipt = terminalContext.value?.completionReceipt;
      if (terminalContext.value?.status !== 'complete' || !receipt
        || receipt.turnId !== assistantMessage.turnId) {
        throw new AppError('TURN_COMPLETION_RECEIPT_INVALID', 'the owning Agent turn did not confirm completion.');
      }
      assertTurnRuntimeEpochs({ sessionId, turnId: assistantMessage.turnId,
        initialFingerprint: input.preparedTurn.runtime.effectivePlan.fingerprint, receipt,
        offer: input.preparedTurn.runtime.approvedExecution?.offer });
      canonicalOutput = { finalAnswerText: receipt.finalAnswerText };
      if (!approvedPlanExit) requireCanonicalFinalAnswer(canonicalOutput);
    } catch (error) {
      // A user stop, policy timeout or parent abort can reject the provider call.
      // The terminal stop commit owns the visible message and trace in that case.
      if (abortController.signal.aborted) return;
      if (terminalContext.value?.status === 'stopped') {
        runWasCancelled = true;
        return;
      }
      llmDiagnostic = createTurnFailedDiagnostic(routePreflight, error);
      errorViewModel = {
        code: llmDiagnostic.code,
        message: llmDiagnostic.userMessage,
        technicalMessage: llmDiagnostic.technicalMessage,
      };
      visibleResponse = llmDiagnostic.userMessage;
      currentLoopText = llmDiagnostic.userMessage;
      recordLlmDiagnostic(input.context, llmDiagnostic);
      // The failure text is the message body (with the error tag); Working keeps only the steps that ran.
      commitVisibleAssistantText();
    }

  if (abortController.signal.aborted || runWasCancelled) return;
  const assistantContent = llmDiagnostic
    ? llmDiagnostic.userMessage.trim()
    : approvedPlanExit ? '' : requireCanonicalFinalAnswer(canonicalOutput);
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
        ? 'Agent loop stopped after no progress.'
        : llmDiagnostic.code === 'CONVERSATION_AGENT_TURN_LIMIT_EXCEEDED'
          ? 'Agent loop stopped at the configured turn limit.'
          : llmDiagnostic.code === 'CONVERSATION_TASK_COMPLETION_DENIED'
            ? 'An unfinished direct Task prevented turn completion.'
          : llmDiagnostic.code === 'CONVERSATION_PROVIDER_STREAM_PROTOCOL_VIOLATION'
            ? 'Provider stream protocol integrity check failed.'
            : llmDiagnostic.code === 'MISSION_COMPLETION_DENIED'
              ? 'Mission completion contract was not satisfied.'
            : 'Model request failed; diagnostic recorded.'
    : approvedPlanExit ? 'Plan approved; declared handoff ready.' : 'Final answer generated.';

  const traceWithOutput = approvedPlanExit && assistantMessage.workTrace ? assistantMessage.workTrace : upsertWorkBlock(assistantMessage.workTrace, 'assistant-output', {
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
        ? diagnosticText('turnFailed')
        : diagnosticText('turnWaitingModel')
      : diagnosticText('turnCompleted');

  const handoffSuggestions: PlanReviewHandoffSuggestion[] | undefined =
    shouldSnapshotHandoffSuggestions({
      agentId: conversationAgentId,
      finalStatus,
      workTrace: traceWithEvidence,
    })
      ? (input.preparedTurn.runtime.effectivePlan.profileHandoffs ?? [])
        .filter((handoff) => isHandoffOfferedAtTurnEnd(handoff) && handoff.label.trim() && handoff.agent.trim())
        .map((handoff) => ({
          label: handoff.label.trim(),
          ...(handoff.labelTranslations ? { labelTranslations: { ...handoff.labelTranslations } } : {}),
          agent: handoff.agent.trim(),
          prompt: handoff.prompt,
          send: handoff.send === true,
        }))
      : undefined;
  commitTerminalAssistantMessage(finalStatus === 'error' ? 'message_errored' : 'message_completed', {
    status: finalStatus,
    content: assistantContent,
    diagnostic: llmDiagnostic,
    ...(handoffSuggestions && handoffSuggestions.length > 0 ? { handoffSuggestions } : {}),
    ...withWorkTrace(finalizeTrace(
      traceWithEvidence,
      traceStatus,
      terminalSummary,
    )),
  });

  } finally {
    const cancelled = abortController.signal.aborted || runWasCancelled;
    if (cancelled && !conversationPersistenceError && assistantMessage.status === 'streaming') {
      try {
        commitStoppedMessage();
      } catch (error) {
        console.error('[ConversationService] terminal stop commit failed:', error);
      }
    }
    streamScheduler?.close();
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
          ...(terminalStatus === 'complete' && capturedContext.status === 'complete'
            && terminalContext.value?.completionDeclaration?.disposition === 'completed'
            && input.preparedTurn.runtime.approvedExecution ? {
              approvedExecutionCompletion: {
                ...(input.preparedTurn.runtime.approvedExecution.offer.offerId
                  ? { offerId: input.preparedTurn.runtime.approvedExecution.offer.offerId } : {}),
                planUri: input.preparedTurn.runtime.approvedExecution.offer.plan.uri,
                planHash: input.preparedTurn.runtime.approvedExecution.offer.plan.hash,
              },
            } : {}),
        });
        conversationHistoryStore.commitConversationTerminal(
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
        await sessionRecordStore.updateRun(sessionId, ownedRun.runId, {
          status: terminalRunStatus,
          finishedAt: nowMs(),
        });
        host.publishRunStatus(sessionId, ownedRun.runId, terminalRunStatus);
      } catch (error) {
        console.error(`[ConversationService] Failed to finalize run ${ownedRun.runId}:`, error);
      }
    }
    await input.preparedTurn.runtime.mcpLease?.release();
    agentOrchestrator.releaseProviderRuntimeCredentials(input.preparedTurn.runtime.credentialHandle);
    settleStopped();
  }
}
