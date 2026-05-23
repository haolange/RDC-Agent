import React, { useMemo, useState } from 'react';
import type {
  AskUserAnswer,
  AskUserPrompt,
  AskUserQuestion,
  DebugPlan,
  PlanPresentation,
} from '@shared/types/workflow';
import type { RunSummary } from '@shared/types/session';
import { useSessionStore } from '../../../stores/sessionStore';

const nextRunStateAfterQuestions = (
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

const hasAnswer = (answer?: { selectedOptionId?: string; freeformText?: string }): boolean => (
  Boolean(answer?.selectedOptionId) || Boolean(answer?.freeformText?.trim())
);

const buildFallbackPresentation = (debugPlan: DebugPlan): PlanPresentation => ({
  title: '执行前调试计划',
  sections: [
    {
      id: 'goal',
      title: '目标',
      body: [debugPlan.userGoal],
    },
    {
      id: 'scope',
      title: '范围',
      body: [
        debugPlan.targetCapture
          ? `Capture: ${debugPlan.targetCapture.fileName}`
          : 'Capture: 等待确认',
        debugPlan.targetFrameOrEvent?.eventLabel
          ? `入口: ${debugPlan.targetFrameOrEvent.eventLabel}`
          : debugPlan.scope,
        debugPlan.scope,
      ].filter(Boolean),
    },
    {
      id: 'deliverables',
      title: '交付物',
      body: debugPlan.expectedDeliverables,
    },
    {
      id: 'verification',
      title: '验证标准',
      body: debugPlan.verificationContract.successCriteria,
    },
  ],
});

const normalizePresentation = (debugPlan: DebugPlan): PlanPresentation => {
  const fallback = buildFallbackPresentation(debugPlan);
  const title = debugPlan.presentation?.title?.trim() || fallback.title;
  const sections = (debugPlan.presentation?.sections ?? [])
    .map((section) => ({
      id: section.id || section.title,
      title: section.title,
      body: section.body.map((line) => line.trim()).filter(Boolean),
    }))
    .filter((section) => section.title.trim() && section.body.length > 0);

  return {
    title,
    sections: sections.length > 0 ? sections : fallback.sections,
  };
};

interface AskUserQuestionCardProps {
  prompt: AskUserPrompt;
  answers: Record<string, { selectedOptionId?: string; freeformText?: string }>;
  busy: boolean;
  onAnswerChange: (
    questionId: string,
    patch: { selectedOptionId?: string; freeformText?: string },
  ) => void;
  onSubmit: () => void;
}

const AskUserQuestionCard: React.FC<AskUserQuestionCardProps> = ({
  prompt,
  answers,
  busy,
  onAnswerChange,
  onSubmit,
}) => {
  const [questionIndex, setQuestionIndex] = useState(0);
  const canSubmit = prompt.questions.length > 0
    && prompt.questions.every((question) => hasAnswer(answers[question.id]));
  const activeQuestionIndex = Math.min(questionIndex, Math.max(prompt.questions.length - 1, 0));
  const activeQuestion = prompt.questions[activeQuestionIndex];
  const hasPrevious = activeQuestionIndex > 0;
  const hasNext = activeQuestionIndex < prompt.questions.length - 1;

  const renderQuestion = (question: AskUserQuestion, questionIndex: number) => (
    <div key={question.id} className="ask-question" data-testid={`plan-question-${question.id}`}>
      <div className="ask-question-prompt">
        <span className="ask-question-number">{questionIndex + 1}</span>
        <span>{question.prompt}</span>
      </div>
      <div className="ask-question-options">
        {question.options.map((option, optionIndex) => {
          const selected = answers[question.id]?.selectedOptionId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              className={`ask-option ${selected ? 'selected' : ''} ${question.recommendedOptionId === option.id ? 'recommended' : ''}`}
              data-testid={`plan-option-${question.id}-${option.id}`}
              onClick={() => onAnswerChange(question.id, { selectedOptionId: option.id })}
            >
              <span className="ask-option-index">{optionIndex + 1}</span>
              <span className="ask-option-copy">
                <span className="ask-option-label">{option.label}</span>
                <span className="ask-option-description">{option.description}</span>
              </span>
            </button>
          );
        })}
      </div>
      <label className="ask-freeform-row">
        <span className="ask-option-index">{question.options.length + 1}</span>
        <input
          className="ask-freeform-input"
          placeholder={question.freeformPlaceholder || 'Enter custom answer'}
          value={answers[question.id]?.freeformText || ''}
          onChange={(event) => onAnswerChange(question.id, { freeformText: event.target.value })}
        />
      </label>
    </div>
  );

  return (
    <section className="ask-user-question-card" data-testid="ask-user-question-card">
      <header className="ask-user-question-header">
        <div>
          <h2>{prompt.title}</h2>
          {prompt.summary ? <p>{prompt.summary}</p> : null}
        </div>
        <span className="ask-user-question-count">
          {Math.min(activeQuestionIndex + 1, Math.max(prompt.questions.length, 1))}/{Math.max(prompt.questions.length, 1)}
        </span>
      </header>

      <div className="ask-user-question-body" data-testid="plan-questions">
        {activeQuestion ? renderQuestion(activeQuestion, activeQuestionIndex) : null}
      </div>

      <div className="ask-user-question-footer">
        <div className="ask-user-question-pager">
          <button
            type="button"
            className="ask-question-nav-button"
            aria-label="上一题"
            onClick={() => setQuestionIndex((current) => Math.max(current - 1, 0))}
            disabled={!hasPrevious || busy}
          >
            ‹
          </button>
          <button
            type="button"
            className="ask-question-nav-button"
            aria-label="下一题"
            onClick={() => setQuestionIndex((current) => Math.min(current + 1, prompt.questions.length - 1))}
            disabled={!hasNext || busy}
          >
            ›
          </button>
        </div>
        <button
          type="button"
          className="plan-action-button primary"
          data-testid="plan-submit-answers-button"
          onClick={onSubmit}
          disabled={!canSubmit || busy}
        >
          {busy ? '提交中...' : '提交回答'}
        </button>
      </div>
    </section>
  );
};

