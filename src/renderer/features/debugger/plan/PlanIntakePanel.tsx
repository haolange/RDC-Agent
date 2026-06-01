import { getElectronApi } from '../../../platform/getElectronApi';
import React, { useMemo, useState } from 'react';
import type { AskUserAnswer } from '@shared/types/workflow';
import { useSessionStore } from '../../../stores/sessionStore';
import { useWorkflowStore } from '../../../stores/workflowStore';
import { AskUserQuestionCard } from './AskUserQuestionCard';
import { nextRunStateAfterQuestions } from './planHelpers';

export const PlanIntakePanel: React.FC = () => {
  const currentRun = useSessionStore((state) => state.currentRun);
  const pendingQuestions = useWorkflowStore((state) => state.pendingQuestions);
  const workflowState = useWorkflowStore((state) => state.workflowState);
  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);
  const setCurrentDebugPlan = useWorkflowStore((state) => state.setCurrentDebugPlan);
  const setPendingQuestions = useWorkflowStore((state) => state.setPendingQuestions);

  const [answers, setAnswers] = useState<Record<string, { selectedOptionId?: string; freeformText?: string }>>({});
  const [busyAction, setBusyAction] = useState<'submit' | null>(null);

  const effectivePendingQuestions = pendingQuestions ?? workflowState?.pendingQuestions ?? null;
  const answerPayload = useMemo<AskUserAnswer[]>(() => (
    effectivePendingQuestions?.questions.map((question) => ({
      questionId: question.id,
      selectedOptionId: answers[question.id]?.selectedOptionId,
      freeformText: answers[question.id]?.freeformText,
    })) ?? []
  ), [answers, effectivePendingQuestions]);

  if (!currentRun || !effectivePendingQuestions) {
    return null;
  }

  const handleAnswerChange = (
    questionId: string,
    patch: { selectedOptionId?: string; freeformText?: string },
  ) => {
    setAnswers((current) => ({
      ...current,
      [questionId]: {
        ...current[questionId],
        ...patch,
      },
    }));
  };

  const handleSubmitAnswers = async () => {
    const electronAPI = getElectronApi();
    if (!electronAPI) return;
    setBusyAction('submit');
    try {
      const result = await electronAPI.workflow.submitQuestions(currentRun.runId, answerPayload);
      if (result.debugPlan !== undefined) {
        setCurrentDebugPlan(result.debugPlan ?? null);
      }
      if (result.pendingQuestions !== undefined) {
        setPendingQuestions(result.pendingQuestions ?? null);
      }
      if (result.success && result.debugPlan) {
        setCurrentRun(nextRunStateAfterQuestions(
          {
            ...currentRun,
            runId: result.runId ?? currentRun.runId,
          },
          Boolean(result.debugPlan.strictReady),
          (result.debugPlan.blockers?.length ?? 0) > 0,
        ));
      }
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="ask-user-question-panel" data-testid="ask-user-question-panel">
      <AskUserQuestionCard
        prompt={effectivePendingQuestions}
        answers={answers}
        busy={busyAction === 'submit'}
        onAnswerChange={handleAnswerChange}
        onSubmit={() => void handleSubmitAnswers()}
      />
    </section>
  );
};
