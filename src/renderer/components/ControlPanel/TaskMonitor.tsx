import React, { useMemo } from 'react';
import type { WorkflowStage } from '@shared/types/workflow';
import { AGENT_DISPLAY_NAMES } from '@shared/constants/agents';
import { useSessionStore } from '../../stores/sessionStore';

const UI_STAGES: Array<{ id: string; label: string; stages: WorkflowStage[] }> = [
  { id: 'planner', label: 'Planner', stages: ['preflight', 'entry_gate', 'intake_gate', 'plan', 'speclist'] },
  { id: 'generator', label: 'Generator', stages: ['dispatch', 'investigate'] },
  { id: 'evaluator', label: 'Evaluator', stages: ['fix_verify', 'skepti', 'curate', 'finalize'] },
];

export const TaskMonitor: React.FC = () => {
  const currentRun = useSessionStore((state) => state.currentRun);
  const workflowState = useSessionStore((state) => state.workflowState);
  const reasoningSummaries = useSessionStore((state) => state.reasoningSummaries);

  const currentStage = (currentRun?.lastStage as WorkflowStage | undefined) || workflowState?.currentStage || 'preflight';
  const blockerCount = workflowState?.blockers.length ?? 0;

  const currentIndex = useMemo(() => {
    const index = UI_STAGES.findIndex((stage) => stage.stages.includes(currentStage));
    return index >= 0 ? index : 0;
  }, [currentStage]);

  const progress = currentRun
    ? Math.min(100, ((currentIndex + (currentStage === 'finalize' ? 1 : 0)) / UI_STAGES.length) * 100)
    : 0;

  const recentReasoning = reasoningSummaries.slice(-2).reverse();

  return (
    <div className="task-monitor">
      <div className="task-progress">
        <div className="task-progress-bar">
          <div className="task-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="task-progress-text">{Math.round(progress)}%</div>
      </div>

      <div className="task-stages">
        {UI_STAGES.map((stage, index) => {
          const status = index < currentIndex ? 'completed' : index === currentIndex ? 'active' : 'pending';
          return (
            <div key={stage.id} className={`task-stage ${status}`}>
              <div className="task-stage-label">{stage.label}</div>
              <div className="task-stage-indicator">
                {status === 'completed' && <span className="task-summary-value success">✓</span>}
                {status === 'active' && <span className="pulse-dot" />}
              </div>
            </div>
          );
        })}
      </div>

      {blockerCount > 0 && (
        <div className="task-blockers">
          {(workflowState?.blockers ?? []).slice(0, 2).map((blocker) => (
            <div key={`${blocker.code}-${blocker.detectedAt}`} className="task-blocker-item">
              <span className="status-icon-error">!</span>
              <span>{blocker.reason}</span>
            </div>
          ))}
        </div>
      )}

      {recentReasoning.length > 0 && (
        <div className="task-agents">
          <div className="task-agents-header">
            <span>Recent Reasoning</span>
            <span className="task-agents-count">{recentReasoning.length}</span>
          </div>
          <div className="task-agents-list">
            {recentReasoning.map((summary) => (
              <div key={summary.summaryId} className="task-agent">
                <div className={`task-agent-avatar ${summary.agentId.replace(/(_agent|rdc-)/g, '').replace(/_/g, '-')}`}>
                  {(AGENT_DISPLAY_NAMES[summary.agentId] || summary.agentId).charAt(0)}
                </div>
                <div className="task-agent-info">
                  <span className="task-agent-name">{AGENT_DISPLAY_NAMES[summary.agentId] || summary.agentId}</span>
                  <span className="task-agent-status">{summary.summary.slice(0, 72)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="task-summary">
        <div className="task-summary-item">
          <span className="task-summary-label">Blockers</span>
          <span className={`task-summary-value ${blockerCount > 0 ? 'error' : ''}`}>{blockerCount}</span>
        </div>
        <div className="task-summary-item">
          <span className="task-summary-label">Stage</span>
          <span className="task-summary-value active">{currentRun ? currentStage : 'idle'}</span>
        </div>
      </div>
    </div>
  );
};

export default TaskMonitor;
