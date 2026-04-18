import React, { useMemo, useState } from 'react';
import type { AskUserAnswer } from '@shared/types/workflow';
import type { RunSummary } from '@shared/types/session';
import { useSessionStore } from '../../stores/sessionStore';

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

  const effectiveDebugPlan = debugPlan ?? workflowState?.debugPlan ?? null;
  const effectivePendingQuestions = pendingQuestions ?? workflowState?.pendingQuestions ?? null;
  const approvalState = workflowState?.approvalState
    ?? (effectiveDebugPlan?.strictReady ? 'pending_user' : 'not_requested');
  const recoveryState = workflowState?.recoveryState ?? null;
  const canApprove = Boolean(currentRun && effectiveDebugPlan?.strictReady && approvalState !== 'approved');
  const blockers = effectiveDebugPlan?.blockers ?? [];
  const missingInfo = effectiveDebugPlan?.missingInfo ?? [];
  const shouldRender = Boolean(
    currentRun
    && (
      effectiveDebugPlan
      || effectivePendingQuestions
      || recoveryState
      || currentRun.status === 'interrupted'
    ),
  );

  const answerPayload = useMemo<AskUserAnswer[]>(() => (
    effectivePendingQuestions?.questions.map((question) => ({
      questionId: question.id,
      selectedOptionId: answers[question.id]?.selectedOptionId,
      freeformText: answers[question.id]?.freeformText,
    })) ?? []
  ), [answers, effectivePendingQuestions]);

  if (!currentRun || !shouldRender) {
    return null;
  }

  const handleSubmitAnswers = async () => {
    setBusyAction('submit');
    try {
      const result = await window.electronAPI.workflow.submitQuestions(currentRun.runId, answerPayload);
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

  const handleApprove = async () => {
    setBusyAction('approve');
    try {
      const result = await window.electronAPI.workflow.approvePlan(currentRun.runId);
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
    setBusyAction('restart');
    try {
      const result = await window.electronAPI.workflow.restartRun(currentRun.runId);
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
    <section className="plan-intake-panel" data-testid="plan-intake-panel">
      <div className="plan-intake-header">
        <div>
          <div className="plan-intake-kicker">任务审批</div>
          <h2 className="plan-intake-title">执行前需要确认调试计划与关键输入</h2>
        </div>
        <div className={`plan-intake-status status-${approvalState || 'idle'}`}>
          {approvalState || effectiveDebugPlan?.planReadiness || currentRun.status}
        </div>
      </div>

      {effectiveDebugPlan && (
        <div className="plan-summary-grid">
          <div className="plan-summary-card">
            <span className="plan-summary-label">目标</span>
            <p>{effectiveDebugPlan.userGoal}</p>
          </div>
          <div className="plan-summary-card">
            <span className="plan-summary-label">目标 Capture</span>
            <p>{effectiveDebugPlan.targetCapture?.fileName || 'Pending selection'}</p>
          </div>
          <div className="plan-summary-card">
            <span className="plan-summary-label">范围</span>
            <p>{effectiveDebugPlan.targetFrameOrEvent?.eventLabel || effectiveDebugPlan.scope}</p>
          </div>
          <div className="plan-summary-card">
            <span className="plan-summary-label">交付物</span>
            <ul>
              {effectiveDebugPlan.expectedDeliverables.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
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

      {effectivePendingQuestions && (
        <div className="plan-questions" data-testid="plan-questions">
          <h3>{effectivePendingQuestions.title}</h3>
          <p>{effectivePendingQuestions.summary}</p>
          {effectivePendingQuestions.questions.map((question) => (
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
                placeholder={question.freeformPlaceholder || '可补充说明'}
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
              {busyAction === 'submit' ? '提交中…' : '提交回答'}
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
          {busyAction === 'approve' ? '确认中…' : '确认并执行'}
        </button>
        {(recoveryState || currentRun.status === 'interrupted') && (
          <button
            type="button"
            className="plan-action-button"
            data-testid="plan-restart-button"
            onClick={() => void handleRestart()}
            disabled={busyAction !== null}
          >
            {busyAction === 'restart' ? '重启中…' : '重新开始'}
          </button>
        )}
      </div>
    </section>
  );
};

export default PlanIntakePanel;
