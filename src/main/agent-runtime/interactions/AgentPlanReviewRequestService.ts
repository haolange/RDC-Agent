import { getDelegatedInteractionOwner, type DelegatedInteractionOwner } from './DelegatedInteractionOwner';
import type { AgentRole } from '@shared/types/agent';
import type { AgentApprovalEventPayload, AgentEvent as SharedAgentEvent } from '@shared/types/agentRuntime';
import type { ConversationPlanReview, PlanReviewHandoffIdentity } from '@shared/types/planReview';
import { buildSharedAgentEvent, type AgentEventBridgeContext } from '../AgentEventBridge';
import { planArtifactWriter, type PlanArtifactWriter } from '../../sessions/run/sessionPlanArtifact';
import { planReviewStateStore, type PlanReviewStateStore } from '../../sessions/run/PlanReviewStateStore';
import type { TurnHandle } from '../orchestration/TurnCoordinator';
import { assertDeclaredHandoffForPlan, writeExecutionOfferFromApproval } from '../../conversation/applyDeclaredHandoff';
import { storageAdapter } from '../../sessions/store/StorageAdapter';
import type { PlanTaskRequirement } from '@shared/types/taskExecution';
import { TaskRegistry, createSessionTaskStore } from '../tasks';
import { traceProjectionRefreshService } from '../../agent-trace/TraceProjectionRefreshService';
import { randomUUID } from 'node:crypto';
import type { PlanReadRequest, PlanReviewContext, PlanReviewProjection, ConversationAnswerPlanReviewRequest, ConversationAnswerPlanReviewResult } from '@shared/types/planReview';
import { resolveRecoverablePlan } from '../../sessions/run/planReviewRecovery';