export const PlanApprovalCard: React.FC = () => {
  const currentRun = useSessionStore((state) => state.currentRun);
  const debugPlan = useSessionStore((state) => state.currentDebugPlan);
  const pendingQuestions = useSessionStore((state) => state.pendingQuestions);
  const workflowState = useSessionStore((state) => state.workflowState);
  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);
  const setCurrentDebugPlan = useSessionStore((state) => state.setCurrentDebugPlan);
  const setPendingQuestions = useSessionStore((state) => state.setPendingQuestions);

  const [busyAction, setBusyAction] = useState<'approve' | 'restart' | null>(null);
  const [planExpanded, setPlanExpanded] = useState(false);

  const effectiveDebugPlan = debugPlan ?? workflowState?.debugPlan ?? null;
  const effectivePendingQuestions = pendingQuestions ?? workflowState?.pendingQuestions ?? null;
  const presentation = useMemo(
    () => (effectiveDebugPlan ? normalizePresentation(effectiveDebugPlan) : null),
    [effectiveDebugPlan],
  );
  const approvalState = workflowState?.approvalState
    ?? (effectiveDebugPlan?.strictReady ? 'pending_user' : 'not_requested');
  const recoveryState = workflowState?.recoveryState ?? null;
  const canApprove = Boolean(
    currentRun
    && effectiveDebugPlan?.strictReady
    && approvalState !== 'approved'
    && !effectivePendingQuestions,
  );
  const blockers = effectiveDebugPlan?.blockers ?? [];
  const missingInfo = effectiveDebugPlan?.missingInfo ?? [];
  const shouldRender = Boolean(
    currentRun
    && (
      effectiveDebugPlan
      || recoveryState
      || currentRun.status === 'interrupted'
    ),
  );

  if (!currentRun || !shouldRender) {
    return null;
  }

  const handleApprove = async () => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;
    setBusyAction('approve');
    try {
      const result = await electronAPI.workflow.approvePlan(currentRun.runId);
      if (result.debugPlan !== undefined) {
        setCurrentDebugPlan(result.debugPlan ?? null);
      }
      setPendingQuestions(result.pendingQuestions ?? null);
      if (result.success) {
        setCurrentRun({
          ...currentRun,
          runId: result.runId ?? currentRun.runId,
          status: 'running',
          lastStage: 'dispatch',
        });
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleRestart = async () => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;
    setBusyAction('restart');
    try {
      const result = await electronAPI.workflow.restartRun(currentRun.runId);
      if (result.debugPlan !== undefined) {
        setCurrentDebugPlan(result.debugPlan ?? null);
      }
      setPendingQuestions(result.pendingQuestions ?? null);
      if (result.success && result.runId) {
        setCurrentRun({
          ...currentRun,
          runId: result.runId,
          status: 'awaiting_approval',
          lastStage: 'plan',
          stopReason: undefined,
        });
      }
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="plan-intake-panel plan-intake-panel-timeline" data-testid="plan-intake-panel">
      {effectiveDebugPlan && presentation && (
        <article className={`plan-document-card ${planExpanded ? 'expanded' : 'collapsed'}`}>
          <header className="plan-document-header">
            <div className="plan-document-heading">
              <span className="plan-intake-kicker">任务审批</span>
              <h2 className="plan-intake-title">{presentation.title}</h2>
            </div>
            <div className="plan-document-header-actions">
              <span className={`plan-intake-status status-${approvalState || 'idle'}`}>
                {approvalState || effectiveDebugPlan.planReadiness || currentRun.status}
              </span>
              <button
                type="button"
                className="plan-collapse-button"
                data-testid="plan-collapse-toggle"
                onClick={() => setPlanExpanded((current) => !current)}
                aria-expanded={planExpanded}
                aria-label={planExpanded ? '折叠计划' : '展开计划'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points={planExpanded ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
                </svg>
                <span>{planExpanded ? '折叠计划' : '展开计划'}</span>
              </button>
            </div>
          </header>

          {planExpanded ? (
            <div className="plan-document-body">
              {presentation.sections.map((section) => (
                <section key={section.id} className="plan-document-section">
                  <h3>{section.title}</h3>
                  <ul>
                    {section.body.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <div className="plan-document-preview">
              {presentation.sections.slice(0, 3).map((section) => (
                <div key={section.id} className="plan-document-preview-row">
                  <strong>{section.title}</strong>
                  <span>{section.body.slice(0, 2).join(' · ')}</span>
                </div>
              ))}
            </div>
          )}

          {missingInfo.length > 0 && (
            <div className="plan-callout plan-callout-warning" data-testid="plan-missing-info">
              待补信息：{missingInfo.join('、')}
            </div>
          )}

          {blockers.length > 0 && (
            <div className="plan-callout plan-callout-error" data-testid="plan-blockers">
              {blockers.map((blocker) => blocker.reason).join(' | ')}
            </div>
          )}

          <div className="plan-actions">
            <button
              type="button"
              className="plan-action-button primary"
              data-testid="plan-approve-button"
              onClick={() => void handleApprove()}
              disabled={!canApprove || busyAction !== null}
            >
              {busyAction === 'approve' ? '确认中...' : '确认并执行'}
            </button>
            {(recoveryState || currentRun.status === 'interrupted') && (
              <button
                type="button"
                className="plan-action-button"
                data-testid="plan-restart-button"
                onClick={() => void handleRestart()}
                disabled={busyAction !== null}
              >
                {busyAction === 'restart' ? '重启中...' : '重新开始'}
              </button>
            )}
          </div>
        </article>
      )}
    </section>
  );
};

export const PlanIntakePanel: React.FC = () => {
  const currentRun = useSessionStore((state) => state.currentRun);
  const pendingQuestions = useSessionStore((state) => state.pendingQuestions);
  const workflowState = useSessionStore((state) => state.workflowState);
  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);
  const setCurrentDebugPlan = useSessionStore((state) => state.setCurrentDebugPlan);
  const setPendingQuestions = useSessionStore((state) => state.setPendingQuestions);

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
    const electronAPI = window.electronAPI;
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

export default PlanIntakePanel;
