import type { AgentRole } from '@shared/types/agent';
import type { AgentApprovalEventPayload, AgentEvent as SharedAgentEvent } from '@shared/types/agentRuntime';
import type {
  ConversationAskUserAnswer,
  ConversationAskUserQuestion,
} from '@shared/types/conversation';
import {
  formatAskUserAnswersForToolResult,
  normalizeAskUserAnswers,
  normalizeAskUserQuestions,
} from '@shared/utils/askUser';
import { buildSharedAgentEvent, type AgentEventBridgeContext } from '../AgentEventBridge';

interface PendingUserInputRequest {
  agentId: AgentRole;
  sessionId: string | null;
  turnId: string;
  toolCallId: string;
  approvalId: string;
  questions: ConversationAskUserQuestion[];
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
  questions: ConversationAskUserQuestion[];
  context: AgentEventBridgeContext;
  onEvent?: (event: SharedAgentEvent) => void;
  signal?: AbortSignal;
}

export interface AgentUserInputAnswerInput {
  sessionId?: string | null;
  turnId: string;
  toolCallId: string;
  answers: ConversationAskUserAnswer[];
}

export interface AgentUserInputAnswerResult {
  success: boolean;
  error?: string;
}

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

    const questions = normalizeAskUserQuestions({ questions: input.questions });
    if (questions.length === 0) {
      throw new Error('ask_user requires at least one canonical question.');
    }
    const approvalId = `ask-user-${toolCallId}`;

    return new Promise<string>((resolve, reject) => {
      const pending: PendingUserInputRequest = {
        agentId: input.agentId,
        sessionId: input.sessionId ?? null,
        turnId,
        toolCallId,
        approvalId,
        questions,
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
        questions,
      });
    });
  }

  answer(input: AgentUserInputAnswerInput): AgentUserInputAnswerResult {
    const pending = this.pending.get(keyFor(input.turnId, input.toolCallId));
    if (!pending) {
      return { success: false, error: 'No pending user input request was found for this turn.' };
    }
    if (input.sessionId && pending.sessionId && input.sessionId !== pending.sessionId) {
      return { success: false, error: 'Pending user input request belongs to a different session.' };
    }

    const answers = normalizeAskUserAnswers(pending.questions, { answers: input.answers });
    const answerByQuestionId = new Map(answers.map((answer) => [answer.questionId, answer]));
    const missingQuestion = pending.questions.find((question) => !answerByQuestionId.has(question.questionId));
    if (missingQuestion) {
      return { success: false, error: `Answer cannot be empty for question ${missingQuestion.questionId}.` };
    }

    for (const question of pending.questions) {
      const answer = answerByQuestionId.get(question.questionId);
      if (!answer) continue;
      if (!question.allowFreeform && !answer.selectedOptionId) {
        return { success: false, error: `Question ${question.questionId} requires one of the provided options.` };
      }
      if (
        answer.selectedOptionId
        && !question.options.some((option) => option.optionId === answer.selectedOptionId)
      ) {
        return { success: false, error: `Unknown option selected for question ${question.questionId}.` };
      }
    }

    const orderedAnswers = pending.questions.map((question) => answerByQuestionId.get(question.questionId)!);
    const formattedAnswer = formatAskUserAnswersForToolResult(pending.questions, orderedAnswers);
    this.deletePending(pending);
    this.emit(pending, 'approval.answered', {
      approvalId: pending.approvalId,
      title: 'User input answered',
      status: 'approved',
      kind: 'ask_user',
      toolCallId: pending.toolCallId,
      toolName: 'ask_user',
      questions: pending.questions,
      answers: orderedAnswers,
    });
    pending.resolve(formattedAnswer);
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
      questions: pending.questions,
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
