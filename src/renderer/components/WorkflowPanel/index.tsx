import React, { useEffect, useMemo, useState } from 'react';
import { AGENT_DISPLAY_NAMES } from '@shared/constants/agents';
import type { AgentRole, AgentState, AgentStatus } from '@shared/types/agent';
import type { WorkflowStage, WorkflowState } from '@shared/types/workflow';
import './WorkflowPanel.css';

interface UiStageDefinition {
  id: string;
  label: string;
  description: string;
  stages: WorkflowStage[];
  icon: React.ReactNode;
}

interface ActiveAgent {
  role: AgentRole;
  status: AgentStatus;
  message: string;
}

const UI_STAGES: UiStageDefinition[] = [
  {
    id: 'preflight',
    label: 'Preflight',
    description: 'Environment checks and initial intent validation before intake begins.',
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
    description: 'Capture acceptance, case creation, and intake gate validation.',
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
    description: 'Specialist goals are prepared and dispatched into the workspace.',
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
    description: 'Briefs are collected and handed off to the right investigator agents.',
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
    description: 'Experts gather evidence, run tools, and assemble the technical narrative.',
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
    description: 'Fix verification and skeptical review confirm the evidence chain.',
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
    description: 'Final report packaging, curation, and workflow completion.',
    stages: ['curator_ready', 'finalized'],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 4h10l-1 5h7l-3 6h-6l-1 5H4V4z" />
      </svg>
    ),
  },
];

const resolveUiStageIndex = (workflowState: WorkflowState | null): number => {
  if (!workflowState) return 0;

  const stageToResolve =
    workflowState.currentStage === 'validation_blocked' || workflowState.currentStage === 'awaiting_user_input'
      ? [...workflowState.previousStages].reverse().find(
          (stage) => stage !== 'validation_blocked' && stage !== 'awaiting_user_input'
        ) || 'preflight_pending'
      : workflowState.currentStage;

  const stageIndex = UI_STAGES.findIndex((stage) => stage.stages.includes(stageToResolve));
  return stageIndex >= 0 ? stageIndex : 0;
};

const buildAgentMessage = (agent: AgentState): string => {
  switch (agent.status) {
    case 'thinking':
      return 'Thinking through the next step';
    case 'executing':
      return 'Executing tools and collecting evidence';
    case 'waiting':
      return 'Waiting on workflow or user input';
    case 'complete':
      return 'Completed current assignment';
    case 'error':
      return agent.error || 'Agent reported an error';
    default:
      return 'Standing by';
  }
};

