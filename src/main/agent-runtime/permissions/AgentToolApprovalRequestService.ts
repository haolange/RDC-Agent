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
    const approvalId = `tool-approval-${input.toolCallId}`;
    const key = keyFor(turnId, approvalId);
    this.cancelPending(key, 'Superseded by a new approval request.');

    return new Promise<boolean>((resolve, reject) => {
      const pending: PendingToolApprovalRequest = {
        ...input,
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
          this.cancelPending(key, 'Tool approval request was cancelled.');
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

  autoReview(input: ToolApprovalRequestInput): boolean {
    const approved = input.risk === 'low';
    const approvalId = `auto-review-${input.toolCallId}`;
    const synthetic: PendingToolApprovalRequest = {
      ...input,
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
    } as AgentApprovalEventPayload);
    this.emit(synthetic, 'approval.answered', {
      approvalId,
      title: `Auto-review ${input.toolName}`,
      status: approved ? 'approved' : 'rejected',
      reason: input.reason,
      kind: 'tool',
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      answer: approved
        ? 'Auto-review approved this low-risk action.'
        : 'Auto-review denied this action. Use a safer workspace-scoped path or switch permissions.',
      risk: input.risk,
      reviewer: 'auto_review',
    } as AgentApprovalEventPayload);
    return approved;
  }

  answer(input: ToolApprovalAnswerInput): ToolApprovalAnswerResult {
    const pending = this.pending.get(keyFor(input.turnId, input.approvalId));
    if (!pending) {
      return { success: false, error: 'No pending approval request was found for this turn.' };
    }
    if (input.sessionId && pending.sessionId && input.sessionId !== pending.sessionId) {
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
      risk: pending.risk,
    } as AgentApprovalEventPayload);
    pending.reject(new Error(reason));
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
    pending.onEvent?.(buildSharedAgentEvent(type, payload, pending.context));
  }
}

export const agentToolApprovalRequestService = new AgentToolApprovalRequestService();
