import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { ActiveSignalText } from '../../ui/ActiveSignalText';
import { Button } from '../../ui/Button';
import { ChevronIcon } from './userInputRequestIcons';
import { UserInputCustomAnswer, UserInputOptionList } from './UserInputRequestPanelParts';
import { useUserInputRequestSubmit } from './useUserInputRequestSubmit';
import {
  applyCustomDraft,
  applyOptionDraft,
  areAllQuestionsAnswered,
  buildAnswerPayload,
  createRequestFingerprint,
  isQuestionAnswered,
  type PendingUserInputRequest,
  type UserInputAnswerDrafts,
} from './userInputRequestModel';

export const UserInputRequestPanel: React.FC<{
  request: PendingUserInputRequest;
}> = ({ request }) => {
  const { t } = useI18n();
  const submitUserInput = useUserInputRequestSubmit();
  const requestFingerprint = useMemo(() => createRequestFingerprint(request), [request]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [drafts, setDrafts] = useState<UserInputAnswerDrafts>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submittingRef = useRef(false);

  const questionCount = request.questions.length;
  const currentQuestion = request.questions[Math.min(currentIndex, questionCount - 1)];
  const hasValidQuestions = questionCount > 0;
  const currentDraft = currentQuestion ? drafts[currentQuestion.questionId] : undefined;
  const selectedOptionId = currentDraft?.selectedOptionId;
  const customAnswer = selectedOptionId || currentDraft?.responseKind ? '' : currentDraft?.answer ?? '';
  const isBatch = questionCount > 1;
  const isLastQuestion = currentIndex >= questionCount - 1;
  const currentAnswered = currentQuestion ? isQuestionAnswered(currentQuestion, drafts) : false;
  const allAnswered = areAllQuestionsAnswered(request.questions, drafts);
  const footerActionLabel = t(!isLastQuestion ? 'chat.userInputNext' : 'chat.userInputSubmit');
  const enterAction = t(isLastQuestion ? 'chat.userInputEnterSubmit' : 'chat.userInputEnterContinue');
  const footerHint = currentQuestion?.allowFreeform
    ? t('chat.userInputNewlineHint', { action: enterAction })
    : enterAction;

  useEffect(() => {
    setCurrentIndex(0);
    setDrafts({});
    setIsSubmitting(false);
    setError(null);
  }, [requestFingerprint]);

  useEffect(() => {
    if (!currentQuestion?.allowFreeform || currentQuestion.options.length > 0) return;
    textareaRef.current?.focus();
  }, [currentQuestion]);

  const goToQuestion = useCallback((index: number) => {
    setCurrentIndex(Math.max(0, Math.min(index, questionCount - 1)));
    setError(null);
  }, [questionCount]);

  const submitAnswers = useCallback(async () => {
    if (submittingRef.current) return;
    const answers = buildAnswerPayload(request.questions, drafts);
    if (answers.length !== request.questions.length || isSubmitting) {
      setError(t('chat.userInputAnswerAll'));
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      await submitUserInput(request, answers);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('chat.userInputSubmitFailed');
      const missingQuestionId = /question\s+([^:\s.]+)/i.exec(message)?.[1];
      const missingQuestionIndex = missingQuestionId
        ? request.questions.findIndex((question) => question.questionId === missingQuestionId)
        : -1;
      if (missingQuestionIndex >= 0) {
        setCurrentIndex(missingQuestionIndex);
      }
      setError(message);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [drafts, isSubmitting, request, submitUserInput, t]);

  const advanceOrSubmit = useCallback(() => {
    if (!currentQuestion || isSubmitting) return;
    if (!currentAnswered) {
      setError(t('chat.userInputAnswerCurrent'));
      return;
    }
    if (!isLastQuestion) {
      goToQuestion(currentIndex + 1);
      return;
    }
    if (!allAnswered) {
      const firstMissing = request.questions.findIndex((question) => !isQuestionAnswered(question, drafts));
      goToQuestion(firstMissing >= 0 ? firstMissing : currentIndex);
      setError(t('chat.userInputAnswerAll'));
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
    t,
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
      if (event.isComposing || event.keyCode === 229) return;
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

  return (
    <section
      ref={panelRef}
      className="composer-user-input-panel"
      data-testid="composer-user-input-panel"
    >
      <div className="composer-user-input-question-bar">
        <div className="composer-user-input-header">
          <ActiveSignalText active tone="interaction" className="composer-user-input-kicker">{t('chat.userInputRequested')}</ActiveSignalText>
          <p>{currentQuestion?.prompt ?? t('chat.userInputIncomplete')}</p>
          {currentQuestion?.description ? (
            <span className="composer-user-input-question-description">{currentQuestion.description}</span>
          ) : null}
        </div>
        {hasValidQuestions && isBatch ? (
          <div className="composer-user-input-progress" aria-label={t('chat.userInputQuestionProgress', { current: currentIndex + 1, count: questionCount })}>
            <Button
              variant="ghost"
              size="sm"
              className="composer-user-input-nav-button"
              disabled={currentIndex === 0 || isSubmitting}
              aria-label={t('chat.userInputPreviousQuestion')}
              onClick={() => goToQuestion(currentIndex - 1)}
            >
              <ChevronIcon direction="left" />
            </Button>
            <span>{t('chat.userInputQuestionProgress', { current: currentIndex + 1, count: questionCount })}</span>
            <Button
              variant="ghost"
              size="sm"
              className="composer-user-input-nav-button"
              disabled={currentIndex >= questionCount - 1 || !currentAnswered || isSubmitting}
              aria-label={t('chat.userInputNextQuestion')}
              onClick={() => goToQuestion(currentIndex + 1)}
            >
              <ChevronIcon direction="right" />
            </Button>
          </div>
        ) : null}
      </div>

      {currentQuestion && currentQuestion.options.length > 0 ? (
        <UserInputOptionList
          question={currentQuestion}
          selectedOptionId={selectedOptionId}
          isSubmitting={isSubmitting}
          onSelect={selectOption}
        />
      ) : null}

      {currentQuestion?.allowFreeform ? (
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
        {currentQuestion ? (['unknown', ...(currentQuestion.required === false ? ['skipped'] : [])] as const).map(kind => (
          <Button key={kind} variant="ghost" size="sm" disabled={isSubmitting}
            aria-pressed={currentDraft?.responseKind === kind}
            className={currentDraft?.responseKind === kind ? 'is-selected' : undefined}
            onClick={() => { setDrafts(previous => ({ ...previous, [currentQuestion.questionId]: { answer: t(kind === 'unknown' ? 'chat.userInputUnknown' : 'chat.userInputSkip'), responseKind: kind as 'unknown' | 'skipped' } })); setError(null); }}>
            {t(kind === 'unknown' ? 'chat.userInputUnknown' : 'chat.userInputSkip')}
          </Button>
        )) : null}
        <Button
          variant="primary"
          size="sm"
          className="composer-user-input-submit"
          disabled={!hasValidQuestions || isSubmitting || (isLastQuestion ? !allAnswered : !currentAnswered)}
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
      {!hasValidQuestions ? (
        <p className="composer-user-input-error" role="alert">
          {t('chat.userInputIncomplete')}
        </p>
      ) : null}
    </section>
  );
};
