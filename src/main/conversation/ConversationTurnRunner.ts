import { ROOT_BRANCH_ID } from '@shared/types/conversationBranch';
import { buildMessageUpdateEvent, type MessageUpdateType } from '@shared/conversation/messageUpdateEvent';
import { nowMs } from '@shared/utils/id';
import { AppError } from '@shared/errors/appError';
import { isHandoffOfferedAtTurnEnd } from '../agent-runtime/interactions/handoffSurface';
import { agentPlanReviewRequestService } from '../agent-runtime/interactions/AgentPlanReviewRequestService';
import { agentUserInputRequestService } from '../agent-runtime/interactions/AgentUserInputRequestService';
import { agentOrchestrator } from '../agent-runtime/orchestration/agentRuntimeRoot';
import { agentToolApprovalRequestService } from '../agent-runtime/permissions/AgentToolApprovalRequestService';
import { conversationHistoryStore, sessionRecordStore } from '../sessions/store/sessionStores';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { canonicalizeSessionContextTurnEntry } from '../agent-runtime/context/SessionContextJournal';
import { finalizeTrace, upsertWorkBlock } from '../agent-runtime/workTrace/ConversationWorkTrace';
import { hydrateFrozenUserContent } from '../agent-runtime/attachments/ConversationAttachmentMaterializer';
import { diagnosticText } from './diagnosticText';
import { shouldSnapshotHandoffSuggestions } from './missionHandoffSuggestions';
import { ConversationStreamPatchScheduler, type ConversationStreamPatchCommitOptions } from './ConversationStreamPatchScheduler';
import { attachToolExecutionEvidence } from './ConversationToolEvidence';
import { beginAssistantContentLoopIfPending } from './ConversationLoopRuntimeState';
import { verifyApprovedPlanExit } from './approvedPlanExit';
import { EMPTY_CANONICAL_ASSISTANT_OUTPUT, requireCanonicalFinalAnswer } from './CanonicalAssistantOutput';
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
import type { AgentEventTurn, TurnStreamState } from './ConversationTurnAgentEventHandler';
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

/** How a running turn reaches the renderer, the trace projection and the session files (`conversationTurnOutput`). */
export interface ConversationTurnOutput {
  persistConversationSnapshot(sessionId: string | null | undefined, message: ConversationMessage): Error | null;
  emitConversationEvent(event: ConversationStreamEvent): void;
  publishRunStatus(sessionId: string, runId: string, status: RunSummary['status']): void;
  publishConversationTrace(traceSessionId: string, messages: ConversationMessage[], persistedSessionId?: string | null): void;
  assertTerminalContextOwnership(
    sessionId: string,
    turnId: string,
    userMessageId: string,
    assistantMessageId: string,
    branchId: string,
  ): void;
  ephemeralTraceSessionId(turnId: string): string;
}

/** The conversation's registry of running turns (ConversationService). */
export interface ActiveConversationTurns {
  registerActiveTurn(turn: ActiveConversationTurn): void;
  clearActiveTurn(turnId: string, controller: AbortController): void;
}

export interface ConversationTurnRunnerHost {
  output: ConversationTurnOutput;
  turns: ActiveConversationTurns;
}

/** The provider-facing context the owning Agent turn reported at its end. */
interface TurnTerminalContext {
  messages: AgentRuntimeMessage[];
  executionIdentity: ExecutionIdentity;
  status: 'complete' | 'stopped' | 'error';
  completionReceipt?: TurnCompletionReceipt;
  completionDeclaration?: import('../agent-runtime/orchestration/TurnCoordinator').TurnCompletionDeclaration | null;
}

const TRACE_PUBLISH_MIN_INTERVAL_MS = 160;

/**
 * One running conversation turn: the assistant message and its stream state, the patch scheduler that persists and
 * publishes it, and the phases that run the Agent turn and commit its terminal state.
 */
