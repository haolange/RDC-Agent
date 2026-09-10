import { reconcileDelegatedInteractionRequests } from './DelegatedInteractionRecovery';
import { enforceMissionTurnCompletion } from '../investigation/missionCompletionContract';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  ConversationAttachmentInput,
  ConversationAnswerToolApprovalRequest,
  ConversationAnswerToolApprovalResult,
  ConversationAnswerUserInputRequest,
  ConversationAnswerUserInputResult,
  ConversationCancelActiveTurnRequest,
  ConversationCancelActiveTurnResult,
  ConversationMessage,
  ConversationRewriteFromMessageRequest,
  ConversationSendRequest,
  ConversationTurnResult,
} from '@shared/types/conversation';
import type {
  ConversationBranchState,
  ConversationSwitchBranchRequest,
  ConversationSwitchBranchResult,
} from '@shared/types/conversationBranch';
import type {
  ProfileHandoffCancelReason,
  ProfileHandoffState,
} from '@shared/types/profileHandoff';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type { SessionRecord } from '@shared/types/session';
import { generateEventId } from '@shared/utils/id';
import { agentOrchestrator } from '../workflow/debugger/AgentOrchestrator';
import { agentUserInputRequestService } from '../agent-runtime/interactions/AgentUserInputRequestService';
import { agentToolApprovalRequestService } from '../agent-runtime/permissions/AgentToolApprovalRequestService';
import { traceService } from '../agent-trace/TraceService';
import { replayDeviceService } from '../captures/ReplayDeviceService';
import { rdxSessionService } from '../sessions';
import { storageAdapter } from '../sessions/StorageAdapter';
import { workflowProjectionPublisher } from '../workflow/debugger/WorkflowProjectionPublisher';
import { sessionContextJournal } from './SessionContextJournal';
import {
  createDefaultBranchState,
  normalizeBranchId,
  repairConversationBranchState,
  resolveVisibleConversationMessages,
} from './ConversationBranchResolver';
import type {
  ConversationBranchTurnContext,
  ActiveConversationTurn,
  ResolvedConversationContext,
} from './ConversationRoutePreflight';
import { canonicalJson } from './ConversationRoutePreflight';
import { prepareConversationPrompt as buildConversationPrompt, type PrepareConversationPromptInput } from './ConversationPromptPreparer';
import { hashAttachmentContents } from './ConversationAttachmentHashing';
import { ConversationHandoffOps } from './ConversationHandoffOps';
import { ConversationBackgroundContinuation, type BackgroundContinuationEvent } from './ConversationBackgroundContinuation';
import { startProfileTurn as runStartProfileTurn } from './ConversationTurnStarter';
import { completeProfileTurn as runCompleteProfileTurn, type CompleteProfileTurnInput, type ConversationTurnRunnerHost } from './ConversationTurnRunner';
import {
  persistConversationSnapshot,
  assertTerminalContextOwnership,
  emitConversationEvent,
  publishConversationTrace,
  publishTraceProjection,
  ephemeralTraceSessionId,
} from './ConversationTurnTerminal';

interface ConversationContextInput extends ConversationSendRequest {
  fallbackProjectId?: string | null;
  fallbackSessionId?: string | null;
  fallbackRunId?: string | null;
}
interface ConversationRewriteContextInput extends ConversationRewriteFromMessageRequest {
  fallbackProjectId?: string | null;
  fallbackSessionId?: string | null;
  fallbackRunId?: string | null;
}
export class ConversationService {
  private acceptingTurns = true; private activeTurns = new Map<string, ActiveConversationTurn>();
  private readonly preparingRequests = new Map<string, {
    requestId: string;
    controller: AbortController;
    phase: 'preparing' | 'committing';
    scopeKey: string;
    cancelAfterCommit: boolean;
    credentialHandle?: string;
    credentialLeaseTransferred: boolean;
  }>();
  private readonly sendRequests = new Map<string, Promise<ConversationTurnResult>>();
  private readonly sendRequestFingerprints = new Map<string, string>();
  private readonly activeSendScopes = new Map<string, string>();
  private readonly backgroundContinuations = new ConversationBackgroundContinuation((event) => this.runBackgroundContinuation(event));
  private readonly handoffs = new ConversationHandoffOps({
    hasActiveTurnForSession: (sessionId) => Array.from(this.activeTurns.values()).some((turn) => turn.sessionId === sessionId),
    runIdempotentTurn: (input, operation) => this.runIdempotentTurn(input, operation),
    resolveContext: (input) => this.resolveContext(input),
    startAutoSendProfileTurn: (input) => this.startProfileTurn(
      input.context, input.agentId, input.agentId, '', [], [], undefined,
      input.turnControls, input.requestId, input.controller, undefined, input.requestFingerprint,
    ),
  });
  constructor() {
    agentOrchestrator.backgroundSubagents.onEvent = (event) => {
      if (event.type === 'settled' || event.type === 'message') {
        this.backgroundContinuations.onSettled(event);
        if (!Array.from(this.activeTurns.values()).some((turn) => turn.sessionId === event.sessionId)) this.notifySessionTurnIdle(event.sessionId);
      }
    };
  }

