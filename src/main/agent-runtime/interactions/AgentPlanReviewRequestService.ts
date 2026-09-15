import { getDelegatedInteractionOwner, type DelegatedInteractionOwner } from './DelegatedInteractionOwner';
import type { AgentRole } from '@shared/types/agent';
import type { AgentApprovalEventPayload, AgentEvent as SharedAgentEvent } from '@shared/types/agentRuntime';
import type { ConversationPlanReview, PlanReviewDecision, PlanReviewHandoffOption } from '@shared/types/planReview';
import { buildSharedAgentEvent, type AgentEventBridgeContext } from '../AgentEventBridge';
import { planArtifactWriter, type PlanArtifactWriter } from '../../sessions/sessionPlanArtifact';
import { planReviewStateStore, type PlanReviewStateStore } from '../../sessions/PlanReviewStateStore';
import type { TurnHandle } from '../../workflow/debugger/TurnCoordinator';
import { writeExecutionOfferFromApproval } from '../../conversation/applyDeclaredHandoff';
import { storageAdapter } from '../../sessions/StorageAdapter';

interface PendingPlanReviewRequest {
  delegatedOwner?: DelegatedInteractionOwner;
  agentId: AgentRole;
  sessionId: string | null;
  turnId: string;
  toolCallId: string;
  approvalId: string;
  planReview: ConversationPlanReview;
  turnHandle?: TurnHandle | null;
  context: AgentEventBridgeContext;
  onEvent?: (event: SharedAgentEvent) => void;
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
  abortListener?: () => void;
  signal?: AbortSignal;
}

export interface AgentPlanReviewRequestInput {
  agentId: AgentRole;
  sessionId?: string | null;
  turnId?: string;
  toolCallId: string;
  planReview: ConversationPlanReview;
  turnHandle?: TurnHandle | null;
  context: AgentEventBridgeContext;
  onEvent?: (event: SharedAgentEvent) => void;
  signal?: AbortSignal;
}

export interface AgentPlanReviewAnswerInput {
  sessionId?: string | null;
  turnId: string;
  toolCallId: string;
  decision: PlanReviewDecision;
}

export interface AgentPlanReviewAnswerResult {
  success: boolean;
  error?: string;
}

const keyFor = (turnId: string, toolCallId: string): string => `${turnId}::${toolCallId}`;

function formatApprovedResult(handoff: PlanReviewHandoffOption, frozenUri: string, hash: string): string {
  return [
    'approved',
    '已冻结，本回合结束，等待用户点声明按钮。',
    `label: ${handoff.label}`,
    `target: ${handoff.agent}`,
    `plan.uri: ${frozenUri}`,
    `plan.hash: ${hash}`,
  ].join('\n');
}

function formatRejectedResult(feedback: string): string {
  return `rejected\nfeedback: ${feedback}`;
}

export class AgentPlanReviewRequestService {
  private pending = new Map<string, PendingPlanReviewRequest>();

  constructor(
    private readonly writer: PlanArtifactWriter = planArtifactWriter,
    private readonly store: PlanReviewStateStore = planReviewStateStore,
  ) {}

  async request(input: AgentPlanReviewRequestInput): Promise<string> {
    const turnId = input.turnId?.trim();
    if (!turnId) {
      throw new Error('plan_artifact requires an active conversation turn.');
    }
    const toolCallId = input.toolCallId.trim();
    if (!toolCallId) {
      throw new Error('plan_artifact requires a tool call id.');
    }
    const key = keyFor(turnId, toolCallId);
    this.cancelPending(key, 'Superseded by a new plan review request.');
    const approvalId = `plan-review-${toolCallId}`;

    return new Promise<string>((resolve, reject) => {
      const pending: PendingPlanReviewRequest = {
        delegatedOwner: getDelegatedInteractionOwner(input.sessionId),
        agentId: input.agentId,
        sessionId: input.sessionId ?? null,
        turnId,
        toolCallId,
        approvalId,
        planReview: input.planReview,
        turnHandle: input.turnHandle,
        context: input.context,
        onEvent: input.onEvent,
        resolve,
        reject,
        signal: input.signal,
      };

      if (input.signal) {
        if (input.signal.aborted) {
          reject(new Error('Plan review request was cancelled.'));
          return;
        }
        pending.abortListener = () => {
          this.cancelPending(key, 'Plan review request was cancelled.');
        };
        input.signal.addEventListener('abort', pending.abortListener, { once: true });
      }

      this.pending.set(key, pending);
      this.emit(pending, 'approval.requested', {
        approvalId,
        title: 'Plan review requested',
        status: 'pending',
        kind: 'plan_review',
        toolCallId,
        toolName: 'plan_artifact',
        planReview: input.planReview,
      });
    });
  }

  isPending(sessionId: string, turnId: string, toolCallId: string): boolean {
    const pending = this.pending.get(keyFor(turnId, toolCallId));
    return !!pending && (pending.delegatedOwner?.ownerSessionId ?? pending.sessionId) === sessionId;
  }

