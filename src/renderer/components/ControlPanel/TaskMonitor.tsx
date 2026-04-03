import React, { useMemo } from 'react';
import type { WorkflowStage } from '@shared/types/workflow';
import { AGENT_DISPLAY_NAMES } from '@shared/constants/agents';
import { useSessionStore } from '../../stores/sessionStore';

interface UiStageDefinition {
  id: string;
  label: string;
  stages: WorkflowStage[];
  icon: React.ReactNode;
}

const UI_STAGES: UiStageDefinition[] = [
  {
    id: 'preflight',
    label: 'Preflight',
    stages: ['preflight_pending', 'intent_gate_passed'],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
  },
  {
    id: 'intake',
    label: 'Intake',
    stages: ['entry_gate_passed', 'accepted_intake_initialized', 'intake_gate_passed'],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
  },
  {
    id: 'dispatch',
    label: 'Dispatch',
    stages: ['waiting_for_specialist_brief'],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 2 11 13" />
        <path d="M22 2 15 22 11 13 2 9 22 2z" />
      </svg>
    ),
  },
  {
    id: 'specialist',
    label: 'Specialist',
    stages: ['specialist_briefs_collected'],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    id: 'investigation',
    label: 'Investigation',
    stages: ['expert_investigation_complete'],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
    ),
  },
  {
    id: 'verify',
    label: 'Verify',
    stages: ['fix_verification_complete', 'skeptic_ready'],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 12l2 2 4-4" />
        <circle cx="12" cy="12" r="10" />
      </svg>
    ),
  },
  {
    id: 'final',
    label: 'Final',
    stages: ['curator_ready', 'finalized'],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 4h10l-1 5h7l-3 6h-6l-1 5H4V4z" />
      </svg>
    ),
  },
];

export const TaskMonitor: React.FC = () => {
  const currentRun = useSessionStore((s) => s.currentRun);
  const contextSnapshot = useSessionStore((s) => s.contextSnapshot);
  const timeline = useSessionStore((s) => s.timeline);

  // Derive current stage from currentRun.lastStage
  const currentStage: WorkflowStage | null = currentRun
    ? (currentRun.lastStage as WorkflowStage)
    : null;

  // Determine blockers from timeline
  const blockerEntries = timeline.filter((e) => e.type === 'blocker');
  const blockerCount = blockerEntries.length;

  const isBlocked = currentStage === 'validation_blocked';
  const isWaitingForInput = currentStage === 'awaiting_user_input';

  const currentIndex = useMemo(() => {
    if (!currentStage) return 0;
    const stageToResolve =
      currentStage === 'validation_blocked' || currentStage === 'awaiting_user_input'
        ? ('preflight_pending' as WorkflowStage)
        : currentStage;
    const idx = UI_STAGES.findIndex((s) => s.stages.includes(stageToResolve));
    return idx >= 0 ? idx : 0;
  }, [currentStage]);

  const progress = useMemo(() => {
    if (!currentRun) return 0;
    const done = currentStage === 'finalized' ? 1 : 0;
    return Math.min(100, ((currentIndex + done) / UI_STAGES.length) * 100);
  }, [currentIndex, currentRun, currentStage]);

  const getStageStatus = (index: number): 'pending' | 'active' | 'completed' | 'blocked' | 'warning' => {
    if (index < currentIndex) return 'completed';
    if (index > currentIndex) return 'pending';
    if (isBlocked) return 'blocked';
    if (isWaitingForInput) return 'warning';
    return 'active';
  };

  // Active agents from timeline (last few agent entries)
  const activeAgents = useMemo(() => {
    return timeline
      .filter((e) => e.type === 'agent' && e.agentRole)
      .slice(-3)
      .map((e) => ({
        role: e.agentRole!,
        content: e.content,
      }));
  }, [timeline]);

  return (
    <div className="task-monitor">
      {/* Progress Bar */}
      <div className="task-progress">
        <div className="task-progress-bar">
          <div className="task-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="task-progress-text">{Math.round(progress)}%</div>
      </div>

      {/* Stage List */}
      <div className="task-stages">
        {UI_STAGES.map((stage, index) => {
          const status = getStageStatus(index);
          return (
            <div key={stage.id} className={`task-stage ${status}`}>
              <div className="task-stage-icon">{stage.icon}</div>
              <div className="task-stage-label">{stage.label}</div>
              <div className="task-stage-indicator">
                {status === 'completed' && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                )}
                {status === 'active' && <span className="pulse-dot" />}
                {status === 'blocked' && <span className="status-icon-error">!</span>}
                {status === 'warning' && <span className="status-icon-warning">?</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Blocker alerts */}
      {blockerEntries.length > 0 && (
        <div className="task-blockers">
          {blockerEntries.slice(-2).map((b) => (
            <div key={b.id} className="task-blocker-item">
              <span className="status-icon-error">!</span>
              <span>{b.content}</span>
            </div>
          ))}
        </div>
      )}

      {/* Active agents from timeline */}
      {activeAgents.length > 0 && (
        <div className="task-agents">
          <div className="task-agents-header">
            <span>Recent Agents</span>
            <span className="task-agents-count">{activeAgents.length}</span>
          </div>
          <div className="task-agents-list">
            {activeAgents.map((agent, i) => (
              <div key={`${agent.role}-${i}`} className="task-agent">
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

      {/* Summary */}
      <div className="task-summary">
        <div className="task-summary-item">
          <span className="task-summary-label">Context</span>
          <span className="task-summary-value mono" title={contextSnapshot?.contextId}>
            {contextSnapshot?.contextId ? contextSnapshot.contextId.slice(0, 8) + '…' : '--'}
          </span>
        </div>
        <div className="task-summary-item">
          <span className="task-summary-label">Blockers</span>
          <span className={`task-summary-value ${blockerCount > 0 ? 'error' : ''}`}>{blockerCount}</span>
        </div>
        <div className="task-summary-item">
          <span className="task-summary-label">Stage</span>
          <span className={`task-summary-value ${isBlocked ? 'error' : isWaitingForInput ? 'warning' : 'active'}`}>
            {currentRun ? UI_STAGES[currentIndex]?.label || 'Preflight' : 'Idle'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default TaskMonitor;