  stopAcceptingTurns(): void {
    this.acceptingTurns = false;
  }

  async abortAllTurns(): Promise<void> {
    for (const preparing of this.preparingRequests.values()) {
      preparing.controller.abort();
      preparing.cancelAfterCommit = true;
    }
    const active = Array.from(this.activeTurns.values());
    for (const turn of active) {
      turn.stop();
    }
    await Promise.allSettled(active.map((turn) => turn.stopped));
    await agentOrchestrator.backgroundSubagents.abortAll();
  }

  async getHistory(sessionId: string): Promise<{
    messages: ConversationMessage[];
    branchState: ConversationBranchState | null;
  }> {
    const allMessages = storageAdapter.readConversationHistory(sessionId).map((message) => {
      const recovered = reconcileDelegatedInteractionRequests(sessionId, message);
      if (recovered !== message) storageAdapter.appendConversationMessage(sessionId, recovered);
      return recovered;
    });
    const branchState = this.readRepairedBranchState(sessionId, allMessages);
    return {
      // The renderer owns visible projection and needs sibling anchors to keep
      // variant navigation concrete after refresh or session reselection.
      messages: allMessages,
      branchState,
    };
  }

  async clearHistory(sessionId: string): Promise<ConversationMessage[]> {
    this.backgroundContinuations.suppress(sessionId);
    const stopped = await this.cancelActiveTurn({ sessionId });
    if (!stopped.success) throw new Error(stopped.error || `Failed to stop session ${sessionId}.`);
    storageAdapter.writeConversationHistory(sessionId, []);
    storageAdapter.clearSessionContextState(sessionId);
    publishConversationTrace(sessionId, [], sessionId, publishTraceProjection);
    return [];
  }

  async undoLastTurn(sessionId: string): Promise<ConversationMessage[]> {
    const history = storageAdapter.readConversationHistory(sessionId);
    const lastUserMessage = history
      .slice()
      .reverse()
      .find((message) => message.role === 'user');
    if (!lastUserMessage) {
      return history;
    }

    const nextHistory = history.filter((message) => message.turnId !== lastUserMessage.turnId);
    storageAdapter.writeConversationHistory(sessionId, nextHistory);
    storageAdapter.writeSessionContextJournal(
      sessionId,
      sessionContextJournal.readEntries(sessionId).filter((entry) => entry.turnId !== lastUserMessage.turnId),
    );
    publishConversationTrace(sessionId, nextHistory, sessionId, publishTraceProjection);
    return nextHistory;
  }

  async cancelActiveTurn(
    request: ConversationCancelActiveTurnRequest = {},
  ): Promise<ConversationCancelActiveTurnResult> {
    const preparingEntry = request.requestId
      ? Array.from(this.preparingRequests.entries()).find(([, entry]) => {
        if (entry.requestId !== request.requestId) return false;
        if (request.sessionId && !entry.scopeKey.includes(request.sessionId)) return false;
        return true;
      })
      : Array.from(this.preparingRequests.entries())
          .find(([, entry]) => {
            if (request.sessionId && !entry.scopeKey.includes(request.sessionId)) return false;
            return entry.phase === 'preparing' || entry.phase === 'committing';
          });
    const preparing = preparingEntry?.[1];
    const preparingRequestId = preparing?.requestId;
    if (preparing && preparingRequestId) {
      const owningSessionId = request.sessionId
        ?? (preparing.scopeKey.startsWith('session:') ? preparing.scopeKey.slice('session:'.length) : null);
      if (owningSessionId) this.cancelUnfinishedHandoff(owningSessionId, 'user_stop');
      preparing.controller.abort();
      if (preparing.phase === 'committing') preparing.cancelAfterCommit = true;
      return {
        success: true,
        phase: preparing.phase,
        cancelledRequestId: preparingRequestId,
      };
    }
    const candidates = Array.from(this.activeTurns.values())
      .filter((turn) => !request.requestId || turn.requestId === request.requestId)
      .filter((turn) => !request.turnId || turn.turnId === request.turnId)
      .filter((turn) => !request.sessionId || turn.sessionId === request.sessionId)
      .sort((left, right) => right.startedAt - left.startedAt);
    const target = candidates[0];
    if (!target) {
      if (request.sessionId) await this.cancelUnfinishedHandoff(request.sessionId, 'user_stop');
      if (request.sessionId) {
        this.backgroundContinuations.suppress(request.sessionId);
        await agentOrchestrator.backgroundSubagents.abortSession(request.sessionId);
        return { success: true, phase: 'running' };
      }
      return { success: false, error: 'No active conversation turn.' };
    }

    await this.cancelUnfinishedHandoff(target.sessionId, 'user_stop');
    if (target.sessionId) this.backgroundContinuations.suppress(target.sessionId);
    target.stop();
    await target.stopped;
    if (target.sessionId) await agentOrchestrator.backgroundSubagents.abortSession(target.sessionId);
    return {
      success: true,
      phase: 'running',
      cancelledRequestId: target.requestId,
      cancelledTurnId: target.turnId,
    };
  }

