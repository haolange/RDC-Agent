import React, { useMemo, useState } from 'react';
import type { ConversationMessage, ConversationToolCall } from '@shared/types/conversation';
import { useConversationStore } from '../../../stores/conversationStore';
import { useUserInputRequestSubmit } from './useUserInputRequestSubmit';

export interface PendingUserInputRequest {
  sessionId: string | null;
  turnId: string;
  toolCallId: string;
  question: string;
  choices: string[];
  agentId?: string;
}

const normalizeToolName = (toolName: string): string => toolName.trim().toLowerCase().replace(/[.\-]/g, '_');

const safeParseJson = (value?: string): unknown => {
  if (!value?.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

const parseAskUserArgs = (call: ConversationToolCall): { question: string; choices: string[] } => {
  const parsed = safeParseJson(call.argsPreview);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      question: 'The agent needs user input before continuing.',
      choices: [],
    };
  }

  const record = parsed as Record<string, unknown>;
  const question = typeof record.question === 'string' && record.question.trim()
    ? record.question.trim()
    : 'The agent needs user input before continuing.';
  const rawChoices = Array.isArray(record.choices)
    ? record.choices
    : Array.isArray(record.options)
      ? record.options
      : [];
  const choices = rawChoices
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim());

  return { question, choices };
};

const findPendingUserInput = (messages: ConversationMessage[]): PendingUserInputRequest | null => {
  const assistantMessages = messages
    .filter((message) => message.role === 'assistant' && (message.status === 'draft' || message.status === 'streaming'))
    .sort((left, right) => right.createdAt - left.createdAt);

  for (const message of assistantMessages) {
    for (const block of message.workTrace?.blocks ?? []) {
      for (const call of block.toolCalls) {
        if (normalizeToolName(call.toolName) !== 'ask_user') continue;
        if (call.status !== 'pending' && call.status !== 'running') continue;
        if (call.resultPreview) continue;

        const args = parseAskUserArgs(call);
        return {
          sessionId: message.sessionId,
          turnId: message.turnId,
          toolCallId: call.id,
          question: args.question,
          choices: args.choices,
          agentId: message.agentId,
        };
      }
    }
  }

  return null;
};

export const usePendingUserInputRequest = (): PendingUserInputRequest | null => {
  const messages = useConversationStore((state) => state.conversationMessages);
  return useMemo(() => findPendingUserInput(messages), [messages]);
};

export const UserInputRequestPanel: React.FC<{
  request: PendingUserInputRequest;
}> = ({ request }) => {
  const [answer, setAnswer] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitUserInput = useUserInputRequestSubmit();

  const submitAnswer = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await submitUserInput(request, trimmed);
      setAnswer('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit the answer.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="composer-user-input-panel" data-testid="composer-user-input-panel">
      <div className="composer-user-input-header">
        <span className="composer-user-input-kicker">Input requested</span>
        <p>{request.question}</p>
      </div>
      {request.choices.length > 0 ? (
        <div className="composer-user-input-choices" aria-label="Suggested answers">
          {request.choices.map((choice) => (
            <button
              key={choice}
              type="button"
              className="composer-user-input-choice"
              disabled={isSubmitting}
              onClick={() => void submitAnswer(choice)}
            >
              {choice}
            </button>
          ))}
        </div>
      ) : null}
      <div className="composer-user-input-freeform">
        <textarea
          className="composer-user-input-textarea"
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submitAnswer(answer);
            }
          }}
          placeholder="Type your answer..."
          rows={2}
          disabled={isSubmitting}
        />
        <button
          type="button"
          className="composer-user-input-submit"
          disabled={isSubmitting || !answer.trim()}
          onClick={() => void submitAnswer(answer)}
        >
          Send
        </button>
      </div>
      {error ? (
        <p className="composer-user-input-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};