class ConversationTurnCompletion implements AgentEventTurn, TurnStreamState {
  readonly host: ConversationTurnOutput;
  readonly sessionId: string | null;
  readonly traceSessionId: string;
  readonly abortController = new AbortController();
  readonly conversationAgentId: AgentRole;
  readonly capturedBranchId: string;
  readonly agentLabel: string;
  readonly seenCompactionSummaries = new Set<string>();
  readonly pendingContinuation: ConversationLoopContinuationState = {
    approval: false,
    userInput: false,
    planReview: false,
    handoff: false,
  };
  assistantMessage: ConversationMessage;
  visibleResponse = '';
  canonicalOutput = EMPTY_CANONICAL_ASSISTANT_OUTPUT;
  // Assistant turns are split into LLM loop turns. The loop result is model output;
  currentLoopText = '';
  currentLoopProviderOutputRefs: ProviderOutputRef[] = [];
  loopSeq = 1;
  loopHasTools = false;
  pendingNewLoop = false;
  currentLoopOutputPhase: ConversationLoopOutputPhase | undefined;
  errorViewModel: ConversationTurnResult['errorViewModel'] = null;
  llmDiagnostic: ConversationMessageDiagnostic | null = null;
  terminalContext: TurnTerminalContext | null = null;
  approvedPlanExit = false;
  /** Set when the kernel reports cancellation (timeout or parent abort) without a session Stop. */
  runWasCancelled = false;
  private streamScheduler: ConversationStreamPatchScheduler | null = null;
  private conversationPersistenceError: Error | null = null;
  private deferredTerminalEventType: MessageUpdateType | null = null;
  private lastTracePublishedAt = 0;
  private settleStopped = () => {};

  constructor(private readonly turns: ActiveConversationTurns, output: ConversationTurnOutput, readonly input: CompleteProfileTurnInput) {
    this.host = output;
    this.assistantMessage = input.assistantDraftMessage;
    this.sessionId = input.context.session?.sessionId ?? null;
    this.traceSessionId = this.sessionId ?? output.ephemeralTraceSessionId(input.assistantDraftMessage.turnId);
    this.conversationAgentId = input.requestedAgentId;
    this.capturedBranchId = input.assistantDraftMessage.branchId
      ?? input.userMessage.branchId
      ?? ROOT_BRANCH_ID;
    this.agentLabel = getAgentLabel(this.conversationAgentId);
  }

  get turnStreamState(): TurnStreamState {
    return this;
  }

  get turnControls(): ConversationTurnControls {
    return this.input.planning.controls;
  }

  /** Persists the turn controls, starts the patch scheduler and registers the turn so Stop can reach it. */
  begin(): void {
    if (this.sessionId && this.turnControls) {
      sessionRecordStore.updateSession(this.sessionId, { turnControls: this.turnControls });
    }
    this.streamScheduler = new ConversationStreamPatchScheduler({
      commit: ({ type, patch, options }) => this.applyAssistantMessagePatch(type, patch, options),
    });
    const stopped = new Promise<void>((resolve) => {
      this.settleStopped = resolve;
    });
    this.turns.registerActiveTurn({
      requestId: this.input.requestId,
      turnId: this.assistantMessage.turnId,
      sessionId: this.sessionId,
      startedAt: nowMs(),
      abortController: this.abortController,
      stopped,
      stop: () => {
        if (!this.abortController.signal.aborted) {
          try {
            // Persist pending deltas without broadcasting streaming patches; the
            // terminal stopped commit is the single authoritative UI transition.
            this.streamScheduler?.flushPending({ forcePersist: true, publishTrace: false, emit: false });
          } catch (error) {
            console.error('[ConversationService] stop flush failed:', error);
          }
          this.abortController.abort();
        }
      },
    });
  }

  logAliasRemap(): void {
    const { routePreflight, context } = this.input;
    if (!routePreflight.aliasRemap) return;
    runtimeLogService.log({
      scope: this.sessionId ? 'session' : 'app',
      namespace: 'llm',
      severity: 'info',
      title: 'Canonical model alias remap',
      summary: `${routePreflight.providerId}/${routePreflight.aliasRemap.from} -> ${routePreflight.aliasRemap.to}`,
      sessionId: this.sessionId,
      projectId: context.projectId,
      runId: isActiveRun(context.currentRun) ? context.currentRun.runId : null,
      raw: routePreflight.aliasRemap,
    });
  }

