import React, { useMemo } from 'react';
import type { WorkflowStage } from '@shared/types/workflow';
import { AGENT_DISPLAY_NAMES, AGENT_ROLES } from '@shared/constants/agents';
import { useSessionStore } from '../../stores/sessionStore';

const UI_STAGES: Array<{ id: string; label: string; stages: WorkflowStage[] }> = [
  { id: 'planner', label: 'Planner', stages: ['preflight', 'entry_gate', 'intake_gate', 'plan', 'speclist'] },
  { id: 'generator', label: 'Generator', stages: ['dispatch', 'investigate'] },
  { id: 'evaluator', label: 'Evaluator', stages: ['fix_verify', 'skepti', 'curate', 'finalize'] },
];

export const TaskMonitor: React.FC = () => {
  const currentRun = useSessionStore((state) => state.currentRun);
  const contextSnapshot = useSessionStore((state) => state.contextSnapshot);
  const timeline = useSessionStore((state) => state.timeline);

  const currentStage = (currentRun?.lastStage as WorkflowStage | undefined) || 'preflight';
  const blockerEntries = timeline.filter((entry) => entry.type === 'blocker');
  const blockerCount = blockerEntries.length;

  const currentIndex = useMemo(() => {
    const index = UI_STAGES.findIndex((stage) => stage.stages.includes(currentStage));
    return index >= 0 ? index : 0;
  }, [currentStage]);

  const progress = currentRun
    ? Math.min(100, ((currentIndex + (currentStage === 'finalize' ? 1 : 0)) / UI_STAGES.length) * 100)
    : 0;

  const activeAgents = useMemo(() => {
    return timeline
      .filter((entry) => entry.type === 'agent' && entry.agentRole && AGENT_ROLES.includes(entry.agentRole))
      .slice(-3)
      .map((entry) => ({
        role: entry.agentRole!,
        content: entry.content,
      }));
  }, [timeline]);

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

      {blockerEntries.length > 0 && (
        <div className="task-blockers">
          {blockerEntries.slice(-2).map((entry) => (
            <div key={entry.id} className="task-blocker-item">
              <span className="status-icon-error">!</span>
              <span>{entry.content}</span>
            </div>
          ))}
        </div>
      )}

      {activeAgents.length > 0 && (
        <div className="task-agents">
          <div className="task-agents-header">
            <span>Recent Agents</span>
            <span className="task-agents-count">{activeAgents.length}</span>
          </div>
          <div className="task-agents-list">
            {activeAgents.map((agent, index) => (
              <div key={`${agent.role}-${index}`} className="task-agent">
                <div className={`task-agent-avatar ${agent.role.replace(/(_agent|rdc-)/g, '').replace(/_/g, '-')}`}>
                  {(AGENT_DISPLAY_NAMES[agent.role] || agent.role).charAt(0)}
                </div>
                <div className="task-agent-info">
                  <span className="task-agent-name">{AGENT_DISPLAY_NAMES[agent.role] || agent.role}</span>
                  <span className="task-agent-status">{agent.content.slice(0, 60)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="task-summary">
        <div className="task-summary-item">
          <span className="task-summary-label">Context</span>
          <span className="task-summary-value mono" title={contextSnapshot?.contextId}>
            {contextSnapshot?.contextId ? `${contextSnapshot.contextId.slice(0, 8)}…` : '--'}
          </span>
        </div>
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