interface PendingPlanReviewRequest {
  reviewId: string;
  recovered: boolean;
  answering?: boolean;
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
  resolve?: (answer: string) => void;
  reject?: (error: Error) => void;
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

export type AgentPlanReviewAnswerInput = ConversationAnswerPlanReviewRequest;
export type AgentPlanReviewAnswerResult = ConversationAnswerPlanReviewResult;

function formatApprovedResult(handoff: PlanReviewHandoffIdentity, frozenUri: string, hash: string): string {
  return [
    'approved',
    '已冻结计划并确认声明交接。',
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
  private listeners = new Set<(projection: PlanReviewProjection) => void>();
  private heads = new Map<string, PlanReviewProjection>();
  private version = 0;
  private busy: (sessionId: string) => boolean = () => false;

  setBusyChecker(check: (sessionId: string) => boolean): void { this.busy = check; }
  subscribe(listener: (projection: PlanReviewProjection) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  private context(pending: PendingPlanReviewRequest): PlanReviewContext {
    return { reviewId: pending.reviewId, sessionId: pending.delegatedOwner?.ownerSessionId ?? pending.sessionId!,
      turnId: pending.turnId, toolCallId: pending.toolCallId, agentId: pending.agentId,
      recovered: pending.recovered, planReview: pending.planReview };
  }

  private project(sessionId: string, review: PlanReviewContext | null, recoverable: PlanReadRequest | null,
    error?: string, decision?: PlanReviewProjection['decision']): PlanReviewProjection {
    const data = { sessionId, review, recoverable, ...(error ? { error } : {}), ...(decision ? { decision } : {}) };
    const previous = this.heads.get(sessionId);
    if (previous && JSON.stringify({ ...previous, projectionVersion: 0 }) === JSON.stringify({ ...data, projectionVersion: 0 })) return previous;
    const next = { ...data, projectionVersion: ++this.version };
    this.heads.set(sessionId, next);
    for (const listener of this.listeners) {
      try { listener(next); } catch { /* Subscribers cannot reverse a durable decision. */ }
    }
    return next;
  }

  projection(sessionId: string): PlanReviewProjection {
    const live = [...this.pending.values()].find(entry => (entry.delegatedOwner?.ownerSessionId ?? entry.sessionId) === sessionId);
    try {
      if (live) {
        if (live.recovered) this.verifyRecoveredReview(live);
        return this.project(sessionId, this.context(live), null);
      }
      const source = resolveRecoverablePlan(sessionId, this.store);
      if (!source) return this.heads.get(sessionId)?.decision ? this.heads.get(sessionId)! : this.project(sessionId, null, null);
      if (source.state.status === 'cancelled') return this.project(sessionId, null, source.reference);
      if (this.busy(sessionId)) return this.project(sessionId, null, null);
      return this.restore(sessionId, source);
    } catch (error) {
      if (live?.recovered) this.deletePending(live);
      return this.project(sessionId, null, null, error instanceof Error ? error.message : String(error));
    }
  }

  private verifyRecoveredReview(pending: PendingPlanReviewRequest): void {
    const source = resolveRecoverablePlan(this.context(pending).sessionId, this.store);
    if (!source || source.state.status !== 'awaiting' || source.planReview.planId !== pending.planReview.planId
      || source.planReview.revision !== pending.planReview.revision || source.planReview.hash !== pending.planReview.hash) {
      throw new Error('PLAN_REVIEW_SCOPE_CHANGED: review is no longer current.');
    }
  }

  private restore(sessionId: string, source: NonNullable<ReturnType<typeof resolveRecoverablePlan>>): PlanReviewProjection {
    const pending: PendingPlanReviewRequest = { reviewId: randomUUID(), recovered: true, agentId: source.agentId,
      sessionId: source.ownerSessionId, turnId: source.turnId, toolCallId: source.toolCallId, approvalId: '',
      planReview: { ...source.planReview, status: 'awaiting' }, context: { sessionId: source.ownerSessionId, turnId: source.turnId },
      ...(source.delegatedOwner ? { delegatedOwner: source.delegatedOwner } : {}) };
    this.pending.set(pending.reviewId, pending);
    return this.project(sessionId, this.context(pending), null);
  }

  reopen(reference: PlanReadRequest): PlanReviewProjection {
    if (this.busy(reference.sessionId)) throw new Error('PLAN_REVIEW_BUSY: another request is active.');
    const source = resolveRecoverablePlan(reference.sessionId, this.store);
    if (!source || source.state.status !== 'cancelled' || Object.keys(source.reference).some(key =>
      source.reference[key as keyof PlanReadRequest] !== reference[key as keyof PlanReadRequest])) throw new Error('PLAN_REVIEW_SCOPE_CHANGED: plan is no longer recoverable.');
    this.store.reopenReview(source.ownerSessionId, source.turnId, source.planReview.planId, source.planReview.revision);
    return this.restore(reference.sessionId, source);
  }

  cancel(sessionId: string, reviewId: string): { success: boolean; liveTurnId?: string } {
    const pending = this.pending.get(reviewId);
    if (!pending || this.context(pending).sessionId !== sessionId) return { success: false };
    this.cancelPending(reviewId, 'Plan review request was cancelled.');
    return { success: true, ...(!pending.recovered ? { liveTurnId: pending.turnId } : {}) };
  }

  retireRecovered(sessionId: string): void {
    for (const [key, pending] of this.pending) {
      if (pending.recovered && this.context(pending).sessionId === sessionId) this.cancelPending(key, 'Superseded by a new session request.');
    }
    this.project(sessionId, null, null);
  }

  constructor(
    private readonly writer: PlanArtifactWriter = planArtifactWriter,
    private readonly store: PlanReviewStateStore = planReviewStateStore,
    private readonly installTaskRevisions: (sessionId: string, tasks: readonly PlanTaskRequirement[], onChange: NonNullable<TaskRegistry['onTaskChange']>) => Promise<void>
      = (sessionId, tasks, onChange) => {
        const registry = new TaskRegistry(createSessionTaskStore(sessionId)); registry.onTaskChange = onChange;
        return registry.installApprovedTaskRevisions(tasks);
      },
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
    for (const [key, previous] of this.pending) if (previous.sessionId === input.sessionId) this.cancelPending(key, 'Superseded by a new plan review request.');
    const key = randomUUID();
    const approvalId = `plan-review-${toolCallId}`;

    return new Promise<string>((resolve, reject) => {
      const pending: PendingPlanReviewRequest = {
        reviewId: key,
        recovered: false,
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

      this.pending.set(key, pending);
      if (input.signal) {
        if (input.signal.aborted) {
          this.cancelPending(key, 'Plan review request was cancelled.');
          return;
        }
        pending.abortListener = () => {
          this.cancelPending(key, 'Plan review request was cancelled.');
        };
        input.signal.addEventListener('abort', pending.abortListener, { once: true });
      }

      this.emit(pending, 'approval.requested', {
        approvalId,
        title: 'Plan review requested',
        status: 'pending',
        kind: 'plan_review',
        toolCallId,
        toolName: 'plan_artifact',
        planReview: input.planReview,
      });
      this.project(this.context(pending).sessionId, this.context(pending), null);
    });
  }

  isPending(sessionId: string, turnId: string, toolCallId: string): boolean {
    const pending = [...this.pending.values()].find(entry => entry.turnId === turnId && entry.toolCallId === toolCallId);
    return !!pending && (pending.delegatedOwner?.ownerSessionId ?? pending.sessionId) === sessionId;
  }

  async answer(input: AgentPlanReviewAnswerInput): Promise<AgentPlanReviewAnswerResult> {
    const pending = this.pending.get(input.reviewId);
    if (!pending) {
      return { success: false, error: 'No pending plan review request was found for this turn.' };
    }
    if ((input.sessionId ?? null) !== (pending.delegatedOwner?.ownerSessionId ?? pending.sessionId)) {
      return { success: false, error: 'Pending plan review request belongs to a different session.' };
    }
    if (pending.answering) return { success: false, error: 'Plan review answer is already committing.' };
    if (pending.recovered) {
      try {
        this.verifyRecoveredReview(pending);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    if (input.decision.kind === 'reject') {
      const feedback = input.decision.feedback.trim();
      if (!feedback) {
        return { success: false, error: 'Rejecting a plan requires non-empty feedback.' };
      }
      const sessionId = pending.sessionId;
      if (sessionId) {
        this.store.markDecision(sessionId, 'rejected', { turnId: pending.turnId,
          planId: pending.planReview.planId, revision: pending.planReview.revision });
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
      pending.resolve?.(formatRejectedResult(feedback));
      this.project(input.sessionId, null, null, undefined, { reviewId: pending.reviewId, kind: 'reject' });
      return { success: true, ...(pending.recovered ? { replan: { agentId: pending.agentId,
        source: { sessionId: input.sessionId, planId: pending.planReview.planId, revision: pending.planReview.revision,
          uri: pending.planReview.uri, expectedHash: pending.planReview.hash }, feedback } } : {}) };
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
    pending.answering = true;
    let decisionCommitted = false;
    try {
    const frozen = this.writer.freezeApprovedPlan(sessionId, pending.planReview.hash);
    const session = storageAdapter.readSession(sessionId);
    const projectRoot = session ? storageAdapter.getProjectById(session.projectId)?.rootPath ?? null : null;
    assertDeclaredHandoffForPlan({ sourceAgentId: pending.agentId, projectRoot, handoff, tasks: frozen.taskRequirements });
    if (frozen.taskRequirements.length) await this.installTaskRevisions(sessionId, frozen.taskRequirements, ({ task, snapshot }) => {
      traceProjectionRefreshService.schedule(sessionId);
      pending.onEvent?.(buildSharedAgentEvent('task.updated', {
        taskId: task.id, title: task.subject, status: task.status, statusReason: task.statusReason, snapshot,
      }, pending.context));
    });
    if (this.pending.get(input.reviewId) !== pending || pending.signal?.aborted) {
      return { success: false, error: 'Plan review was cancelled while committing.' };
    }
    const approved = this.store.markDecision(sessionId, 'approved', { turnId: pending.turnId,
      planId: pending.planReview.planId, revision: pending.planReview.revision }, {
      approvedHash: frozen.hash,
      frozenUri: frozen.uri,
      approvedHandoff: input.decision.handoff,
    });
    decisionCommitted = true;
    if (pending.turnHandle) {
      pending.turnHandle.approvedPlan = {
        toolCallId: pending.toolCallId,
        hash: frozen.hash,
        target: input.decision.handoff.agent,
        frozenUri: frozen.uri,
        planId: pending.planReview.planId,
      };
    }
    writeExecutionOfferFromApproval({
      sessionId,
      sourceAgentId: pending.agentId,
      projectRoot,
      handoff: input.decision.handoff,
      plan: { uri: frozen.uri, hash: frozen.hash },
      approvedAt: approved.updatedAt,
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
    pending.resolve?.(formatApprovedResult(input.decision.handoff, frozen.uri, frozen.hash));
    this.project(input.sessionId, null, null, undefined, { reviewId: pending.reviewId, kind: 'approve' });
    return { success: true };
    } catch (error) {
      if (decisionCommitted) {
        this.deletePending(pending);
        pending.reject?.(error instanceof Error ? error : new Error(String(error)));
        this.project(input.sessionId, null, null, error instanceof Error ? error.message : String(error),
          { reviewId: pending.reviewId, kind: 'approve' });
      }
      throw error;
    } finally { pending.answering = false; }
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
    try {
      if (pending.sessionId) this.store.cancelReview(pending.sessionId, pending.turnId,
        pending.planReview.planId, pending.planReview.revision);
    } catch (error) {
      pending.reject?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
    this.deletePending(pending);
    this.emit(pending, 'approval.answered', {
      approvalId: pending.approvalId,
      title: 'Plan review cancelled',
      status: 'cancelled',
      kind: 'plan_review',
      toolCallId: pending.toolCallId,
      toolName: 'plan_artifact',
      planReview: { ...pending.planReview, status: 'cancelled' },
      answer: reason,
    });
    const cancellation = new Error(reason);
    cancellation.name = 'AbortError';
    pending.reject?.(cancellation);
    this.projection(this.context(pending).sessionId);
  }

  private deletePending(pending: PendingPlanReviewRequest): void {
    this.pending.delete(pending.reviewId);
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