export const WorkflowPanel: React.FC = () => {
  const [workflowState, setWorkflowState] = useState<WorkflowState | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [activeAgents, setActiveAgents] = useState<ActiveAgent[]>([]);

  const electronAPI =
    typeof window !== 'undefined'
      ? (window as Window & { electronAPI?: Window['electronAPI'] }).electronAPI
      : undefined;

  useEffect(() => {
    const loadInitialState = async () => {
      if (!electronAPI) return;

      try {
        const [nextWorkflowState, evidenceChain, allAgents] = await Promise.all([
          electronAPI.workflow.getState().catch(() => null),
          electronAPI.evidence.getChain().catch(() => ({ events: [] })),
          electronAPI.agent.getAllStates().catch(() => []),
        ]);

        if (nextWorkflowState) {
          setWorkflowState(nextWorkflowState);
        }

        setEventCount(evidenceChain.events.length);

        const activeAgentStates = allAgents
          .filter((agent) => agent.status !== 'idle')
          .map((agent) => ({
            role: agent.agentId,
            status: agent.status,
            message: buildAgentMessage(agent),
          }));

        setActiveAgents(activeAgentStates);
      } catch (error) {
        console.warn('Failed to load workflow panel state:', error);
      }
    };

    loadInitialState();
  }, [electronAPI]);

  useEffect(() => {
    if (!electronAPI) return;

    const handleWorkflowStateChanged = (state: unknown) => {
      setWorkflowState(state as WorkflowState);
    };

    const handleEvidenceEventAdded = () => {
      setEventCount((current) => current + 1);
    };

    const handleAgentStatusChanged = (payload: unknown) => {
      const nextPayload = payload as { agentId: AgentRole; status: AgentStatus; message?: string };
      setActiveAgents((current) => {
        const nextAgents = [...current];
        const index = nextAgents.findIndex((agent) => agent.role === nextPayload.agentId);

        if (nextPayload.status === 'idle') {
          if (index >= 0) nextAgents.splice(index, 1);
          return nextAgents;
        }

        const nextAgent: ActiveAgent = {
          role: nextPayload.agentId,
          status: nextPayload.status,
          message: nextPayload.message || buildAgentMessage({
            agentId: nextPayload.agentId,
            status: nextPayload.status,
            lastActivity: '',
          }),
        };

        if (index >= 0) {
          nextAgents[index] = nextAgent;
        } else {
          nextAgents.push(nextAgent);
        }

        return nextAgents;
      });
    };

    electronAPI.on('workflow:stateChanged', handleWorkflowStateChanged);
    electronAPI.on('evidence:eventAdded', handleEvidenceEventAdded);
    electronAPI.on('agent:statusChanged', handleAgentStatusChanged);

    return () => {
      electronAPI.off('workflow:stateChanged', handleWorkflowStateChanged);
      electronAPI.off('evidence:eventAdded', handleEvidenceEventAdded);
      electronAPI.off('agent:statusChanged', handleAgentStatusChanged);
    };
  }, [electronAPI]);

  const currentIndex = useMemo(() => resolveUiStageIndex(workflowState), [workflowState]);

  const isBlocked = workflowState?.currentStage === 'validation_blocked';
  const isWaitingForInput = workflowState?.currentStage === 'awaiting_user_input';
  const blockerCount = workflowState?.blockers.length || 0;
  const progress = useMemo(() => {
    if (!workflowState) return 0;
    return Math.min(100, ((currentIndex + (workflowState.currentStage === 'finalized' ? 1 : 0)) / UI_STAGES.length) * 100);
  }, [currentIndex, workflowState]);

  return (
    <div className="workflow-panel">
      <div className="workflow-panel-topline">
        <div>
          <div className="workflow-kicker">Workflow Timeline</div>
          <div className="workflow-heading">Debugger Coordination Flow</div>
        </div>
        <div className="workflow-summary">
          <span className="badge badge-default">{eventCount} events</span>
          {blockerCount > 0 && <span className="badge badge-error">{blockerCount} blockers</span>}
          {isWaitingForInput && <span className="badge badge-warning">Awaiting input</span>}
        </div>
      </div>

      <div className="workflow-timeline">
        {UI_STAGES.map((stage, index) => {
          let stageState: 'pending' | 'active' | 'completed' | 'blocked' | 'warning' = 'pending';

          if (index < currentIndex) {
            stageState = 'completed';
          } else if (index === currentIndex) {
            if (isBlocked) {
              stageState = 'blocked';
            } else if (isWaitingForInput) {
              stageState = 'warning';
            } else {
              stageState = 'active';
            }
          }

          return (
            <div key={stage.id} className={`workflow-stage ${stageState}`}>
              <div className="stage-node">
                <span className="stage-node-icon">{stage.icon}</span>
              </div>
              {index < UI_STAGES.length - 1 && <div className="stage-connector" />}

              <div className="stage-label">
                <span className="stage-name">{stage.label}</span>
                {index === currentIndex && workflowState && (
                  <span className="stage-status">
                    {isBlocked ? 'Blocked' : isWaitingForInput ? 'Waiting for input' : 'Active'}
                  </span>
                )}
              </div>

              <div className="stage-detail">
                <div className="stage-detail-title">{stage.label}</div>
                <div className="stage-detail-description">{stage.description}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="workflow-progress">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="progress-text">
          <span>{workflowState ? UI_STAGES[currentIndex]?.label || 'Preflight' : 'Preflight'}</span>
          <span>{Math.round(progress)}%</span>
        </div>
      </div>

      <div className="workflow-info-bar">
        <div className="info-item">
          <span className="info-item-label">Current Stage:</span>
          <span className={`info-item-value ${isBlocked ? 'error' : isWaitingForInput ? 'warning' : 'highlight'}`}>
            {workflowState ? UI_STAGES[currentIndex]?.label || 'Preflight' : 'Preflight'}
          </span>
        </div>

        <div className="info-item">
          <span className="info-item-label">Events:</span>
          <span className="info-item-value success">{eventCount}</span>
        </div>

        <div className="info-item">
          <span className="info-item-label">Blockers:</span>
          <span className={`info-item-value ${blockerCount > 0 ? 'error' : 'highlight'}`}>{blockerCount}</span>
        </div>

        {activeAgents.length > 0 && (
          <div className="workflow-active-agents">
            {activeAgents.slice(0, 2).map((agent) => (
              <div key={agent.role} className="agent-activity">
                <div className={`agent-activity-avatar ${agent.role.replace(/(_agent|rdc-)/g, '').replace(/_/g, '-')}`}>
                  {AGENT_DISPLAY_NAMES[agent.role].charAt(0)}
                </div>
                <div className="agent-activity-info">
                  <span className="agent-activity-name">{AGENT_DISPLAY_NAMES[agent.role]}</span>
                  <span className="agent-activity-status">{agent.message}</span>
                </div>
                {(agent.status === 'thinking' || agent.status === 'executing') && (
                  <div className="agent-activity-indicator">
                    <span />
                    <span />
                    <span />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkflowPanel;
