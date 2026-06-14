import type { AgentRole } from '@shared/types/agent';
import type { AgentApprovalEventPayload, AgentEvent as SharedAgentEvent } from '@shared/types/agentRuntime';
import { buildSharedAgentEvent, type AgentEventBridgeContext } from '../AgentEventBridge';

interface PendingUserInputRequest {
  agentId: AgentRole;
  sessionId: string | null;
  turnId: string;
  toolCallId: string;
  approvalId: string;
  question: string;
  options: string[];
  context: AgentEventBridgeContext;
  onEvent?: (event: SharedAgentEvent) => void;
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
  abortListener?: () => void;
  signal?: AbortSignal;
}

export interface AgentUserInputRequestInput {
  agentId: AgentRole;
  sessionId?: string | null;
  turnId?: string;
  toolCallId: string;
  question: string;
  options?: string[];
  context: AgentEventBridgeContext;
  onEvent?: (event: SharedAgentEvent) => void;
  signal?: AbortSignal;
}

export interface AgentUserInputAnswerInput {
  sessionId?: string | null;
  turnId: string;
  toolCallId: string;
  answer: string;
}

export interface AgentUserInputAnswerResult {
  success: boolean;
  error?: string;
}

const normalizeOption = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text : null;
};

const normalizeQuestion = (value: string): string => {
  const text = value.trim();
  return text || 'The agent needs user input before continuing.';
};

const keyFor = (turnId: string, toolCallId: string): string => `${turnId}::${toolCallId}`;

export class AgentUserInputRequestService {
  private pending = new Map<string, PendingUserInputRequest>();

  async request(input: AgentUserInputRequestInput): Promise<string> {
    const turnId = input.turnId?.trim();
    if (!turnId) {
      throw new Error('ask_user requires an active conversation turn.');
    }
    const toolCallId = input.toolCallId.trim();
    if (!toolCallId) {
      throw new Error('ask_user requires a tool call id.');
    }

    const key = keyFor(turnId, toolCallId);
    this.cancelPending(key, 'Superseded by a new user input request.');

    const question = normalizeQuestion(input.question);
    const options = (input.options ?? [])
      .map(normalizeOption)
      .filter((entry): entry is string => Boolean(entry));
    const approvalId = `ask-user-${toolCallId}`;

    return new Promise<string>((resolve, reject) => {
      const pending: PendingUserInputRequest = {
        agentId: input.agentId,
        sessionId: input.sessionId ?? null,
        turnId,
        toolCallId,
        approvalId,
        question,
        options,
        context: input.context,
        onEvent: input.onEvent,
        resolve,
        reject,
        signal: input.signal,
      };

      if (input.signal) {
        if (input.signal.aborted) {
          reject(new Error('User input request was cancelled.'));
          return;
        }
        pending.abortListener = () => {
          this.cancelPending(key, 'User input request was cancelled.');
        };
        input.signal.addEventListener('abort', pending.abortListener, { once: true });
      }

      this.pending.set(key, pending);
      this.emit(pending, 'approval.requested', {
        approvalId,
        title: 'User input requested',
        status: 'pending',
        kind: 'ask_user',
        toolCallId,
        toolName: 'ask_user',
        question,
        options,
      });
    });
  }

  answer(input: AgentUserInputAnswerInput): AgentUserInputAnswerResult {
    const answer = input.answer.trim();
    if (!answer) {
      return { success: false, error: 'Answer cannot be empty.' };
    }

    const pending = this.pending.get(keyFor(input.turnId, input.toolCallId));
    if (!pending) {
      return { success: false, error: 'No pending user input request was found for this turn.' };
    }
    if (input.sessionId && pending.sessionId && input.sessionId !== pending.sessionId) {
      return { success: false, error: 'Pending user input request belongs to a different session.' };
    }

    this.deletePending(pending);
    this.emit(pending, 'approval.answered', {
      approvalId: pending.approvalId,
      title: 'User input answered',
      status: 'approved',
      kind: 'ask_user',
      toolCallId: pending.toolCallId,
      toolName: 'ask_user',
      question: pending.question,
      answer,
    });
    pending.resolve(answer);
    return { success: true };
  }

  cancelTurn(turnId?: string): void {
    if (!turnId) return;
    for (const [key, pending] of Array.from(this.pending.entries())) {
      if (pending.turnId === turnId) {
        this.cancelPending(key, 'User input request was cancelled.');
      }
    }
  }

  private cancelPending(key: string, reason: string): void {
    const pending = this.pending.get(key);
    if (!pending) return;
    this.deletePending(pending);
    this.emit(pending, 'approval.answered', {
      approvalId: pending.approvalId,
      title: 'User input cancelled',
      status: 'cancelled',
      kind: 'ask_user',
      toolCallId: pending.toolCallId,
      toolName: 'ask_user',
      question: pending.question,
      answer: reason,
    });
    pending.reject(new Error(reason));
  }

  private deletePending(pending: PendingUserInputRequest): void {
    this.pending.delete(keyFor(pending.turnId, pending.toolCallId));
    if (pending.abortListener && pending.signal) {
      pending.signal.removeEventListener('abort', pending.abortListener);
    }
  }

  private emit(
    pending: PendingUserInputRequest,
    type: 'approval.requested' | 'approval.answered',
    payload: AgentApprovalEventPayload,
  ): void {
    pending.onEvent?.(buildSharedAgentEvent(type, payload, pending.context));
  }
}

export const agentUserInputRequestService = new AgentUserInputRequestService();