  answerUserInput(request: ConversationAnswerUserInputRequest): ConversationAnswerUserInputResult {
    return agentUserInputRequestService.answer(request);
  }

  answerToolApproval(request: ConversationAnswerToolApprovalRequest): ConversationAnswerToolApprovalResult {
    return agentToolApprovalRequestService.answer(request);
  }

  private registerActiveTurn(turn: ActiveConversationTurn): void {
    this.activeTurns.set(turn.turnId, turn);
  }

  private clearActiveTurn(turnId: string, controller: AbortController): void {
    const active = this.activeTurns.get(turnId);
    if (active?.abortController === controller) {
      const sessionId = active.sessionId;
      this.activeTurns.delete(turnId);
      if (sessionId) this.notifySessionTurnIdle(sessionId);
    }
  }
  private notifySessionTurnIdle(sessionId: string): void {
    this.handoffs.notifySessionTurnIdle(sessionId);
    this.backgroundContinuations.notifyIdle(sessionId);
  }
  private async runBackgroundContinuation(pending: BackgroundContinuationEvent): Promise<void> {
    const sessionId = pending.sessionId;
    if (!this.acceptingTurns || Array.from(this.activeTurns.values()).some((turn) => turn.sessionId === sessionId)) return;
    const session = storageAdapter.readSession(sessionId); if (!session) return;
    const requestId = generateEventId('request');
    const input: ConversationContextInput = {
      requestId, sessionId, projectId: session.projectId, agentId: pending.parentAgentId, profileId: pending.parentAgentId,
      message: '', turnControls: session.turnControls ?? { reasoningLevel: 'off', maxContextMode: false, fastModel: false },
    };
    await this.runIdempotentTurn(input, async (resolvedRequestId, controller, requestFingerprint) => {
      const context = await this.resolveContext(input);
      return this.startProfileTurn(context, input.profileId ?? null, input.agentId ?? null, '', [], [], undefined, input.turnControls, resolvedRequestId, controller, undefined, requestFingerprint, undefined, pending.policyBudget);
    });
  }

  private getPreparingRequestByRequestId(requestId: string) {
    for (const entry of this.preparingRequests.values()) {
      if (entry.requestId === requestId) return entry;
    }
    return undefined;
  }

  private rememberSendRequest(
    idempotencyKey: string,
    fingerprint: string,
    pending: Promise<ConversationTurnResult>,
  ): void {
    this.sendRequests.set(idempotencyKey, pending);
    this.sendRequestFingerprints.set(idempotencyKey, fingerprint);
    if (this.sendRequests.size <= 256) return;
    const oldest = this.sendRequests.keys().next().value as string | undefined;
    if (oldest && oldest !== idempotencyKey) {
      this.sendRequests.delete(oldest);
      this.sendRequestFingerprints.delete(oldest);
    }
  }

  private resolveIdempotencyScope(
    input: ConversationContextInput | ConversationRewriteContextInput,
  ): { scopeType: 'session' | 'project'; scopeId: string; scopeKey: string; idempotencyKey: string } {
    const requestId = input.requestId?.trim();
    if (!requestId) throw new Error('PREFLIGHT_FAILED: requestId is required.');
    const sessionId = input.sessionId ?? input.fallbackSessionId ?? null;
    if (sessionId) {
      return {
        scopeType: 'session',
        scopeId: sessionId,
        scopeKey: `session:${sessionId}`,
        idempotencyKey: `session:${sessionId}:${requestId}`,
      };
    }
    const projectId = input.projectId ?? input.fallbackProjectId ?? 'ephemeral';
    return {
      scopeType: 'project',
      scopeId: projectId,
      scopeKey: `project:${projectId}`,
      idempotencyKey: `project:${projectId}:${requestId}`,
    };
  }

