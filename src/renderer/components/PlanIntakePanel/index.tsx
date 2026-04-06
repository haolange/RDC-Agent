import React, { useMemo, useState } from 'react';
import type { AskUserAnswer } from '@shared/types/workflow';
import { useSessionStore } from '../../stores/sessionStore';

export const PlanIntakePanel: React.FC = () => {
  const currentRun = useSessionStore((state) => state.currentRun);
  const debugPlan = useSessionStore((state) => state.currentDebugPlan);
  const pendingQuestions = useSessionStore((state) => state.pendingQuestions);
  const workflowState = useSessionStore((state) => state.workflowState);
  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);
  const setCurrentDebugPlan = useSessionStore((state) => state.setCurrentDebugPlan);
  const setPendingQuestions = useSessionStore((state) => state.setPendingQuestions);

  const [answers, setAnswers] = useState<Record<string, { selectedOptionId?: string; freeformText?: string }>>({});
  const [busyAction, setBusyAction] = useState<'submit' | 'approve' | 'restart' | null>(null);

  const canApprove = Boolean(currentRun && debugPlan?.strictReady && workflowState?.approvalState !== 'approved');
  const blockers = debugPlan?.blockers ?? [];
  const missingInfo = debugPlan?.missingInfo ?? [];

  const answerPayload = useMemo<AskUserAnswer[]>(() => (
    pendingQuestions?.questions.map((question) => ({
      questionId: question.id,
      selectedOptionId: answers[question.id]?.selectedOptionId,
      freeformText: answers[question.id]?.freeformText,
    })) ?? []
  ), [answers, pendingQuestions]);

  if (!currentRun || (!debugPlan && !pendingQuestions && !workflowState?.recoveryState && currentRun.status !== 'interrupted')) {
    return null;
  }

  const handleSubmitAnswers = async () => {
    if (!currentRun) return;
    setBusyAction('submit');
    try {
      const result = await window.electronAPI.workflow.submitQuestions(currentRun.runId, answerPayload);
      if (result.success) {
        setCurrentDebugPlan(result.debugPlan ?? null);
        setPendingQuestions(result.pendingQuestions ?? null);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleApprove = async () => {
    if (!currentRun) return;
    setBusyAction('approve');
    try {
      await window.electronAPI.workflow.approvePlan(currentRun.runId);
    } finally {
      setBusyAction(null);
    }
  };

  const handleRestart = async () => {
    if (!currentRun) return;
    setBusyAction('restart');
    try {
      const result = await window.electronAPI.workflow.restartRun(currentRun.runId);
      if (result.success && result.runId) {
        setCurrentRun({
          ...currentRun,
          runId: result.runId,
          status: 'awaiting_approval',
          lastStage: 'plan',
        });
        setCurrentDebugPlan(result.debugPlan ?? null);
        setPendingQuestions(result.pendingQuestions ?? null);
      }
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="plan-intake-panel" data-testid="plan-intake-panel">
      <div className="plan-intake-header">
        <div>
          <div className="plan-intake-kicker">Plan / Intake</div>
          <h2 className="plan-intake-title">Debugger execution is gated by an approved debug plan</h2>
        </div>
        <div className={`plan-intake-status status-${workflowState?.approvalState || 'idle'}`}>
          {workflowState?.approvalState || debugPlan?.planReadiness || currentRun.status}
        </div>
      </div>

      {debugPlan && (
        <div className="plan-summary-grid">
          <div className="plan-summary-card">
            <span className="plan-summary-label">Goal</span>
            <p>{debugPlan.userGoal}</p>
          </div>
          <div className="plan-summary-card">
            <span className="plan-summary-label">Target Capture</span>
            <p>{debugPlan.targetCapture?.fileName || 'Pending selection'}</p>
          </div>
          <div className="plan-summary-card">
            <span className="plan-summary-label">Scope</span>
            <p>{debugPlan.targetFrameOrEvent?.eventLabel || debugPlan.scope}</p>
          </div>
          <div className="plan-summary-card">
            <span className="plan-summary-label">Deliverables</span>
            <ul>
              {debugPlan.expectedDeliverables.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {missingInfo.length > 0 && (
        <div className="plan-callout plan-callout-warning" data-testid="plan-missing-info">
          Missing info: {missingInfo.join(', ')}
        </div>
      )}

      {blockers.length > 0 && (
        <div className="plan-callout plan-callout-error" data-testid="plan-blockers">
          {blockers.map((blocker) => blocker.reason).join(' | ')}
        </div>
      )}

      {pendingQuestions && (
        <div className="plan-questions" data-testid="plan-questions">
          <h3>{pendingQuestions.title}</h3>
          <p>{pendingQuestions.summary}</p>
          {pendingQuestions.questions.map((question) => (
            <div key={question.id} className="plan-question" data-testid={`plan-question-${question.id}`}>
              <div className="plan-question-prompt">{question.prompt}</div>
              <div className="plan-question-options">
                {question.options.map((option) => (
                  <label key={option.id} className={`plan-option ${question.recommendedOptionId === option.id ? 'recommended' : ''}`}>
                    <input
                      type="radio"
                      name={question.id}
                      checked={answers[question.id]?.selectedOptionId === option.id}
                      onChange={() => setAnswers((current) => ({
                        ...current,
                        [question.id]: {
                          ...current[question.id],
                          selectedOptionId: option.id,
                        },
                      }))}
                    />
                    <span className="plan-option-copy">
                      <span className="plan-option-label">{option.label}</span>
                      <span className="plan-option-description">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
              <input
                className="plan-freeform-input"
                placeholder={question.freeformPlaceholder || 'Optional freeform input'}
                value={answers[question.id]?.freeformText || ''}
                onChange={(event) => setAnswers((current) => ({
                  ...current,
                  [question.id]: {
                    ...current[question.id],
                    freeformText: event.target.value,
                  },
                }))}
              />
            </div>
          ))}
          <div className="plan-actions">
            <button
              type="button"
              className="plan-action-button"
              data-testid="plan-submit-answers-button"
              onClick={() => void handleSubmitAnswers()}
              disabled={busyAction !== null}
            >
              {busyAction === 'submit' ? 'Submitting…' : 'Submit Answers'}
            </button>
          </div>
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
          {busyAction === 'approve' ? 'Approving…' : 'Approve & Run'}
        </button>
        {(workflowState?.recoveryState || currentRun.status === 'interrupted') && (
          <button
            type="button"
            className="plan-action-button"
            data-testid="plan-restart-button"
            onClick={() => void handleRestart()}
            disabled={busyAction !== null}
          >
            {busyAction === 'restart' ? 'Restarting…' : 'Restart Run'}
          </button>
        )}
      </div>
    </section>
  );
};

export default PlanIntakePanel;
