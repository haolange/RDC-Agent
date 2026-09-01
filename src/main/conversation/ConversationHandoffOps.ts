/**
 * Durable Profile Handoff operations owned by ConversationService.
 * Cancel / commit / consume / auto-send live here; the service only delegates.
 */
import type {
  ConversationAttachmentInput,
  ConversationSendRequest,
  ConversationTurnResult,
} from '@shared/types/conversation';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import {
  isActiveHandoffLifecycle,
  isConsumableHandoff,
  type ProfileHandoffCancelReason,
  type ProfileHandoffState,
} from '@shared/types/profileHandoff';
import { generateEventId } from '@shared/utils/id';
import { agentUserInputRequestService } from '../agent-runtime/interactions/AgentUserInputRequestService';
import { agentToolApprovalRequestService } from '../agent-runtime/permissions/AgentToolApprovalRequestService';
import { storageAdapter } from '../sessions/StorageAdapter';
import type { ResolvedConversationContext } from './ConversationRoutePreflight';
import { emitConversationEvent } from './ConversationTurnTerminal';
import { buildHandoffAgentEvent } from './profileHandoffEvents';

export interface ConversationHandoffAutoSendInput extends ConversationSendRequest {
  sessionId: string;
  projectId: string;
  agentId: string;
  profileId: string;
}

export interface ConversationHandoffOpsHost {
  readonly autoSendHandoffSessions: Set<string>;
  hasActiveTurnForSession(sessionId: string): boolean;
  runIdempotentTurn(
    input: ConversationHandoffAutoSendInput,
    operation: (
      requestId: string,
      controller: AbortController,
      requestFingerprint: string,
      attachments: ConversationAttachmentInput[],
    ) => Promise<ConversationTurnResult>,
  ): Promise<ConversationTurnResult>;
  resolveContext(input: ConversationHandoffAutoSendInput): Promise<ResolvedConversationContext>;
  startAutoSendProfileTurn(input: {
    context: ResolvedConversationContext;
    agentId: string;
    turnControls: ConversationTurnControls | undefined;
    requestId: string;
    controller: AbortController;
    requestFingerprint: string;
  }): Promise<ConversationTurnResult>;
  startHandoffAutoSend(sessionId: string): Promise<void>;
}

function cancelReasonForAutoSendFailure(error: unknown): ProfileHandoffCancelReason {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (
    /MODEL_UNAVAILABLE|PROVIDER_UNAVAILABLE|HANDOFF_MODEL_INVALID|CONVERSATION_AGENT_UNAVAILABLE|AGENT_COMMIT_NOT_FOUND/
      .test(message)
  ) {
    return 'invalid_model';
  }
  return 'superseded';
}

export class ConversationHandoffOps {
  constructor(private readonly host: ConversationHandoffOpsHost) {}

  cancelUnfinishedHandoff(sessionId: string | null | undefined, reason: ProfileHandoffCancelReason): void {
    if (!sessionId) return;
    this.host.autoSendHandoffSessions.delete(sessionId);
    const cancelled = storageAdapter.handoffs.cancel(sessionId, reason);
    if (cancelled) {
      this.emitCancelledHandoff(sessionId, cancelled);
    }
  }

  notifyHydratedHandoff(sessionId: string, result: ProfileHandoffState | null): void {
    if (result?.lifecycle !== 'cancelled' || result.cancelReason !== 'restart_degrade') return;
    this.host.autoSendHandoffSessions.delete(sessionId);
    this.emitCancelledHandoff(sessionId, result);
  }

  getCommittedHandoff(sessionId: string): ProfileHandoffState | null {
    const active = storageAdapter.handoffs.getActive(sessionId);
    return active?.lifecycle === 'committed' ? active : null;
  }

  commitPreparedHandoff(sessionId: string, sourceTurnId: string): ProfileHandoffState | null {
    try {
      return storageAdapter.handoffs.commit(sessionId, sourceTurnId);
    } catch {
      this.cancelUnfinishedHandoff(sessionId, 'superseded');
      return null;
    }
  }

