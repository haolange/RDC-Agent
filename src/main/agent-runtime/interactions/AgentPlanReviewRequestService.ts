import { randomUUID } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
import { buildSharedAgentEvent, type AgentEventBridgeContext } from '../AgentEventBridge';
import { planArtifactWriter, type PlanArtifactWriter } from '../../sessions/run/sessionPlanArtifact';
import { planReviewStateStore, type PlanReviewStateStore } from '../../sessions/run/PlanReviewStateStore';
import { runtimeLogService } from '../../runtime/RuntimeLogService';
import { TaskRegistry, createSessionTaskStore } from '../tasks';
import { traceProjectionRefreshService } from '../orchestration/TraceProjectionRefreshService';
import { resolveRecoverablePlan } from './planReviewRecovery';
import { resolveApprovedHandoff } from './approvedHandoffRecovery';
import { getDelegatedInteractionOwner, type DelegatedInteractionOwner } from './DelegatedInteractionOwner';
import { runPlanApprovalTransaction } from './PlanApprovalTransaction';
import type { PlanReadRequest, PlanReviewContext, PlanReviewProjection, ConversationAnswerPlanReviewRequest, ConversationAnswerPlanReviewResult } from '@shared/types/planReview';
import type { PlanTaskRequirement } from '../../sessions/run/planTaskRequirements';
import type { TurnHandle } from '../orchestration/TurnCoordinator';
import type { ConversationPlanReview, PlanReviewHandoffIdentity } from '@shared/types/planReview';
import type { AgentApprovalEventPayload, AgentEvent } from '@shared/types/agentRuntime';
import type { AgentRole } from '@shared/types/agent';
import type { PlanApprovalRequest } from '@shared/types/planReview';

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
  onEvent?: (event: AgentEvent) => void;
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
  onEvent?: (event: AgentEvent) => void;
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
    error?: string, decision?: PlanReviewProjection['decision'], approvedHandoff?: PlanReviewProjection['approvedHandoff']): PlanReviewProjection {
    const data = { sessionId, review, recoverable, ...(error ? { error } : {}), ...(decision ? { decision } : {}),
      ...(approvedHandoff ? { approvedHandoff } : {}) };
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
      if (!source) {
        if (this.heads.get(sessionId)?.decision) return this.heads.get(sessionId)!;
        const handoff = this.busy(sessionId) ? null : resolveApprovedHandoff(sessionId, this.store.read(sessionId));
        return this.project(sessionId, null, null, undefined, undefined, handoff ?? undefined);
      }
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
      throw new AppError('PLAN_REVIEW_SCOPE_CHANGED', 'review is no longer current.');
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
    if (this.busy(reference.sessionId)) throw new AppError('PLAN_REVIEW_BUSY', 'another request is active.');
    const source = resolveRecoverablePlan(reference.sessionId, this.store);
    if (!source || source.state.status !== 'cancelled' || Object.keys(source.reference).some(key =>
      source.reference[key as keyof PlanReadRequest] !== reference[key as keyof PlanReadRequest])) throw new AppError('PLAN_REVIEW_SCOPE_CHANGED', 'plan is no longer recoverable.');
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
    if (!pending) throw new AppError('PLAN_REVIEW_SCOPE_CHANGED', 'no pending plan review has this id.');
    if (input.sessionId !== (pending.delegatedOwner?.ownerSessionId ?? pending.sessionId)) {
      throw new AppError('PLAN_SESSION_DENIED', 'the pending plan review belongs to a different session.');
    }
    if (pending.answering) throw new AppError('PLAN_REVIEW_BUSY', 'an answer to this review is already committing.');
    if (pending.recovered) this.verifyRecoveredReview(pending);

    if (!isPlanApprovalRequest(input)) {
      const feedback = input.decision.feedback.trim();
      const sessionId = pending.sessionId;
      if (sessionId) {
        this.store.markRejected(sessionId, { turnId: pending.turnId,
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
      const planReview = this.project(input.sessionId, null, null, undefined, { reviewId: pending.reviewId, kind: 'reject' });
      return { decision: 'reject', planReview, ...(pending.recovered ? { replan: { agentId: pending.agentId,
        source: { sessionId: input.sessionId, planId: pending.planReview.planId, revision: pending.planReview.revision,
          uri: pending.planReview.uri, expectedHash: pending.planReview.hash }, feedback } } : {}) };
    }

    const sessionId = pending.sessionId;
    if (!sessionId) throw new AppError('PLAN_SESSION_NOT_FOUND', 'approving a plan requires a session-owned turn.');
    const handoff = input.decision.handoff;
    pending.answering = true;
    try {
      const committed = await runPlanApprovalTransaction({
        sessionId,
        turnId: pending.turnId,
        sourceAgentId: pending.agentId,
        planReview: pending.planReview,
        handoff,
        expectedPlanHash: input.expectedPlanHash,
        model: input.model,
        controls: input.controls,
        baseRevision: input.baseRevision,
      }, {
        writer: this.writer,
        store: this.store,
        installTaskRevisions: (owner, tasks) => this.installTaskRevisions(owner, tasks, ({ task, snapshot }) => {
          traceProjectionRefreshService.schedule(owner);
          pending.onEvent?.(buildSharedAgentEvent('task.updated', {
            taskId: task.id, title: task.subject, status: task.status, statusReason: task.statusReason, snapshot,
          }, pending.context));
        }),
        isCurrent: () => this.pending.get(input.reviewId) === pending && !pending.signal?.aborted,
        onDiagnostic: (message) => runtimeLogService.log({
          scope: 'session', namespace: 'agent', severity: 'warning', sessionId,
          title: 'Plan approval diagnostic', summary: message,
        }),
      });
      if (pending.turnHandle) {
        pending.turnHandle.approvedPlan = {
          toolCallId: pending.toolCallId,
          hash: committed.frozen.hash,
          target: handoff.agent,
          frozenUri: committed.frozen.uri,
          planId: pending.planReview.planId,
        };
      }
      const decision = { kind: 'approve' as const, handoff };
      this.deletePending(pending);
      this.emit(pending, 'approval.answered', {
        approvalId: pending.approvalId,
        title: 'Plan review approved',
        status: 'approved',
        kind: 'plan_review',
        toolCallId: pending.toolCallId,
        toolName: 'plan_artifact',
        planReview: { ...pending.planReview, status: 'approved', uri: committed.frozen.uri, hash: committed.frozen.hash, decision },
        decision,
      });
      pending.resolve?.(formatApprovedResult(handoff, committed.frozen.uri, committed.frozen.hash));
      const planReview = this.project(input.sessionId, null, null, undefined, { reviewId: pending.reviewId, kind: 'approve' });
      return {
        decision: 'approve',
        session: committed.session,
        planReview,
        handoff: { prompt: committed.handoff.prompt, send: committed.handoff.send },
      };
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

export function isPlanApprovalRequest(request: ConversationAnswerPlanReviewRequest): request is PlanApprovalRequest {
  return request.decision.kind === 'approve';
}