  /** Runs the owning Agent turn; false when a stop or a kernel cancellation owns the terminal state instead. */
  async runAgentTurn(): Promise<boolean> {
    try {
      await this.sendPreparedTurn();
      this.acceptCompletionReceipt();
    } catch (error) {
      // A user stop, policy timeout or parent abort can reject the provider call.
      // The terminal stop commit owns the visible message and trace in that case.
      if (this.abortController.signal.aborted) return false;
      if (this.terminalContext?.status === 'stopped') {
        this.runWasCancelled = true;
        return false;
      }
      this.recordTurnFailure(error);
    }
    return !(this.abortController.signal.aborted || this.runWasCancelled);
  }

  private async sendPreparedTurn(): Promise<void> {
    const { input, sessionId } = this;
    const { routePreflight } = input;
    if (!input.preparedTurn.effectiveModel) {
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
    await agentOrchestrator.sendProfileMessage({
      agentId: this.conversationAgentId,
      content: input.rawMessage,
      sessionId: input.context.session?.sessionId,
      runId: isActiveRun(input.context.currentRun) ? input.context.currentRun.runId : undefined,
      turnId: this.assistantMessage.turnId,
      requestId: input.requestId,
      projectRootPath: prepared.projectRootPath,
      projectId: input.context.projectId,
      systemPrompt: prepared.promptPlan.systemPrompt,
      promptPlan: prepared.promptPlan,
      signal: this.abortController.signal,
      turnControls: this.turnControls,
      requestPlan: input.planning.plan,
      preparedTurn: input.preparedTurn,
      allowInformationalReply: input.userMessage.planReference?.intent !== 'execute',
      userContent: userInput.content,
      visibleTurnIds: prepared.visibleTurnIds,
      activeBranchId: this.assistantMessage.branchId ?? input.userMessage.branchId ?? ROOT_BRANCH_ID,
      policyBudget: input.policyBudget,
      beforeProviderRequestMessages: sessionId
        ? () => agentOrchestrator.backgroundSubagents.beforeParentProviderRequestMessages(sessionId)
        : undefined,
      onTerminalContext: (result) => {
        this.terminalContext = {
          messages: result.messages,
          executionIdentity: result.executionIdentity,
          status: result.status,
          completionReceipt: result.completionReceipt,
          completionDeclaration: result.completionDeclaration,
        };
        this.approvedPlanExit = result.status === 'complete'
          && verifyApprovedPlanExit(sessionId, this.assistantMessage.turnId, result.approvedPlan);
      },
      onEvent: createAgentEventHandler(this),
    });
  }

  /** The owning Agent turn must confirm completion with a receipt for this turn and the same runtime epochs. */
  private acceptCompletionReceipt(): void {
    const receipt = this.terminalContext?.completionReceipt;
    if (this.terminalContext?.status !== 'complete' || !receipt
      || receipt.turnId !== this.assistantMessage.turnId) {
      throw new AppError('TURN_COMPLETION_RECEIPT_INVALID', 'the owning Agent turn did not confirm completion.');
    }
    assertTurnRuntimeEpochs({ sessionId: this.sessionId, turnId: this.assistantMessage.turnId,
      initialFingerprint: this.input.preparedTurn.runtime.effectivePlan.fingerprint, receipt,
      offer: this.input.preparedTurn.runtime.approvedExecution?.offer });
    this.canonicalOutput = { finalAnswerText: receipt.finalAnswerText };
    if (!this.approvedPlanExit) requireCanonicalFinalAnswer(this.canonicalOutput);
  }

  private recordTurnFailure(error: unknown): void {
    const llmDiagnostic = createTurnFailedDiagnostic(this.input.routePreflight, error);
    this.llmDiagnostic = llmDiagnostic;
    this.errorViewModel = {
      code: llmDiagnostic.code,
      message: llmDiagnostic.userMessage,
      technicalMessage: llmDiagnostic.technicalMessage,
    };
    this.visibleResponse = llmDiagnostic.userMessage;
    this.currentLoopText = llmDiagnostic.userMessage;
    recordLlmDiagnostic(this.input.context, llmDiagnostic);
    // The failure text is the message body (with the error tag); Working keeps only the steps that ran.
    this.commitVisibleAssistantText();
  }

  /** The terminal assistant message: the canonical final answer or the diagnostic, with the settled work trace. */
  commitOutcome(): void {
    const { llmDiagnostic } = this;
    const assistantContent = llmDiagnostic
      ? llmDiagnostic.userMessage.trim()
      : this.approvedPlanExit ? '' : requireCanonicalFinalAnswer(this.canonicalOutput);
    this.visibleResponse = assistantContent;
    const isRouteMissingDiagnostic = llmDiagnostic?.code === 'CONVERSATION_LLM_ROUTE_MISSING';
    const finalStatus: ConversationMessage['status'] = this.runWasCancelled
      ? 'stopped'
      : this.errorViewModel && !isRouteMissingDiagnostic
        ? 'error'
        : 'complete';
    const traceStatus: ConversationWorkTrace['status'] = this.runWasCancelled
      ? 'stopped'
      : this.errorViewModel && !isRouteMissingDiagnostic
        ? 'error'
        : 'complete';

    if (this.abortController.signal.aborted || this.runWasCancelled) return;

    const traceWithOutput = this.approvedPlanExit && this.assistantMessage.workTrace
      ? this.assistantMessage.workTrace
      : upsertWorkBlock(this.assistantMessage.workTrace, 'assistant-output', {
        kind: 'output',
        status: finalStatus === 'error' ? 'error' : 'complete',
        summary: outputSummary(llmDiagnostic, this.approvedPlanExit),
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
    const handoffSuggestions = this.handoffSuggestions(finalStatus, traceWithEvidence);
    this.commitTerminalAssistantMessage(finalStatus === 'error' ? 'message_errored' : 'message_completed', {
      status: finalStatus,
      content: assistantContent,
      diagnostic: llmDiagnostic,
      ...(handoffSuggestions && handoffSuggestions.length > 0 ? { handoffSuggestions } : {}),
      ...this.withWorkTrace(finalizeTrace(
        traceWithEvidence,
        traceStatus,
        terminalSummary,
      )),
    });
  }

  private handoffSuggestions(
    finalStatus: NonNullable<ConversationMessage['status']>,
    workTrace: ConversationWorkTrace,
  ): PlanReviewHandoffSuggestion[] | undefined {
    if (!shouldSnapshotHandoffSuggestions({ agentId: this.conversationAgentId, finalStatus, workTrace })) return undefined;
    return (this.input.preparedTurn.runtime.effectivePlan.profileHandoffs ?? [])
      .filter((handoff) => isHandoffOfferedAtTurnEnd(handoff) && handoff.label.trim() && handoff.agent.trim())
      .map((handoff) => ({
        label: handoff.label.trim(),
        ...(handoff.labelTranslations ? { labelTranslations: { ...handoff.labelTranslations } } : {}),
        agent: handoff.agent.trim(),
        prompt: handoff.prompt,
        send: handoff.send === true,
      }));
  }

  /** Stop commit, terminal transaction, run status and lease release, whatever ended the turn. */
  async finish(): Promise<void> {
    const cancelled = this.abortController.signal.aborted || this.runWasCancelled;
    if (cancelled && !this.conversationPersistenceError && this.assistantMessage.status === 'streaming') {
      try {
        this.commitStoppedMessage();
      } catch (error) {
        console.error('[ConversationService] terminal stop commit failed:', error);
      }
    }
    this.streamScheduler?.close();
    if (this.sessionId && this.deferredTerminalEventType && !this.conversationPersistenceError) {
      this.commitTerminalTransaction(this.sessionId, this.deferredTerminalEventType);
    }
    this.turns.clearActiveTurn(this.assistantMessage.turnId, this.abortController);
    await this.finalizeOwnedRun();
    await this.input.preparedTurn.runtime.mcpLease?.release();
    agentOrchestrator.releaseProviderRuntimeCredentials(this.input.preparedTurn.runtime.credentialHandle);
    this.settleStopped();
  }

  /** Writes the terminal message and its session-context entry in one transaction, then publishes it. */
  private commitTerminalTransaction(sessionId: string, eventType: MessageUpdateType): void {
    const { input } = this;
    const terminalStatus = this.assistantMessage.status === 'stopped'
      ? 'stopped'
      : this.assistantMessage.status === 'error'
        ? 'error'
        : 'complete';
    const capturedContext = this.terminalContext ?? this.fallbackTerminalContext(terminalStatus);
    try {
      this.host.assertTerminalContextOwnership(
        sessionId,
        this.assistantMessage.turnId,
        input.userMessage.id,
        this.assistantMessage.id,
        this.capturedBranchId,
      );
      const contextEntry = this.terminalContextEntry(terminalStatus, capturedContext);
      conversationHistoryStore.commitConversationTerminal(
        sessionId,
        input.requestId,
        this.assistantMessage.turnId,
        this.assistantMessage,
        contextEntry,
      );
      this.host.emitConversationEvent({
        type: eventType,
        sessionId,
        turnId: this.assistantMessage.turnId,
        message: this.assistantMessage,
      } as ConversationStreamEvent);
      this.host.publishConversationTrace(this.traceSessionId, [input.userMessage, this.assistantMessage], sessionId);
    } catch (error) {
      console.error(`[ConversationService] Terminal transaction failed for ${this.assistantMessage.turnId}:`, error);
      this.assistantMessage = {
        ...this.assistantMessage,
        status: 'error',
        diagnostic: {
          code: 'CONVERSATION_LLM_REQUEST_FAILED',
          severity: 'error',
          userMessage: 'Conversation state could not be committed. Restart before continuing.',
          technicalMessage: error instanceof Error ? error.message : String(error),
        },
        updatedAt: nowMs(),
      };
      this.host.emitConversationEvent({
        type: 'message_errored',
        sessionId,
        turnId: this.assistantMessage.turnId,
        message: this.assistantMessage,
      });
      this.host.publishConversationTrace(this.traceSessionId, [input.userMessage, this.assistantMessage], sessionId);
    }
  }

  /** Without a terminal context from the Agent turn, the journal records the user input and the visible reply. */
  private fallbackTerminalContext(terminalStatus: TurnTerminalContext['status']): TurnTerminalContext {
    const { input } = this;
    const { plan } = input.planning;
    return {
      executionIdentity: plan.executionIdentity,
      status: terminalStatus,
      messages: [
        {
          role: 'user' as const,
          content: input.rawMessage,
          timestamp: input.userMessage.createdAt,
        },
        {
          role: 'assistant' as const,
          content: this.assistantMessage.content
            ? [{ type: 'text' as const, text: this.assistantMessage.content }]
            : [],
          model: plan.effectiveModelId,
          provider: plan.providerId,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          stopReason: terminalStatus === 'stopped' ? 'aborted' as const : terminalStatus === 'error' ? 'error' as const : 'stop' as const,
          timestamp: this.assistantMessage.updatedAt ?? nowMs(),
        },
      ],
    };
  }

  /** The turn's session-context entry; a completed approved execution records the plan it completed. */
  private terminalContextEntry(terminalStatus: TurnTerminalContext['status'], capturedContext: TurnTerminalContext) {
    const { input } = this;
    const approvedExecution = input.preparedTurn.runtime.approvedExecution;
    return canonicalizeSessionContextTurnEntry({
      schemaVersion: 2,
      turnId: this.assistantMessage.turnId,
      userMessageId: input.userMessage.id,
      assistantMessageId: this.assistantMessage.id,
      branchId: this.capturedBranchId,
      agentId: this.conversationAgentId,
      executionIdentity: capturedContext.executionIdentity,
      controls: this.turnControls ?? { reasoningLevel: 'off', maxContextMode: false, fastModel: false },
      status: terminalStatus === 'complete' ? capturedContext.status : terminalStatus,
      messages: capturedContext.messages,
      createdAt: input.userMessage.createdAt,
      completedAt: this.assistantMessage.updatedAt ?? nowMs(),
      ...(terminalStatus === 'complete' && capturedContext.status === 'complete'
        && this.terminalContext?.completionDeclaration?.disposition === 'completed'
        && approvedExecution ? {
          approvedExecutionCompletion: {
            ...(approvedExecution.offer.offerId ? { offerId: approvedExecution.offer.offerId } : {}),
            planUri: approvedExecution.offer.plan.uri,
            planHash: approvedExecution.offer.plan.hash,
          },
        } : {}),
    });
  }

  private async finalizeOwnedRun(): Promise<void> {
    const ownedRun = this.input.context.currentRun;
    if (!this.sessionId || !isActiveRun(ownedRun)) return;
    const terminalRunStatus = this.assistantMessage.status === 'stopped'
      ? 'cancelled'
      : this.assistantMessage.status === 'error'
        ? 'failed'
        : 'completed';
    try {
      await sessionRecordStore.updateRun(this.sessionId, ownedRun.runId, {
        status: terminalRunStatus,
        finishedAt: nowMs(),
      });
      this.host.publishRunStatus(this.sessionId, ownedRun.runId, terminalRunStatus);
    } catch (error) {
      console.error(`[ConversationService] Failed to finalize run ${ownedRun.runId}:`, error);
    }
  }

  private applyAssistantMessagePatch(
    type: MessageUpdateType,
    patch: Partial<ConversationMessage>,
    options: ConversationStreamPatchCommitOptions = { persist: true, publishTrace: true, emit: true },
  ): void {
    if (this.abortController.signal.aborted && patch.status !== 'stopped') {
      return;
    }
    this.assistantMessage = {
      ...this.assistantMessage,
      ...patch,
      updatedAt: nowMs(),
    };
    if (options.persist) {
      const persistError = this.host.persistConversationSnapshot(this.sessionId, this.assistantMessage);
      if (persistError) {
        this.conversationPersistenceError ??= persistError;
        this.abortController.abort();
        this.assistantMessage = {
          ...this.assistantMessage,
          status: 'error',
          workTrace: finalizeTrace(this.assistantMessage.workTrace, 'error', diagnosticText('sessionStateSaveFailed')),
          diagnostic: {
            code: 'CONVERSATION_LLM_REQUEST_FAILED',
            severity: 'error',
            userMessage: 'Conversation state could not be saved. Retry before continuing.',
            technicalMessage: persistError.message,
          },
          updatedAt: nowMs(),
        };
        this.host.emitConversationEvent({
          type: 'message_errored',
          sessionId: this.sessionId ?? '',
          turnId: this.assistantMessage.turnId,
          message: this.assistantMessage,
        });
        this.host.publishConversationTrace(this.traceSessionId, [this.input.userMessage, this.assistantMessage], this.sessionId);
        return;
      }
    }
    if (options.emit) {
      this.host.emitConversationEvent(buildMessageUpdateEvent(type, this.sessionId, this.assistantMessage));
    }
    if (options.publishTrace) {
      const now = nowMs();
      const isTerminal = type === 'message_completed' || type === 'message_errored'
        || patch.status === 'stopped'
        || patch.status === 'complete'
        || patch.status === 'error';
      if (isTerminal || now - this.lastTracePublishedAt >= TRACE_PUBLISH_MIN_INTERVAL_MS) {
        this.lastTracePublishedAt = now;
        this.host.publishConversationTrace(this.traceSessionId, [this.input.userMessage, this.assistantMessage], this.sessionId);
      }
    }
  }

  readonly commitAssistantMessage = (
    type: MessageUpdateType,
    patch: Partial<ConversationMessage>,
    options: Partial<ConversationStreamPatchCommitOptions> = {},
  ): void => {
    this.streamScheduler?.commitImmediate(type, patch, options);
  };

  private commitTerminalAssistantMessage(type: MessageUpdateType, patch: Partial<ConversationMessage>): void {
    if (this.sessionId) this.deferredTerminalEventType = type;
    this.streamScheduler?.commitTerminal(
      type,
      patch,
      // Emit terminal UI immediately so Browser QA / renderer do not stay on Working
      // if the deferred finally SSE event is dropped. Disk atomicity remains in finally.
      this.sessionId ? { persist: false, publishTrace: true, emit: true } : undefined,
    );
  }

  private commitStoppedMessage(): void {
    agentUserInputRequestService.cancelTurn(this.assistantMessage.turnId);
    agentPlanReviewRequestService.cancelTurn(this.assistantMessage.turnId);
    agentToolApprovalRequestService.cancelTurn(this.assistantMessage.turnId);
    const stoppedTrace = reconcileTerminalToolReceipts(
      this.assistantMessage.workTrace, this.terminalContext?.messages ?? [], this.input.userMessage.createdAt,
    );
    this.commitTerminalAssistantMessage('message_completed', {
      status: 'stopped',
      content: this.assistantMessage.content,
      workTrace: finalizeTrace(stoppedTrace, 'stopped'),
    });
  }

  private commitVisibleAssistantText(): void {
    this.streamScheduler?.queueText({
      status: 'streaming',
      content: this.visibleResponse,
    });
  }

  readonly commitThinkingTrace = (workTrace: ConversationWorkTrace): void => {
    this.assistantMessage = { ...this.assistantMessage, workTrace };
    this.streamScheduler?.queueTrace({ workTrace });
  };

  private withWorkTrace(workTrace: ConversationWorkTrace): Partial<ConversationMessage> {
    return { workTrace };
  }

  /** Commentary evidence is monotonic within a loop; the final-answer phase is set by assistant.completed. */
  readonly markLoopCommentary = (): void => {
    this.currentLoopOutputPhase = 'commentary';
  };

  readonly resolveStreamingOutputPhase = (): ConversationLoopOutputPhase | undefined => this.currentLoopOutputPhase;

  readonly currentLoopId = (): string => `runtime-loop-${this.loopSeq}`;

  readonly recordProviderOutputRefs = (refs: ProviderOutputRef[] | undefined): void => {
    for (const ref of refs ?? []) {
      const duplicate = this.currentLoopProviderOutputRefs.some((candidate) => (
        candidate.protocol === ref.protocol
        && candidate.responseId === ref.responseId
        && candidate.providerBlockKey === ref.providerBlockKey
        && candidate.sourceIndex === ref.sourceIndex
        && candidate.itemId === ref.itemId
      ));
      if (!duplicate) this.currentLoopProviderOutputRefs.push({ ...ref });
    }
  };

  readonly currentLoopOptions = () => ({
    loopId: this.currentLoopId(),
    loopProviderOutputRefs: this.currentLoopProviderOutputRefs,
  });

  readonly beginAssistantContentLoop = (): void => {
    const previousLoopSeq = this.loopSeq;
    const next = beginAssistantContentLoopIfPending({
      loopSeq: this.loopSeq,
      currentLoopText: this.currentLoopText,
      loopHasTools: this.loopHasTools,
      pendingNewLoop: this.pendingNewLoop,
      visibleResponse: this.visibleResponse,
    });
    this.loopSeq = next.loopSeq;
    this.currentLoopText = next.currentLoopText;
    this.loopHasTools = next.loopHasTools;
    this.pendingNewLoop = next.pendingNewLoop;
    this.visibleResponse = next.visibleResponse;
    if (next.loopSeq !== previousLoopSeq) {
      this.currentLoopOutputPhase = undefined;
      this.currentLoopProviderOutputRefs = [];
    }
  };
}

function outputSummary(llmDiagnostic: ConversationMessageDiagnostic | null, approvedPlanExit: boolean): string {
  if (!llmDiagnostic) return approvedPlanExit ? 'Plan approved; declared handoff ready.' : 'Final answer generated.';
  switch (llmDiagnostic.code) {
    case 'CONVERSATION_LLM_ROUTE_MISSING': return 'Model route unavailable; configuration diagnostic returned.';
    case 'CONVERSATION_AGENT_LOOP_STALLED': return 'Agent loop stopped after no progress.';
    case 'CONVERSATION_AGENT_TURN_LIMIT_EXCEEDED': return 'Agent loop stopped at the configured turn limit.';
    case 'CONVERSATION_TASK_COMPLETION_DENIED': return 'An unfinished direct Task prevented turn completion.';
    case 'CONVERSATION_PROVIDER_STREAM_PROTOCOL_VIOLATION': return 'Provider stream protocol integrity check failed.';
    case 'MISSION_COMPLETION_DENIED': return 'Mission completion contract was not satisfied.';
    default: return 'Model request failed; diagnostic recorded.';
  }
}

/** Runs one committed conversation turn to its terminal state: begin, run the Agent turn, commit, finish. */
export async function completeProfileTurn(host: ConversationTurnRunnerHost, input: CompleteProfileTurnInput): Promise<void> {
  const turn = new ConversationTurnCompletion(host.turns, host.output, input);
  turn.begin();
  try {
    turn.logAliasRemap();
    if (!(await turn.runAgentTurn())) return;
    turn.commitOutcome();
  } finally {
    await turn.finish();
  }
}