  answer(input: AgentPlanReviewAnswerInput): AgentPlanReviewAnswerResult {
    const pending = this.pending.get(keyFor(input.turnId, input.toolCallId));
    if (!pending) {
      return { success: false, error: 'No pending plan review request was found for this turn.' };
    }
    if ((input.sessionId ?? null) !== (pending.delegatedOwner?.ownerSessionId ?? pending.sessionId)) {
      return { success: false, error: 'Pending plan review request belongs to a different session.' };
    }

    if (input.decision.kind === 'reject') {
      const feedback = input.decision.feedback.trim();
      if (!feedback) {
        return { success: false, error: 'Rejecting a plan requires non-empty feedback.' };
      }
      const sessionId = pending.sessionId;
      if (sessionId) {
        this.store.markDecision(sessionId, 'rejected');
      }
      const decision = { kind: 'reject' as const, feedback };
      this.deletePending(pending);
      this.emit(pending, 'approval.answered', {
        approvalId: pending.approvalId,
        title: 'Plan review rejected',
        status: 'rejected',
        kind: 'plan_review',
        toolCallId: pending.toolCallId,
        toolName: 'plan_artifact',
        planReview: { ...pending.planReview, status: 'rejected', decision },
        decision,
      });
      pending.resolve(formatRejectedResult(feedback));
      return { success: true };
    }

    const handoff = input.decision.handoff;
    const allowed = pending.planReview.handoffOptions.some(
      (option) => option.agent === handoff.agent && option.label === handoff.label,
    );
    if (!allowed) {
      return { success: false, error: 'Approved handoff is not one of the declared continue actions.' };
    }
    const sessionId = pending.sessionId;
    if (!sessionId) {
      return { success: false, error: 'Plan review approve requires a session-owned turn.' };
    }
    const frozen = this.writer.freezeApprovedPlan(sessionId, pending.planReview.hash);
    this.store.markDecision(sessionId, 'approved', {
      approvedHash: frozen.hash,
      frozenUri: frozen.uri,
      approvedHandoff: input.decision.handoff,
    });
    if (pending.turnHandle) {
      pending.turnHandle.approvedPlan = {
        hash: frozen.hash,
        target: input.decision.handoff.agent,
        frozenUri: frozen.uri,
        planId: pending.planReview.planId,
      };
    }
    const session = storageAdapter.readSession(sessionId);
    writeExecutionOfferFromApproval({
      sessionId,
      sourceAgentId: pending.agentId,
      projectRoot: session ? storageAdapter.getProjectById(session.projectId)?.rootPath ?? null : null,
      handoff: input.decision.handoff,
      plan: { uri: frozen.uri, hash: frozen.hash },
    });
    const decision = { kind: 'approve' as const, handoff: input.decision.handoff };
    this.deletePending(pending);
    this.emit(pending, 'approval.answered', {
      approvalId: pending.approvalId,
      title: 'Plan review approved',
      status: 'approved',
      kind: 'plan_review',
      toolCallId: pending.toolCallId,
      toolName: 'plan_artifact',
      planReview: {
        ...pending.planReview,
        status: 'approved',
        uri: frozen.uri,
        hash: frozen.hash,
        decision,
      },
      decision,
    });
    pending.resolve(formatApprovedResult(input.decision.handoff, frozen.uri, frozen.hash));
    return { success: true };
  }

  cancelTurn(turnId?: string): void {
    if (!turnId) return;
    for (const [key, pending] of Array.from(this.pending.entries())) {
      if (pending.turnId === turnId) {
        this.cancelPending(key, 'Plan review request was cancelled.');
      }
    }
  }

  private cancelPending(key: string, reason: string): void {
    const pending = this.pending.get(key);
    if (!pending) return;
    this.deletePending(pending);
    this.emit(pending, 'approval.answered', {
      approvalId: pending.approvalId,
      title: 'Plan review cancelled',
      status: 'cancelled',
      kind: 'plan_review',
      toolCallId: pending.toolCallId,
      toolName: 'plan_artifact',
      planReview: pending.planReview,
      answer: reason,
    });
    pending.reject(new Error(reason));
  }

  private deletePending(pending: PendingPlanReviewRequest): void {
    this.pending.delete(keyFor(pending.turnId, pending.toolCallId));
    if (pending.abortListener && pending.signal) {
      pending.signal.removeEventListener('abort', pending.abortListener);
    }
  }

  private emit(
    pending: PendingPlanReviewRequest,
    type: 'approval.requested' | 'approval.answered',
    payload: AgentApprovalEventPayload,
  ): void {
    const owner = pending.delegatedOwner;
    pending.onEvent?.(buildSharedAgentEvent(
      type,
      owner ? { ...payload, delegatedRequest: { executionId: owner.executionId, childSessionId: owner.childSessionId, turnId: pending.turnId } } : payload,
      owner ? { ...pending.context, sessionId: owner.ownerSessionId } : pending.context,
    ));
  }
}

export const agentPlanReviewRequestService = new AgentPlanReviewRequestService();
