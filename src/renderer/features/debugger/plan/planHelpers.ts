import type { DebugPlan, PlanPresentation } from '@shared/types/workflow';
import type { RunSummary } from '@shared/types/session';

export const nextRunStateAfterQuestions = (
  currentRun: RunSummary,
  strictReady: boolean,
  hasBlockers: boolean,
): RunSummary => {
  if (hasBlockers) {
    return {
      ...currentRun,
      status: 'failed',
      lastStage: 'plan',
    };
  }

  if (strictReady) {
    return {
      ...currentRun,
      status: 'awaiting_approval',
      lastStage: 'plan',
    };
  }

  return {
    ...currentRun,
    status: 'awaiting_input',
    lastStage: 'awaiting_user_input',
  };
};

export const hasAnswer = (answer?: { selectedOptionId?: string; freeformText?: string }): boolean => (
  Boolean(answer?.selectedOptionId) || Boolean(answer?.freeformText?.trim())
);

export const normalizePresentation = (debugPlan: DebugPlan): PlanPresentation | null => {
  const title = debugPlan.presentation?.title?.trim();
  const sections = (debugPlan.presentation?.sections ?? [])
    .map((section) => ({
      id: section.id || section.title,
      title: section.title,
      body: section.body.map((line) => line.trim()).filter(Boolean),
    }))
    .filter((section) => section.title.trim() && section.body.length > 0);

  return title && sections.length > 0 ? { title, sections } : null;
};