  private async computeRequestFingerprint(
    input: ConversationContextInput | ConversationRewriteContextInput,
    signal?: AbortSignal,
    stagedAttachments?: ConversationAttachmentInput[],
  ): Promise<string> {
    const attachments = stagedAttachments ?? input.attachments ?? [];
    const contentHashes = await hashAttachmentContents(attachments, signal);
    // Preserve attachment order — image order is semantic for multimodal prompts.
    const attachmentHashes = attachments.map((attachment, index) => (
      createHash('sha256')
        .update(canonicalJson({
          fileName: attachment.fileName,
          mimeType: attachment.mimeType ?? null,
          declaredSize: attachment.size ?? null,
          material: attachment.material ?? null,
          contentHash: contentHashes[index],
        }))
        .digest('hex')
    ));
    const branchAnchor = 'messageId' in input && typeof input.messageId === 'string'
      ? input.messageId
      : null;
    return createHash('sha256')
      .update(canonicalJson({
        sessionId: input.sessionId ?? input.fallbackSessionId ?? null,
        projectId: input.projectId ?? input.fallbackProjectId ?? null,
        message: input.message.trim(),
        attachmentHashes,
        agentId: input.agentId ?? input.profileId ?? null,
        profileId: input.profileId ?? input.agentId ?? null,
        turnControls: input.turnControls,
        preloadSkillIds: [...(input.preloadSkillIds ?? [])].sort(),
        branchAnchor,
        configurationCommit: input.configurationCommit ?? null,
      }))
      .digest('hex');
  }

