import { getElectronApi } from '../../../platform/getElectronApi';
import React, { useMemo, useState } from 'react';
import { useSessionStore } from '../../../stores/sessionStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useWorkflowStore } from '../../../stores/workflowStore';
import type { PlanApprovalState } from '@shared/types/workflow';
import { normalizePresentation } from './planHelpers';

export const PlanApprovalCard: React.FC = () => {
  const currentRun = useSessionStore((state) => state.currentRun);
  const currentSession = useProjectStore((state) => state.currentSession);
  const debugPlan = useWorkflowStore((state) => state.currentDebugPlan);
  const pendingQuestions = useWorkflowStore((state) => state.pendingQuestions);
  const workflowState = useWorkflowStore((state) => state.workflowState);
  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);
  const setRuns = useSessionStore((state) => state.setRuns);
  const setCurrentDebugPlan = useWorkflowStore((state) => state.setCurrentDebugPlan);
  const setPendingQuestions = useWorkflowStore((state) => state.setPendingQuestions);
  const setWorkflowState = useWorkflowStore((state) => state.setWorkflowState);

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
    && currentRun.status !== 'completed'
    && !effectivePendingQuestions,
  );
  const showApproveAction = Boolean(currentRun && approvalState !== 'approved' && currentRun.status !== 'completed');
  const blockers = effectiveDebugPlan?.blockers ?? [];
  const missingInfo = effectiveDebugPlan?.missingInfo ?? [];
  const shouldRender = Boolean(
    currentRun
    && (
      (effectiveDebugPlan && presentation)
      || recoveryState
      || currentRun.status === 'interrupted'
    ),
  );

  if (!currentRun || !shouldRender) {
    return null;
  }

  const handleApprove = async () => {
    const electronAPI = getElectronApi();
    if (!electronAPI) return;
    setBusyAction('approve');
    try {
      const result = await electronAPI.workflow.approvePlan(currentRun.runId);
      if (result.debugPlan !== undefined) {
        setCurrentDebugPlan(result.debugPlan ?? null);
      }
      setPendingQuestions(result.pendingQuestions ?? null);
      if (result.success) {
        const nextWorkflow = await electronAPI.workflow.getState().catch(() => null);
        if (nextWorkflow) {
          setWorkflowState(nextWorkflow);
          setCurrentDebugPlan(nextWorkflow.debugPlan ?? result.debugPlan ?? null);
          setPendingQuestions(nextWorkflow.pendingQuestions ?? null);
        } else if (workflowState) {
          setWorkflowState({
            ...workflowState,
            approvalState: (result.approvalState as PlanApprovalState | undefined) ?? 'approved',
            debugPlan: result.debugPlan ?? workflowState.debugPlan,
            runId: result.runId ?? workflowState.runId,
          });
        }
        if (currentSession?.sessionId) {
          const runs = await electronAPI.run.list(currentSession.sessionId).catch(() => null);
          const activeRun = runs?.runs?.find((run) => run.runId === (result.runId ?? currentRun.runId)) ?? null;
          if (runs?.runs) {
            setRuns(runs.runs);
          }
          if (activeRun) {
            setCurrentRun(activeRun);
          } else {
            setCurrentRun({
              ...currentRun,
              runId: result.runId ?? currentRun.runId,
              status: 'running',
              lastStage: 'dispatch',
            });
          }
        } else {
          setCurrentRun({
            ...currentRun,
            runId: result.runId ?? currentRun.runId,
            status: 'running',
            lastStage: 'dispatch',
          });
        }
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleRestart = async () => {
    const electronAPI = getElectronApi();
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
                <span>{planExpanded ? '鎶樺彔璁″垝' : '灞曞紑璁″垝'}</span>
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
                  <span>{section.body.slice(0, 2).join(' 路 ')}</span>
                </div>
              ))}
            </div>
          )}

          {planExpanded && missingInfo.length > 0 && (
            <div className="plan-callout plan-callout-warning" data-testid="plan-missing-info">
              待补信息：{missingInfo.join('、')}
            </div>
          )}

          {planExpanded && blockers.length > 0 && (
            <div className="plan-callout plan-callout-error" data-testid="plan-blockers">
              {blockers.map((blocker) => blocker.reason).join(' | ')}
            </div>
          )}

          <div className="plan-actions">
            {showApproveAction ? (
              <button
                type="button"
                className="plan-action-button primary"
                data-testid="plan-approve-button"
                onClick={() => void handleApprove()}
                disabled={!canApprove || busyAction !== null}
              >
                {busyAction === 'approve' ? '确认中...' : '确认并执行'}
              </button>
            ) : null}
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