  consumeCommittedHandoff(
    sessionId: string,
    handoff: ProfileHandoffState,
    continuationTurnId?: string,
  ): void {
    const latest = this.getCommittedHandoff(sessionId);
    if (!isConsumableHandoff(handoff, latest)) return;
    this.host.autoSendHandoffSessions.delete(sessionId);
    agentToolApprovalRequestService.cancelTurn(handoff.sourceTurnId);
    agentUserInputRequestService.cancelTurn(handoff.sourceTurnId);
    const consumed = storageAdapter.handoffs.consume(sessionId, latest.handoffId, continuationTurnId);
    storageAdapter.updateSession(sessionId, { agentId: consumed.toAgentId });
    emitConversationEvent(buildHandoffAgentEvent('handoff.consumed', sessionId, consumed));
  }

  scheduleHandoffAutoSend(sessionId: string): void {
    const committed = this.getCommittedHandoff(sessionId);
    if (!committed?.send || !storageAdapter.handoffs.isLiveThisProcess(committed.handoffId)) {
      return;
    }
    this.host.autoSendHandoffSessions.add(sessionId);
    queueMicrotask(() => {
      void this.host.startHandoffAutoSend(sessionId);
    });
  }

  async startHandoffAutoSend(sessionId: string): Promise<void> {
    if (!this.host.autoSendHandoffSessions.has(sessionId)) return;
    const committed = this.getCommittedHandoff(sessionId);
    if (!committed?.send || !storageAdapter.handoffs.isLiveThisProcess(committed.handoffId)) {
      this.host.autoSendHandoffSessions.delete(sessionId);
      return;
    }
    if (this.host.hasActiveTurnForSession(sessionId)) {
      queueMicrotask(() => {
        void this.startHandoffAutoSend(sessionId);
      });
      return;
    }
    this.host.autoSendHandoffSessions.delete(sessionId);
    const session = storageAdapter.readSession(sessionId);
    if (!session) {
      this.cancelLeftoverAutoSendHandoff(sessionId, 'superseded');
      return;
    }
    agentToolApprovalRequestService.cancelTurn(committed.sourceTurnId);
    agentUserInputRequestService.cancelTurn(committed.sourceTurnId);
    const requestId = generateEventId('request');
    const turnControls = session.turnControls ?? { reasoningLevel: 'off', maxContextMode: false, fastModel: false };
    const autoSendInput: ConversationHandoffAutoSendInput = {
      requestId,
      sessionId,
      projectId: session.projectId,
      agentId: committed.toAgentId,
      profileId: committed.toAgentId,
      message: '',
      turnControls,
    };
    let autoSendError: unknown = null;
    try {
      await this.host.runIdempotentTurn(
        autoSendInput,
        async (turnRequestId, controller, requestFingerprint) => {
          const latest = this.getCommittedHandoff(sessionId);
          if (!latest || latest.handoffId !== committed.handoffId || !latest.send) {
            throw new Error('HANDOFF_STATE_CONFLICT: handoff is no longer committed for auto-send.');
          }
          const context = await this.host.resolveContext({
            ...autoSendInput,
            requestId: turnRequestId,
          });
          return this.host.startAutoSendProfileTurn({
            context,
            agentId: committed.toAgentId,
            turnControls: session.turnControls,
            requestId: turnRequestId,
            controller,
            requestFingerprint,
          });
        },
      );
    } catch (error) {
      autoSendError = error;
      // Stop / cancel / preflight failure — never retry auto-send.
    }
    this.cancelLeftoverAutoSendHandoff(
      sessionId,
      cancelReasonForAutoSendFailure(autoSendError),
    );
  }

  private emitCancelledHandoff(sessionId: string, cancelled: ProfileHandoffState): void {
    agentToolApprovalRequestService.cancelTurn(cancelled.sourceTurnId);
    agentUserInputRequestService.cancelTurn(cancelled.sourceTurnId);
    emitConversationEvent(buildHandoffAgentEvent('handoff.cancelled', sessionId, cancelled));
  }

  private cancelLeftoverAutoSendHandoff(
    sessionId: string,
    reason: ProfileHandoffCancelReason,
  ): void {
    const leftover = storageAdapter.handoffs.getActive(sessionId);
    if (!leftover || !isActiveHandoffLifecycle(leftover.lifecycle)) return;
    this.cancelUnfinishedHandoff(sessionId, reason);
  }
}
