import { getElectronApi } from '../../../platform/getElectronApi';
import React, { useState } from 'react';
import { useSessionStore } from '../../../stores/sessionStore';
import { useWorkflowStore } from '../../../stores/workflowStore';

export const ComposerApprovalOverlay: React.FC = () => {
  const currentRun = useSessionStore((state) => state.currentRun);
  const presentation = useWorkflowStore((state) => state.workstreamPresentation);
  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);
  const setWorkstreamPresentation = useWorkflowStore((state) => state.setWorkstreamPresentation);
  const setCurrentDebugPlan = useWorkflowStore((state) => state.setCurrentDebugPlan);
  const setPendingQuestions = useWorkflowStore((state) => state.setPendingQuestions);
  const [revisionText, setRevisionText] = useState('');
  const [busyAction, setBusyAction] = useState<'approve' | 'revision' | null>(null);
  const approval = presentation?.approval ?? null;
  const runId = currentRun?.runId ?? approval?.runId ?? null;

  if (!approval || !runId) {
    return null;
  }

  const refreshWorkstream = async () => {
    const sessionId = presentation?.sessionId;
    if (!sessionId) return;
    const result = await getElectronApi()?.workflow.getWorkstreamSession(sessionId);
    if (result?.presentation) {
      setWorkstreamPresentation(result.presentation);
    }
  };

  const handleApprove = async () => {
    const electronAPI = getElectronApi();
    if (!electronAPI) return;
    setBusyAction('approve');
    try {
      const result = await electronAPI.workflow.approvePlan(runId);
      if (result.debugPlan !== undefined) {
        setCurrentDebugPlan(result.debugPlan ?? null);
      }
      setPendingQuestions(result.pendingQuestions ?? null);
      if (result.success && currentRun) {
        setCurrentRun({
          ...currentRun,
          runId: result.runId ?? currentRun.runId,
          status: 'running',
          lastStage: 'dispatch',
        });
      }
      await refreshWorkstream();
    } finally {
      setBusyAction(null);
    }
  };

  const handleRevision = async () => {
    const electronAPI = getElectronApi();
    const trimmed = revisionText.trim();
    if (!electronAPI || !trimmed) return;
    setBusyAction('revision');
    try {
      const result = await electronAPI.workflow.requestPlanRevision(runId, trimmed);
      if (result.presentation) {
        setWorkstreamPresentation(result.presentation);
      }
      if (result.runId && currentRun) {
        setCurrentRun({
          ...currentRun,
          runId: result.runId,
          status: 'awaiting_approval',
          lastStage: 'plan',
        });
      }
      setRevisionText('');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="composer-approval-overlay" data-testid="composer-approval-overlay">
      <header className="composer-approval-header">
        <div>
          <span className="ask-user-question-kicker">等待审批</span>
          <h2>{approval.title}</h2>
          <p>{approval.summary}</p>
        </div>
        <span className="plan-intake-status status-pending_user">{approval.status}</span>
      </header>
      <div className="composer-approval-actions">
        <button
          type="button"
          className="plan-action-button primary"
          data-testid="composer-approve-button"
          onClick={() => void handleApprove()}
          disabled={!approval.canApprove || busyAction !== null}
        >
          {busyAction === 'approve' ? '确认中…' : '同意执行'}
        </button>
      </div>
      <div className="composer-revision-row">
        <textarea
          value={revisionText}
          onChange={(event) => setRevisionText(event.target.value)}
          placeholder="输入修改建议，不会覆盖历史计划"
          data-testid="composer-revision-input"
          rows={2}
          disabled={busyAction !== null}
        />
        <button
          type="button"
          className="plan-action-button"
          data-testid="composer-revision-button"
          onClick={() => void handleRevision()}
          disabled={!approval.canRequestRevision || !revisionText.trim() || busyAction !== null}
        >
          {busyAction === 'revision' ? '提交中...' : '提交修改建议'}
        </button>
      </div>
    </section>
  );
};
