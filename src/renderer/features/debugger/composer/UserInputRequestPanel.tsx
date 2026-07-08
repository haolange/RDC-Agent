import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConversationStore } from '../../../stores/conversationStore';
import { ActiveSignalText } from '../../../ui/ActiveSignalText';
import { Button } from '../../../ui/Button';
import { ChevronIcon } from './userInputRequestIcons';
import { UserInputCustomAnswer, UserInputOptionList } from './UserInputRequestPanelParts';
import { useUserInputRequestSubmit } from './useUserInputRequestSubmit';
import {
  applyCustomDraft,
  applyOptionDraft,
  areAllQuestionsAnswered,
  buildAnswerPayload,
  createRequestFingerprint,
  findPendingUserInput,
  isQuestionAnswered,
  type PendingUserInputRequest,
  type UserInputAnswerDrafts,
} from './userInputRequestModel';

export type { PendingUserInputRequest } from './userInputRequestModel';

export const usePendingUserInputRequest = (): PendingUserInputRequest | null => {
  const messages = useConversationStore((state) => state.conversationMessages);
  return useMemo(() => findPendingUserInput(messages), [messages]);
};

export const UserInputRequestPanel: React.FC<{
  request: PendingUserInputRequest;
}> = ({ request }) => {
  const submitUserInput = useUserInputRequestSubmit();
  const requestFingerprint = useMemo(() => createRequestFingerprint(request), [request]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [drafts, setDrafts] = useState<UserInputAnswerDrafts>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const questionCount = request.questions.length;
  const currentQuestion = request.questions[Math.min(currentIndex, questionCount - 1)];
  const currentDraft = currentQuestion ? drafts[currentQuestion.questionId] : undefined;
  const selectedOptionId = currentDraft?.selectedOptionId;
  const customAnswer = selectedOptionId ? '' : currentDraft?.answer ?? '';
  const isBatch = questionCount > 1;
  const isLastQuestion = currentIndex >= questionCount - 1;
  const currentAnswered = currentQuestion ? isQuestionAnswered(currentQuestion, drafts) : false;
  const allAnswered = areAllQuestionsAnswered(request.questions, drafts);
  const footerActionLabel = !isLastQuestion ? 'Next' : 'Submit';
  const footerHint = currentQuestion?.allowFreeform
    ? (isLastQuestion ? 'Enter to submit · Shift+Enter for newline' : 'Enter to continue · Shift+Enter for newline')
    : (isLastQuestion ? 'Enter to submit' : 'Enter to continue');

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);

  useEffect(() => {
    setCurrentIndex(0);
    setDrafts({});
    setIsSubmitting(false);
    setError(null);
  }, [requestFingerprint]);

  useEffect(() => {
    resizeTextarea();
  }, [customAnswer, currentIndex, resizeTextarea]);

  useEffect(() => {
    if (!currentQuestion?.allowFreeform || currentQuestion.options.length > 0) return;
    textareaRef.current?.focus();
  }, [currentQuestion]);

  const goToQuestion = useCallback((index: number) => {
    setCurrentIndex(Math.max(0, Math.min(index, questionCount - 1)));
    setError(null);
  }, [questionCount]);

  const submitAnswers = useCallback(async () => {
    const answers = buildAnswerPayload(request.questions, drafts);
    if (answers.length !== request.questions.length || isSubmitting) {
      setError('Answer every question before submitting.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await submitUserInput(request, answers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit the answers.');
    } finally {
      setIsSubmitting(false);
    }
  }, [drafts, isSubmitting, request, submitUserInput]);

  const advanceOrSubmit = useCallback(() => {
    if (!currentQuestion || isSubmitting) return;
    if (!currentAnswered) {
      setError('Answer the current question before continuing.');
      return;
    }
    if (!isLastQuestion) {
      goToQuestion(currentIndex + 1);
      return;
    }
    if (!allAnswered) {
      const firstMissing = request.questions.findIndex((question) => !isQuestionAnswered(question, drafts));
      goToQuestion(firstMissing >= 0 ? firstMissing : currentIndex);
      setError('Answer every question before submitting.');
      return;
    }
    void submitAnswers();
  }, [
    allAnswered,
    currentAnswered,
    currentIndex,
    currentQuestion,
    drafts,
    goToQuestion,
    isLastQuestion,
    isSubmitting,
    request.questions,
    submitAnswers,
  ]);

  const selectOption = useCallback((optionId: string) => {
    if (!currentQuestion || isSubmitting) return;
    const option = currentQuestion.options.find((entry) => entry.optionId === optionId);
    if (!option) return;
    setDrafts((previous) => applyOptionDraft(previous, currentQuestion, option));
    setError(null);
    if (isBatch && !isLastQuestion) {
      setCurrentIndex((previous) => Math.min(previous + 1, questionCount - 1));
    }
  }, [currentQuestion, isBatch, isLastQuestion, isSubmitting, questionCount]);

  const updateCustomAnswer = useCallback((answer: string) => {
    if (!currentQuestion || isSubmitting) return;
    setDrafts((previous) => applyCustomDraft(previous, currentQuestion, answer));
    setError(null);
  }, [currentQuestion, isSubmitting]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement;
      if (activeElement && panelRef.current && !panelRef.current.contains(activeElement)) return;
      if (isSubmitting) return;

      const target = event.target as HTMLElement | null;
      const isTextarea = target?.tagName === 'TEXTAREA';
      if (isTextarea && event.key === 'Enter' && event.shiftKey) return;

      if (event.key === 'Enter' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        const isCommandButton = target?.tagName === 'BUTTON'
          && !target.classList.contains('composer-user-input-option');
        if (isCommandButton) return;
        event.preventDefault();
        advanceOrSubmit();
        return;
      }

      if (
        !isTextarea
        && currentQuestion
        && !event.ctrlKey
        && !event.altKey
        && !event.metaKey
        && /^[1-9]$/.test(event.key)
      ) {
        const option = currentQuestion.options[Number(event.key) - 1];
        if (option) {
          event.preventDefault();
          selectOption(option.optionId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [advanceOrSubmit, currentQuestion, isSubmitting, selectOption]);

  if (!currentQuestion) return null;

  return (
    <section
      ref={panelRef}
      className="composer-user-input-panel"
      data-testid="composer-user-input-panel"
    >
      <div className="composer-user-input-question-bar">
        <div className="composer-user-input-header">
          <ActiveSignalText active tone="interaction" className="composer-user-input-kicker">Input requested</ActiveSignalText>
          <p>{currentQuestion.prompt}</p>
          {currentQuestion.description ? (
            <span className="composer-user-input-question-description">{currentQuestion.description}</span>
          ) : null}
        </div>
        {isBatch ? (
          <div className="composer-user-input-progress" aria-label="Question navigation">
            <Button
              variant="ghost"
              size="sm"
              className="composer-user-input-nav-button"
              disabled={currentIndex === 0 || isSubmitting}
              aria-label="Previous question"
              onClick={() => goToQuestion(currentIndex - 1)}
            >
              <ChevronIcon direction="left" />
            </Button>
            <span>{currentIndex + 1} of {questionCount}</span>
            <Button
              variant="ghost"
              size="sm"
              className="composer-user-input-nav-button"
              disabled={currentIndex >= questionCount - 1 || !currentAnswered || isSubmitting}
              aria-label="Next question"
              onClick={() => goToQuestion(currentIndex + 1)}
            >
              <ChevronIcon direction="right" />
            </Button>
          </div>
        ) : null}
      </div>

      {currentQuestion.options.length > 0 ? (
        <UserInputOptionList
          question={currentQuestion}
          selectedOptionId={selectedOptionId}
          isSubmitting={isSubmitting}
          onSelect={selectOption}
        />
      ) : null}

      {currentQuestion.allowFreeform ? (
        <UserInputCustomAnswer
          question={currentQuestion}
          selectedOptionId={selectedOptionId}
          customAnswer={customAnswer}
          isSubmitting={isSubmitting}
          textareaRef={textareaRef}
          onChange={updateCustomAnswer}
        />
      ) : null}

      <div className="composer-user-input-footer">
        <span className="composer-user-input-hint">{footerHint}</span>
        <Button
          variant="primary"
          size="sm"
          className="composer-user-input-submit"
          disabled={isSubmitting || (isLastQuestion ? !allAnswered : !currentAnswered)}
          onClick={advanceOrSubmit}
        >
          {footerActionLabel}
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
