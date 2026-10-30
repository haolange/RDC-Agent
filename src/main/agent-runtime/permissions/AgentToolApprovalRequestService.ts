import { randomUUID } from 'node:crypto';
import { PermissionModeChangedError } from './RuntimePermissionStateService';
import type { PermissionReviewer, PermissionReviewAction, PermissionReviewVerdict } from './PermissionReviewRuntime';
import { PermissionReviewError } from './PermissionReviewRuntime';
import { getDelegatedInteractionOwner, type DelegatedInteractionOwner } from '../interactions/DelegatedInteractionOwner';
import type { AgentRole } from '@shared/types/agent';
import type { AgentApprovalEventPayload, AgentEvent as SharedAgentEvent } from '@shared/types/agentRuntime';
import { buildSharedAgentEvent, type AgentEventBridgeContext } from '../AgentEventBridge';

export interface ToolApprovalRequestInput {
  agentId: AgentRole;
  sessionId?: string | null;
  turnId?: string;
  toolCallId: string;
  toolName: string;
  reason: string;
  risk: 'low' | 'medium' | 'high';
  context: AgentEventBridgeContext;
  onEvent?: (event: SharedAgentEvent) => void;
  signal?: AbortSignal;
}

export interface ToolApprovalAnswerInput {
  sessionId?: string | null;
  turnId: string;
  approvalId: string;
  approved: boolean;
}

export interface ToolApprovalAnswerResult {
  success: boolean;
  error?: string;
}

interface PendingToolApprovalRequest extends ToolApprovalRequestInput {
  delegatedOwner?: DelegatedInteractionOwner;
  sessionId: string | null;
  turnId: string;
  approvalId: string;
  resolve: (approved: boolean) => void;
  reject: (error: Error) => void;
  abortListener?: () => void;
}

const keyFor = (turnId: string, approvalId: string): string => `${turnId}::${approvalId}`;

export class AgentToolApprovalRequestService {
  private pending = new Map<string, PendingToolApprovalRequest>();

  async request(input: ToolApprovalRequestInput): Promise<boolean> {
    const turnId = input.turnId?.trim();
    if (!turnId) {
      throw new Error('Tool approval requires an active conversation turn.');
    }
    const approvalId = `tool-approval-${input.toolCallId}-${randomUUID()}`;
    const key = keyFor(turnId, approvalId);

    return new Promise<boolean>((resolve, reject) => {
      const pending: PendingToolApprovalRequest = {
        ...input,
        delegatedOwner: getDelegatedInteractionOwner(input.sessionId),
        sessionId: input.sessionId ?? null,
        turnId,
        approvalId,
        resolve,
        reject,
      };

      if (input.signal) {
        if (input.signal.aborted) {
          reject(new Error('Tool approval request was cancelled.'));
          return;
        }
        pending.abortListener = () => {
          this.cancelPending(key, input.signal?.reason instanceof PermissionModeChangedError ? 'PERMISSION_MODE_CHANGED' : 'Tool approval request was cancelled.');
        };
        input.signal.addEventListener('abort', pending.abortListener, { once: true });
      }

      this.pending.set(key, pending);
      this.emit(pending, 'approval.requested', {
        approvalId,
        title: `Approve ${input.toolName}`,
        status: 'pending',
        reason: input.reason,
        kind: 'tool',
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        question: input.reason,
        options: ['Approve once', 'Deny'],
        risk: input.risk,
      } as AgentApprovalEventPayload);
    });
  }

