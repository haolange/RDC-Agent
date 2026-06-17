import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationMessage, ConversationToolCall } from '@shared/types/conversation';
import { useConversationStore } from '../../../stores/conversationStore';
import { Button } from '../../../ui/Button';
import { useUserInputRequestSubmit } from './useUserInputRequestSubmit';

export interface PendingUserInputRequest {
  sessionId: string | null;
  turnId: string;
  toolCallId: string;
  question: string;
  choices: string[];
  agentId?: string;
}

type Selection = number | 'custom';

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
  const hasChoices = request.choices.length > 0;
  const [selection, setSelection] = useState<Selection>(hasChoices ? 0 : 'custom');
  const [customAnswer, setCustomAnswer] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customInputRef = useRef<HTMLInputElement>(null);
  const submitUserInput = useUserInputRequestSubmit();

  const resolvedAnswer = useMemo(() => {
    if (selection === 'custom') {
      return customAnswer.trim();
    }
    return request.choices[selection]?.trim() ?? '';
  }, [customAnswer, request.choices, selection]);

  const canSubmit = resolvedAnswer.length > 0 && !isSubmitting;

  const submitAnswer = useCallback(async () => {
    if (!canSubmit) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await submitUserInput(request, resolvedAnswer);
      setCustomAnswer('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit the answer.');
    } finally {
      setIsSubmitting(false);
    }
  }, [canSubmit, request, resolvedAnswer, submitUserInput]);

  useEffect(() => {
    if (selection === 'custom') {
      customInputRef.current?.focus();
    }
  }, [selection]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isSubmitting) return;

      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        void submitAnswer();
        return;
      }

      if (hasChoices && !event.ctrlKey && !event.altKey && !event.metaKey && /^[1-9]$/.test(event.key)) {
        const index = Number(event.key) - 1;
        if (index < request.choices.length) {
          event.preventDefault();
          setSelection(index);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasChoices, isSubmitting, request.choices.length, submitAnswer]);

  return (
    <section className="composer-user-input-panel" data-testid="composer-user-input-panel">
      <div className="composer-user-input-header">
        <span className="composer-user-input-kicker">Input requested</span>
        <p>{request.question}</p>
      </div>

      {hasChoices ? (
        <div className="composer-user-input-options" role="radiogroup" aria-label="Answer choices">
          {request.choices.map((choice, index) => {
            const isSelected = selection === index;
            return (
              <button
                key={`${index}-${choice}`}
                type="button"
                role="radio"
                aria-checked={isSelected}
                className={`composer-user-input-option${isSelected ? ' is-selected' : ''}`}
                disabled={isSubmitting}
                onClick={() => setSelection(index)}
              >
                <span className="composer-user-input-option-index" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="composer-user-input-option-label">{choice}</span>
                {isSelected ? (
                  <span className="composer-user-input-option-check" aria-hidden="true">
                    ✓
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <div
        className={`composer-user-input-custom${selection === 'custom' ? ' is-selected' : ''}`}
        role={hasChoices ? 'radio' : undefined}
        aria-checked={hasChoices ? selection === 'custom' : undefined}
      >
        {hasChoices ? (
          <button
            type="button"
            className="composer-user-input-custom-select"
            disabled={isSubmitting}
            onClick={() => setSelection('custom')}
          >
            <span className="composer-user-input-option-index" aria-hidden="true">
              {request.choices.length + 1}
            </span>
            <span className="composer-user-input-custom-label">Enter custom answer</span>
            {selection === 'custom' ? (
              <span className="composer-user-input-option-check" aria-hidden="true">
                ✓
              </span>
            ) : null}
          </button>
        ) : null}
        <input
          ref={customInputRef}
          type="text"
          className="composer-user-input-custom-field"
          value={customAnswer}
          onChange={(event) => {
            setCustomAnswer(event.target.value);
            if (hasChoices) {
              setSelection('custom');
            }
          }}
          onFocus={() => {
            if (hasChoices) {
              setSelection('custom');
            }
          }}
          placeholder="Type your answer..."
          disabled={isSubmitting}
          aria-label="Custom answer"
        />
      </div>

      <div className="composer-user-input-footer">
        <span className="composer-user-input-hint">Ctrl+Enter to submit</span>
        <Button
          variant="primary"
          size="sm"
          className="composer-user-input-submit"
          disabled={!canSubmit}
          onClick={() => void submitAnswer()}
        >
          Submit
        </Button>
      </div>

      {error ? (
        <p className="composer-user-input-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};
