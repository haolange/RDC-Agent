/**
 * Durable Profile Handoff operations owned by ConversationService.
 * Cancel / commit / consume / event-driven auto-send live here; the service only delegates.
 */
import type {
  ConversationAttachmentInput,
  ConversationSendRequest,
  ConversationTurnResult,
} from '@shared/types/conversation';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import {
  HANDOFF_AUTO_SEND_MAX_IDLE_OBSERVATIONS,
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
}

interface HandoffAutoSendLease {
  sessionId: string;
  handoffId: string;
  generation: number;
  idleObservations: number;
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
  private generationClock = 0;
  private readonly leases = new Map<string, HandoffAutoSendLease>();
  private readonly generationByHandoffId = new Map<string, number>();
  private readonly consumedHandoffIds = new Set<string>();
  private readonly inFlightStarts = new Map<string, Promise<void>>();

  constructor(private readonly host: ConversationHandoffOpsHost) {}

  /** Drops in-process auto-send leases. Used by tests between cases; never arms a send. */
  resetAutoSendScheduler(): void {
    this.generationClock = 0;
    this.leases.clear();
    this.generationByHandoffId.clear();
    this.consumedHandoffIds.clear();
    this.inFlightStarts.clear();
  }

  cancelUnfinishedHandoff(sessionId: string | null | undefined, reason: ProfileHandoffCancelReason): void {
    if (!sessionId) return;
    this.dropAutoSend(sessionId);
    const cancelled = storageAdapter.handoffs.cancel(sessionId, reason);
    if (cancelled) {
      this.emitCancelledHandoff(sessionId, cancelled);
    }
  }

  notifyHydratedHandoff(sessionId: string, result: ProfileHandoffState | null): void {
    if (result?.lifecycle !== 'cancelled' || result.cancelReason !== 'restart_degrade') return;
    this.dropAutoSend(sessionId);
    this.consumedHandoffIds.add(result.handoffId);
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
    this.dropAutoSend(sessionId);
    this.consumedHandoffIds.add(latest.handoffId);
    agentToolApprovalRequestService.cancelTurn(handoff.sourceTurnId);
    agentUserInputRequestService.cancelTurn(handoff.sourceTurnId);
    const consumed = storageAdapter.handoffs.consume(sessionId, latest.handoffId, continuationTurnId);
    storageAdapter.updateSession(sessionId, { agentId: consumed.toAgentId });
    emitConversationEvent(buildHandoffAgentEvent('handoff.consumed', sessionId, consumed));
  }

  /**
   * Arm one auto-send generation for the committed handoff.
   * Starts immediately when the session has no active turn; otherwise waits for turn-idle.
   */
  scheduleHandoffAutoSend(sessionId: string): void {
    const lease = this.armAutoSendLease(sessionId);
    if (!lease) return;
    if (!this.host.hasActiveTurnForSession(sessionId)) {
      void this.startHandoffAutoSend(sessionId, lease.generation);
    }
  }

  /**
   * Source turn complete / session slot freed. One observation per event.
   * Late or duplicate generations are discarded. Occupied-slot waits are bounded.
   */
  notifySessionTurnIdle(sessionId: string): void {
    const lease = this.leases.get(sessionId);
    if (!this.isCurrentLease(lease)) return;
    if (this.host.hasActiveTurnForSession(sessionId)) {
      lease.idleObservations += 1;
      if (lease.idleObservations >= HANDOFF_AUTO_SEND_MAX_IDLE_OBSERVATIONS) {
        this.cancelUnfinishedHandoff(sessionId, 'superseded');
      }
      return;
    }
    void this.startHandoffAutoSend(sessionId, lease.generation);
  }

  async startHandoffAutoSend(sessionId: string, expectedGeneration?: number): Promise<void> {
    const inFlight = this.inFlightStarts.get(sessionId);
    if (inFlight) return inFlight;
    const run = this.runHandoffAutoSend(sessionId, expectedGeneration);
    this.inFlightStarts.set(sessionId, run);
    try {
      await run;
    } finally {
      this.inFlightStarts.delete(sessionId);
    }
  }

  private async runHandoffAutoSend(sessionId: string, expectedGeneration?: number): Promise<void> {
    const lease = this.leases.get(sessionId);
    if (!this.isCurrentLease(lease)) return;
    if (expectedGeneration !== undefined && expectedGeneration !== lease.generation) return;
    if (this.host.hasActiveTurnForSession(sessionId)) {
      return;
    }

    const committed = this.getCommittedHandoff(sessionId);
    if (
      !committed?.send
      || committed.handoffId !== lease.handoffId
      || !storageAdapter.handoffs.isLiveThisProcess(committed.handoffId)
    ) {
      this.dropAutoSend(sessionId);
      return;
    }

    this.consumedHandoffIds.add(lease.handoffId);
    this.leases.delete(sessionId);

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
      // Stop / cancel / preflight / invalid_model — never retry auto-send.
    }
    this.cancelLeftoverAutoSendHandoff(
      sessionId,
      cancelReasonForAutoSendFailure(autoSendError),
    );
  }

  private armAutoSendLease(sessionId: string): HandoffAutoSendLease | null {
    const committed = this.getCommittedHandoff(sessionId);
    if (!committed?.send || !storageAdapter.handoffs.isLiveThisProcess(committed.handoffId)) {
      return null;
    }
    if (this.consumedHandoffIds.has(committed.handoffId)) {
      return null;
    }
    const existingGeneration = this.generationByHandoffId.get(committed.handoffId);
    const existingLease = this.leases.get(sessionId);
    if (existingLease && existingGeneration === existingLease.generation) {
      return existingLease;
    }
    if (existingGeneration !== undefined) {
      return null;
    }
    const generation = this.generationClock + 1;
    this.generationClock = generation;
    const lease: HandoffAutoSendLease = {
      sessionId,
      handoffId: committed.handoffId,
      generation,
      idleObservations: 0,
    };
    this.generationByHandoffId.set(committed.handoffId, generation);
    this.leases.set(sessionId, lease);
    return lease;
  }

  private isCurrentLease(lease: HandoffAutoSendLease | null | undefined): lease is HandoffAutoSendLease {
    if (!lease) return false;
    if (this.consumedHandoffIds.has(lease.handoffId)) return false;
    return this.generationByHandoffId.get(lease.handoffId) === lease.generation
      && this.leases.get(lease.sessionId) === lease;
  }

  private dropAutoSend(sessionId: string): void {
    const lease = this.leases.get(sessionId);
    if (lease) {
      this.consumedHandoffIds.add(lease.handoffId);
      this.leases.delete(sessionId);
    }
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