  async autoReview(input: ToolApprovalRequestInput & { action?: PermissionReviewAction; reviewer?: PermissionReviewer }): Promise<PermissionReviewVerdict> {
    const reviewMethod = input.risk === 'low' ? 'rule' as const : 'model' as const;
    let errorCode: string | undefined;
    const approvalId = `auto-review-${input.toolCallId}-${randomUUID()}`;
    const synthetic: PendingToolApprovalRequest = {
      ...input,
      delegatedOwner: getDelegatedInteractionOwner(input.sessionId),
      sessionId: input.sessionId ?? null,
      turnId: input.turnId?.trim() || 'auto-review',
      approvalId,
      resolve: () => undefined,
      reject: () => undefined,
    };
    this.emit(synthetic, 'approval.requested', {
      approvalId,
      title: `Auto-review ${input.toolName}`,
      status: 'pending',
      reason: input.reason,
      kind: 'tool',
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      risk: input.risk,
      reviewer: 'auto_review',
      reviewMethod,
    } as AgentApprovalEventPayload);
    let verdict: PermissionReviewVerdict;
    let settledRejection = false;
    let modeCancelled = false;
    let reviewCancelled = false;
    try {
      input.signal?.throwIfAborted();
      if (input.risk === 'low') {
        verdict = { approved: true, reason: `RULE_APPROVED: ${input.reason}` };
      } else {
        if (!input.reviewer || !input.action) throw new PermissionReviewError('PERMISSION_REVIEW_UNAVAILABLE', 'no frozen reviewer is available.');
        const result = await awaitReview(input.reviewer(input.action, input.signal), input.signal, (result) => { settledRejection = !result.approved; });
        // Only the strict verdict crosses this boundary; route/failure metadata belongs to the host.
        verdict = { approved: result.approved, reason: result.reason };
      }
      if (!settledRejection) input.signal?.throwIfAborted();
    } catch (error) {
      modeCancelled = error instanceof PermissionModeChangedError;
      reviewCancelled = input.signal?.aborted === true && error === input.signal.reason;
      errorCode = modeCancelled ? 'PERMISSION_MODE_CHANGED' : reviewCancelled ? 'PERMISSION_REVIEW_CANCELLED'
        : error instanceof PermissionReviewError ? error.code : 'PERMISSION_REVIEW_FAILED';
      verdict = { approved: false, reason: error instanceof PermissionReviewError && !reviewCancelled
        ? error.message : `${errorCode}: ${error instanceof Error ? error.message : String(error)}` };
    }
    const { approved, reason } = verdict;
    this.emit(synthetic, 'approval.answered', {
      approvalId,
      title: `Auto-review ${input.toolName}`,
      status: reviewCancelled ? 'cancelled' : approved ? 'approved' : 'rejected',
      reason,
      kind: 'tool',
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      answer: reason,
      risk: input.risk,
      reviewer: 'auto_review',
      reviewMethod,
      errorCode,
    } as AgentApprovalEventPayload);
    if (modeCancelled) throw new PermissionModeChangedError();
    return verdict;
  }

  isPending(sessionId: string, turnId: string, approvalId: string): boolean {
    const pending = this.pending.get(keyFor(turnId, approvalId));
    return !!pending && (pending.delegatedOwner?.ownerSessionId ?? pending.sessionId) === sessionId;
  }

  answer(input: ToolApprovalAnswerInput): ToolApprovalAnswerResult {
    const pending = this.pending.get(keyFor(input.turnId, input.approvalId));
    if (!pending) {
      return { success: false, error: 'No pending approval request was found for this turn.' };
    }
    if ((input.sessionId ?? null) !== (pending.delegatedOwner?.ownerSessionId ?? pending.sessionId)) {
      return { success: false, error: 'Pending approval request belongs to a different session.' };
    }

    this.deletePending(pending);
    this.emit(pending, 'approval.answered', {
      approvalId: pending.approvalId,
      title: `Approve ${pending.toolName}`,
      status: input.approved ? 'approved' : 'rejected',
      reason: pending.reason,
      kind: 'tool',
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      answer: input.approved ? '已批准一次' : '用户已拒绝',
      risk: pending.risk,
    } as AgentApprovalEventPayload);
    pending.resolve(input.approved);
    return { success: true };
  }

  cancelTurn(turnId?: string): void {
    if (!turnId) return;
    for (const [key, pending] of Array.from(this.pending.entries())) {
      if (pending.turnId === turnId) {
        this.cancelPending(key, 'Tool approval request was cancelled.');
      }
    }
  }

  private cancelPending(key: string, reason: string): void {
    const pending = this.pending.get(key);
    if (!pending) return;
    this.deletePending(pending);
    this.emit(pending, 'approval.answered', {
      approvalId: pending.approvalId,
      title: `Approve ${pending.toolName}`,
      status: 'cancelled',
      reason: pending.reason,
      kind: 'tool',
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      answer: reason,
      errorCode: reason === 'PERMISSION_MODE_CHANGED' ? reason : undefined,
      risk: pending.risk,
    } as AgentApprovalEventPayload);
    pending.reject(pending.signal?.reason instanceof PermissionModeChangedError ? pending.signal.reason : new Error(reason));
  }

  private deletePending(pending: PendingToolApprovalRequest): void {
    this.pending.delete(keyFor(pending.turnId, pending.approvalId));
    if (pending.abortListener && pending.signal) {
      pending.signal.removeEventListener('abort', pending.abortListener);
    }
  }

  private emit(
    pending: PendingToolApprovalRequest,
    type: 'approval.requested' | 'approval.answered',
    payload: AgentApprovalEventPayload,
  ): void {
    const owner = pending.delegatedOwner;
    pending.onEvent?.(buildSharedAgentEvent(type, owner ? { ...payload, delegatedRequest: { executionId: owner.executionId, childSessionId: owner.childSessionId, turnId: pending.turnId } } : payload, owner ? { ...pending.context, sessionId: owner.ownerSessionId } : pending.context));
  }
}

export const agentToolApprovalRequestService = new AgentToolApprovalRequestService();

async function awaitReview<T>(review: Promise<T>, signal: AbortSignal | undefined, onSettled: (value: T) => void): Promise<T> {
  if (!signal) return review.then(value => { onSettled(value); return value; });
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = () => { settled = true; signal.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    review.then(value => { if (settled) return; finish(); onSettled(value); resolve(value); }, error => { if (settled) return; finish(); reject(error); });
  });
}