  private stageAttachmentsForFingerprint(
    attachments: readonly ConversationAttachmentInput[],
    requestId: string,
  ): { stagingDir: string; stagedAttachments: ConversationAttachmentInput[] } {
    const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), `rdc-agent-att-fp-${requestId.slice(0, 24)}-`));
    try {
      const sourcePaths = attachments.map((attachment) => attachment.sourcePath);
      const stagedPaths = storageAdapter.history.stageAttachmentInputs(sourcePaths, stagingDir);
      const stagedAttachments = attachments.map((attachment, index) => ({
        ...attachment,
        sourcePath: stagedPaths[index]!,
      }));
      return { stagingDir, stagedAttachments };
    } catch (error) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      throw error;
    }
  }

  private assertFingerprintMatch(idempotencyKey: string, fingerprint: string): void {
    const existingFingerprint = this.sendRequestFingerprints.get(idempotencyKey);
    if (existingFingerprint && existingFingerprint !== fingerprint) {
      throw new Error('REQUEST_ID_CONFLICT: requestId already belongs to a different request fingerprint.');
    }
  }

  private async findPersistedTurn(
    input: ConversationContextInput | ConversationRewriteContextInput,
    requestId: string,
    requestFingerprint: string,
  ): Promise<ConversationTurnResult | null> {
    const explicitSessionId = input.sessionId ?? input.fallbackSessionId ?? null;
    const explicitProjectId = input.projectId ?? input.fallbackProjectId ?? null;
    const sessions = explicitSessionId
      ? [storageAdapter.readSession(explicitSessionId)].filter((entry): entry is SessionRecord => entry !== null)
      : explicitProjectId
        ? storageAdapter.listSessions(explicitProjectId)
        : [];
    for (const session of sessions) {
      const history = storageAdapter.readConversationHistory(session.sessionId);
      const requestMessages = history.filter((message) => message.requestId === requestId);
      const userMessage = requestMessages.find((message) => message.role === 'user');
      const assistantDraftMessage = requestMessages.find((message) => message.role === 'assistant');
      const preparedContext = userMessage?.preparedContext ?? assistantDraftMessage?.preparedContext;
      if (!userMessage || !assistantDraftMessage || !preparedContext) continue;
      if (userMessage.content !== input.message.trim()) {
        throw new Error('REQUEST_ID_CONFLICT: requestId already belongs to a different user message.');
      }
      if (userMessage.requestFingerprint !== requestFingerprint) {
        throw new Error('REQUEST_ID_CONFLICT: persisted request fingerprint is missing or differs from this request.');
      }
      const requestedCatalogRevision = input.configurationCommit?.providerCatalogRevision;
      if (
        requestedCatalogRevision
        && requestedCatalogRevision !== preparedContext.route.catalogRevision
      ) {
        throw new Error('REQUEST_ID_CONFLICT: requestId already belongs to a different frozen route.');
      }
      const branchState = this.readRepairedBranchState(session.sessionId, history);
      const messages = branchState
        ? resolveVisibleConversationMessages(history, branchState)
        : history;
      const tracePresentation = await traceService.buildConversationPresentation(
        session.sessionId,
        [userMessage, assistantDraftMessage],
      );
      return {
        requestId,
        session,
        mode: 'talk',
        userMessage,
        assistantDraftMessage,
        messages,
        branchState,
        executionTransition: { action: 'none' },
        runUpdate: null,
        tracePresentation,
        errorViewModel: assistantDraftMessage.diagnostic
          ? {
              code: assistantDraftMessage.diagnostic.code,
              message: assistantDraftMessage.diagnostic.userMessage,
              technicalMessage: assistantDraftMessage.diagnostic.technicalMessage,
            }
          : null,
        preparedContext,
      };
    }
    return null;
  }

  private async runIdempotentTurn(
    input: ConversationContextInput | ConversationRewriteContextInput,
    operation: (
      requestId: string,
      controller: AbortController,
      requestFingerprint: string,
      attachments: ConversationAttachmentInput[],
    ) => Promise<ConversationTurnResult>,
  ): Promise<ConversationTurnResult> {
    if (!this.acceptingTurns) {
      throw new Error('SHUTTING_DOWN: conversation service is no longer accepting turns.');
    }
    const requestId = input.requestId?.trim();
    if (!requestId) throw new Error('PREFLIGHT_FAILED: requestId is required.');
    const { scopeKey, idempotencyKey } = this.resolveIdempotencyScope(input);

    const controller = new AbortController();
    let stagingDir: string | null = null;
    let fingerprint: string | null = null;
    const existingPreparation = this.preparingRequests.get(idempotencyKey);
    const ownsPreparation = !existingPreparation;
    if (ownsPreparation) {
      const scopeOwner = this.activeSendScopes.get(scopeKey);
      if (scopeOwner && scopeOwner !== requestId) {
        throw new Error('CONVERSATION_BUSY: another request is preparing for this conversation.');
      }
      this.activeSendScopes.set(scopeKey, requestId);
      this.preparingRequests.set(idempotencyKey, {
        requestId,
        controller,
        phase: 'preparing',
        scopeKey,
        cancelAfterCommit: false,
        credentialLeaseTransferred: false,
      });
    }
    const activeController = existingPreparation?.controller ?? controller;

    const releasePreparation = (releaseRegistry = ownsPreparation): void => {
      if (stagingDir) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        stagingDir = null;
      }
      if (!releaseRegistry) return;
      const requestState = this.preparingRequests.get(idempotencyKey);
      if (requestState?.credentialHandle && !requestState.credentialLeaseTransferred) {
        agentOrchestrator.releaseProviderRuntimeCredentials(requestState.credentialHandle);
      }
      this.preparingRequests.delete(idempotencyKey);
      if (this.activeSendScopes.get(scopeKey) === requestId) this.activeSendScopes.delete(scopeKey);
    };

    try {
      const attachments = input.attachments ?? [];
      for (const attachment of attachments) {
        if (!attachment.sourcePath || typeof attachment.sourcePath !== 'string') {
          throw new Error('PREFLIGHT_FAILED: attachment sourcePath is required.');
        }
      }
      let stagedAttachments = attachments;
      if (attachments.length > 0) {
        const staged = this.stageAttachmentsForFingerprint(attachments, requestId);
        stagingDir = staged.stagingDir;
        stagedAttachments = staged.stagedAttachments;
      }
      if (activeController.signal.aborted) {
        throw new Error('TURN_CANCELLED: preparation aborted.');
      }
      fingerprint = await this.computeRequestFingerprint(input, activeController.signal, stagedAttachments);
      this.assertFingerprintMatch(idempotencyKey, fingerprint);
      const existing = this.sendRequests.get(idempotencyKey);
      if (existing) {
        releasePreparation();
        return existing;
      }
      const persisted = await this.findPersistedTurn(input, requestId, fingerprint);
      if (persisted) {
        this.sendRequestFingerprints.set(idempotencyKey, fingerprint);
        releasePreparation();
        return persisted;
      }

      const pending = operation(requestId, activeController, fingerprint, stagedAttachments)
        .finally(() => {
          releasePreparation();
        });
      this.rememberSendRequest(idempotencyKey, fingerprint, pending);
      void pending.catch(() => {
        if (this.sendRequests.get(idempotencyKey) === pending) {
          this.sendRequests.delete(idempotencyKey);
          this.sendRequestFingerprints.delete(idempotencyKey);
        }
      });
      return pending;
    } catch (error) {
      releasePreparation();
      throw error;
    }
  }

  async sendMessage(input: ConversationContextInput): Promise<ConversationTurnResult> {
    const trimmed = input.message.trim();
    const requestedSessionId = input.sessionId ?? input.fallbackSessionId;
    if (requestedSessionId) this.backgroundContinuations.resume(requestedSessionId);
    return this.runIdempotentTurn(input, async (requestId, controller, requestFingerprint, attachments) => {
        const context = await this.resolveContext(input);
        if (context.session && Array.from(this.activeTurns.values()).some((turn) => turn.sessionId === context.session?.sessionId)) {
          throw new Error('CONVERSATION_BUSY: this conversation already has a running turn.');
        }
        return await this.startProfileTurn(
          context,
          input.profileId ?? input.agentId ?? null,
          input.agentId ?? input.profileId ?? null,
          trimmed,
          attachments,
          input.preloadSkillIds ?? [],
          undefined,
          input.turnControls,
          requestId,
          controller,
          input.configurationCommit,
          requestFingerprint,
        );
    });
  }

  async rewriteFromMessage(input: ConversationRewriteContextInput): Promise<ConversationTurnResult> {
    return this.runIdempotentTurn(input, (requestId, controller, requestFingerprint, attachments) => this.rewriteFromMessageCore(
      { ...input, requestId, attachments },
      controller,
      requestFingerprint,
    ));
  }

  private async rewriteFromMessageCore(
    input: ConversationRewriteContextInput,
    preparationController: AbortController,
    requestFingerprint?: string,
  ): Promise<ConversationTurnResult> {
    const trimmed = input.message.trim();
    const context = await this.resolveContext(input);
    const sessionId = input.sessionId ?? context.session?.sessionId ?? null;
    if (!sessionId) {
      return this.startProfileTurn(
        context,
        input.profileId ?? input.agentId ?? null,
        input.agentId ?? input.profileId ?? null,
        trimmed,
        input.attachments ?? [],
        input.preloadSkillIds ?? [],
        undefined,
        input.turnControls,
        input.requestId,
        preparationController,
        input.configurationCommit,
        requestFingerprint,
      );
    }

    const initialHistory = storageAdapter.readConversationHistory(sessionId);
    const initialTargetIndex = initialHistory.findIndex((message) => message.id === input.messageId);
    const initialTargetMessage = initialTargetIndex >= 0 ? initialHistory[initialTargetIndex] : null;
    if (!initialTargetMessage || initialTargetMessage.role !== 'user') {
      throw new Error('Can only edit and resend an existing user message.');
    }

    const downstreamTurnIds = new Set(
      initialHistory.slice(initialTargetIndex + 1).map((message) => message.turnId),
    );
    // Also stop the target turn itself if it is still streaming (edit during reply).
    downstreamTurnIds.add(initialTargetMessage.turnId);
    const turnsToStop = Array.from(this.activeTurns.values()).filter((activeTurn) => (
      activeTurn.sessionId === sessionId && downstreamTurnIds.has(activeTurn.turnId)
    ));
    this.cancelUnfinishedHandoff(sessionId, 'rewrite');
    for (const activeTurn of turnsToStop) {
      activeTurn.stop();
    }
    // Overlap producer abort with turn exit; sync slots before rehydrate.
    agentOrchestrator.syncSessionSlots(sessionId);
    await Promise.all([
      turnsToStop.length > 0
        ? Promise.allSettled(turnsToStop.map((turn) => turn.stopped))
        : Promise.resolve([]),
      agentOrchestrator.abortAndJoin(sessionId, { reason: 'edit_resend' }).catch(() => undefined),
    ]);

    // Re-read after every stopped turn has fully left completeProfileTurn. Its
    // terminal flush may have appended a newer snapshot for the target branch.
    const history = storageAdapter.readConversationHistory(sessionId);
    const targetIndex = history.findIndex((message) => message.id === input.messageId);
    const targetMessage = targetIndex >= 0 ? history[targetIndex] : null;
    if (!targetMessage || targetMessage.role !== 'user') {
      throw new Error('Can only edit and resend an existing user message.');
    }

    let branchState = storageAdapter.readConversationBranchState(sessionId) ?? createDefaultBranchState(sessionId);
    const targetBranchId = normalizeBranchId(targetMessage.branchId);
    const forkId = targetMessage.forkId ?? targetMessage.id;
    const anchorMessageId = branchState.forks.find((fork) => fork.forkId === forkId)?.anchorMessageId ?? targetMessage.id;

    let fork = branchState.forks.find((entry) => entry.forkId === forkId);
    if (!fork) {
      fork = {
        forkId,
        anchorMessageId,
        activeBranchId: targetBranchId,
        branches: [{
          branchId: targetBranchId,
          parentBranchId: null,
          variantIndex: targetMessage.variantIndex ?? 0,
          anchorUserMessageId: targetMessage.id,
          rootTurnId: targetMessage.turnId,
        }],
      };
      branchState.forks.push(fork);
    } else if (!fork.branches.some((branch) => branch.anchorUserMessageId === targetMessage.id)) {
      const variantIndex = targetMessage.variantIndex ?? fork.branches.length;
      if (!fork.branches.some((branch) => branch.variantIndex === variantIndex)) {
        fork.branches.push({
          branchId: targetBranchId,
          parentBranchId: fork.branches[0]?.parentBranchId ?? null,
          variantIndex,
          anchorUserMessageId: targetMessage.id,
          rootTurnId: targetMessage.turnId,
        });
      }
    }

    const newBranchId = generateEventId('branch');
    const variantIndex = fork.branches.length;

    const updatedContext: ResolvedConversationContext = {
      ...context,
      session: storageAdapter.readSession(sessionId) ?? context.session,
    };
    return this.startProfileTurn(
      updatedContext,
      input.profileId ?? input.agentId ?? null,
      input.agentId ?? input.profileId ?? null,
      trimmed,
      input.attachments ?? [],
      input.preloadSkillIds ?? [],
      {
        branchId: newBranchId,
        forkId,
        variantIndex,
        parentBranchId: targetBranchId,
        branchState,
      },
      input.turnControls,
      input.requestId,
      preparationController,
      input.configurationCommit,
      requestFingerprint,
      targetMessage.turnId,
    );
  }

  async switchConversationBranch(input: ConversationSwitchBranchRequest): Promise<ConversationSwitchBranchResult> {
    this.cancelUnfinishedHandoff(input.sessionId, 'branch');
    const activeTurns = Array.from(this.activeTurns.values()).filter((turn) => turn.sessionId === input.sessionId);
    for (const turn of activeTurns) turn.stop();
    if (activeTurns.length > 0) {
      await Promise.allSettled(activeTurns.map((turn) => turn.stopped));
    }
    // Branch switch: discard in-memory agent slot cache; next turn rehydrates from disk.
    agentOrchestrator.syncSessionSlots(input.sessionId);
    await agentOrchestrator.abortAndJoin(input.sessionId, { reason: 'branch_switch' }).catch(() => undefined);

    const allMessages = storageAdapter.readConversationHistory(input.sessionId);
    const branchState = this.readRepairedBranchState(input.sessionId, allMessages);
    if (!branchState) {
      return { success: false, messages: [], error: 'No conversation branch state found.' };
    }
    const fork = branchState.forks.find((entry) => entry.forkId === input.forkId);
    const branch = fork?.branches.find((entry) => entry.branchId === input.branchId);
    if (!fork || !branch) {
      return { success: false, messages: [], error: 'Invalid conversation branch selection.' };
    }

    fork.activeBranchId = input.branchId;
    branchState.activeLeafBranchId = input.branchId;
    storageAdapter.writeConversationBranchState(input.sessionId, branchState);

    const visibleMessages = resolveVisibleConversationMessages(allMessages, branchState);
    const tracePresentation = await traceService.buildConversationPresentation(input.sessionId, visibleMessages);
    workflowProjectionPublisher.publishTraceProjectionChanged({ projectId: tracePresentation.projectId, sessionId: tracePresentation.sessionId }, tracePresentation);
    publishConversationTrace(input.sessionId, visibleMessages, input.sessionId, publishTraceProjection);

    return {
      success: true,
      messages: allMessages,
      branchState,
      tracePresentation,
    };
  }

  private readRepairedBranchState(
    sessionId: string,
    allMessages: ConversationMessage[],
  ): ConversationBranchState | null {
    const current = storageAdapter.readConversationBranchState(sessionId);
    const { branchState, repaired } = repairConversationBranchState(allMessages, current);
    if (branchState && repaired) {
      storageAdapter.writeConversationBranchState(sessionId, branchState);
    }
    return branchState;
  }

  private async resolveContext(input: ConversationContextInput): Promise<ResolvedConversationContext> {
    const projectId = input.projectId ?? input.fallbackProjectId ?? storageAdapter.getCurrentProjectId() ?? null;
    const persistedSessionId = await storageAdapter.getCurrentSessionId();
    const resolvedSessionId = input.sessionId ?? input.fallbackSessionId ?? persistedSessionId ?? null;
    const session = resolvedSessionId ? storageAdapter.readSession(resolvedSessionId) : null;
    const currentRun = resolvedSessionId
      ? storageAdapter.listRuns(resolvedSessionId).find((entry) => entry.runId === (input.currentRunId ?? input.fallbackRunId))
        ?? storageAdapter.getLatestRun(resolvedSessionId)
      : null;
    const projectInputs = projectId ? await storageAdapter.listProjectInputs(projectId) : [];
    const openedCapture = projectId && resolvedSessionId
      ? rdxSessionService.snapshotOpenedCaptureForSession({ projectId, sessionId: resolvedSessionId })
      : null;
    const activeOpenedCapture = openedCapture?.status === 'open' ? openedCapture : null;
    const replayDevice = replayDeviceService.getDeviceById(input.replayDeviceId || 'local') ?? replayDeviceService.getDeviceById('local');

    return {
      projectId,
      session,
      currentRun,
      projectInputs,
      openedCapture: activeOpenedCapture,
      openedCapturePath: activeOpenedCapture?.filePath ?? null,
      replayDevice,
    };
  }

  /**
   * 按 effective snapshot 的当前对话路由准备 Prompt。
   * 顶层身份只有四 builtin：general / debugger / analyzer / optimizer；
   * 自定义 profile 走同一路由，不再把 ask/plan/edit 当 mode。
   */
  private prepareConversationPrompt(input: PrepareConversationPromptInput) {
    return buildConversationPrompt(input);
  }

  private createTurnStarterHost() {
    return {
      getPreparingRequestByRequestId: (requestId: string) => this.getPreparingRequestByRequestId(requestId),
      prepareConversationPrompt: (input: PrepareConversationPromptInput) => this.prepareConversationPrompt(input),
      persistConversationSnapshot,
      publishConversationTrace: (
        traceSessionId: string,
        messages: ConversationMessage[],
        persistedSessionId?: string | null,
      ) => publishConversationTrace(traceSessionId, messages, persistedSessionId, publishTraceProjection),
      ephemeralTraceSessionId,
      getCommittedHandoff: (sessionId: string) => this.handoffs.getCommittedHandoff(sessionId),
      consumeCommittedHandoff: (
        sessionId: string,
        handoff: ProfileHandoffState,
        continuationTurnId?: string,
      ) => this.consumeCommittedHandoff(sessionId, handoff, continuationTurnId),
    };
  }

  private createTurnRunnerHost(): ConversationTurnRunnerHost {
    return {
      validateCompletion: enforceMissionTurnCompletion,
      persistConversationSnapshot,
      emitConversationEvent,
      publishConversationTrace: (
        traceSessionId: string,
        messages: ConversationMessage[],
        persistedSessionId?: string | null,
      ) => publishConversationTrace(traceSessionId, messages, persistedSessionId, publishTraceProjection),
      registerActiveTurn: (turn: ActiveConversationTurn) => this.registerActiveTurn(turn),
      clearActiveTurn: (turnId: string, controller: AbortController) => this.clearActiveTurn(turnId, controller),
      assertTerminalContextOwnership,
      ephemeralTraceSessionId,
      commitPreparedHandoff: (sessionId: string, sourceTurnId: string) => this.commitPreparedHandoff(sessionId, sourceTurnId),
      cancelUnfinishedHandoff: (sessionId: string, reason: ProfileHandoffCancelReason) => this.cancelUnfinishedHandoff(sessionId, reason),
      scheduleHandoffAutoSend: (sessionId: string) => this.scheduleHandoffAutoSend(sessionId),
    };
  }

  cancelUnfinishedHandoff(sessionId: string | null | undefined, reason: ProfileHandoffCancelReason): Promise<void> {
    return this.handoffs.cancelUnfinishedHandoff(sessionId, reason);
  }

  notifyHydratedHandoff(sessionId: string, result: ProfileHandoffState | null): void {
    this.handoffs.notifyHydratedHandoff(sessionId, result);
  }

  private commitPreparedHandoff(sessionId: string, sourceTurnId: string): Promise<ProfileHandoffState | null> {
    return this.handoffs.commitPreparedHandoff(sessionId, sourceTurnId);
  }

  private consumeCommittedHandoff(sessionId: string, handoff: ProfileHandoffState, continuationTurnId?: string): void {
    this.handoffs.consumeCommittedHandoff(sessionId, handoff, continuationTurnId);
  }

  private scheduleHandoffAutoSend(sessionId: string): void {
    this.handoffs.scheduleHandoffAutoSend(sessionId);
  }

  private async startProfileTurn(
    context: ResolvedConversationContext,
    requestedProfileId: string | null,
    requestedAgentId: string | null,
    rawMessage: string,
    pendingAttachments: ConversationAttachmentInput[],
    preloadSkillIds: string[] = [],
    branchContext?: ConversationBranchTurnContext,
    requestTurnControls?: ConversationTurnControls,
    requestId: string = generateEventId('request'),
    preparationController: AbortController = new AbortController(),
    configurationCommit?: ConversationSendRequest['configurationCommit'],
    requestFingerprint?: string,
    excludeTurnId?: string,
    policyBudget?: import('../workflow/debugger/TurnCoordinator').PolicyBudgetState,
  ): Promise<ConversationTurnResult> {
    return runStartProfileTurn(
      this.createTurnStarterHost(),
      (input: CompleteProfileTurnInput) => runCompleteProfileTurn(this.createTurnRunnerHost(), input),
      context,
      requestedProfileId,
      requestedAgentId,
      rawMessage,
      pendingAttachments,
      preloadSkillIds,
      branchContext,
      requestTurnControls,
      requestId,
      preparationController,
      configurationCommit,
      requestFingerprint,
      excludeTurnId,
      policyBudget,
    );
  }

}

export const conversationService = new ConversationService();

if (typeof storageAdapter.setHandoffHydrateListener === 'function') {
  storageAdapter.setHandoffHydrateListener((sessionId, result) => {
    conversationService.notifyHydratedHandoff(sessionId, result);
  });
}
