import React, { useEffect, useMemo, useState } from 'react';
import { AGENT_DISPLAY_NAMES } from '@shared/constants/agents';
import type { AgentRole, AgentState, AgentStatus } from '@shared/types/agent';
import type { WorkflowState } from '@shared/types/workflow';
import './WorkflowPanel.css';

interface UiStageDefinition {
  id: string;
  label: string;
  stages: WorkflowState['currentStage'][];
}

interface ActiveAgent {
  role: AgentRole;
  status: AgentStatus;
  message: string;
}

const UI_STAGES: UiStageDefinition[] = [
  { id: 'planner', label: 'Planner', stages: ['preflight', 'entry_gate', 'intake_gate', 'plan', 'speclist'] },
  { id: 'generator', label: 'Generator', stages: ['dispatch', 'investigate'] },
  { id: 'evaluator', label: 'Evaluator', stages: ['fix_verify', 'skepti', 'curate', 'finalize'] },
];

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

  const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;

  useEffect(() => {
    const loadInitialState = async () => {
      if (!electronAPI) return;
      const [nextWorkflowState, evidenceChain, allAgents] = await Promise.all([
        electronAPI.workflow.getState().catch(() => null),
        electronAPI.evidence.getChain().catch(() => ({ events: [] })),
        electronAPI.agent.getAllStates().catch(() => []),
      ]);

      setWorkflowState(nextWorkflowState as WorkflowState | null);
      setEventCount(Array.isArray((evidenceChain as { events?: unknown[] }).events) ? (evidenceChain as { events: unknown[] }).events.length : 0);
      setActiveAgents(Array.isArray(allAgents)
        ? (allAgents as AgentState[])
          .filter((agent) => agent.status !== 'idle')
          .map((agent) => ({
            role: agent.agentId,
            status: agent.status,
            message: buildAgentMessage(agent),
          }))
        : []);
    };

    void loadInitialState();
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
      const nextPayload = payload as AgentState;
      setActiveAgents((current) => {
        const filtered = current.filter((agent) => agent.role !== nextPayload.agentId);
        if (nextPayload.status === 'idle') {
          return filtered;
        }
        return [...filtered, {
          role: nextPayload.agentId,
          status: nextPayload.status,
          message: buildAgentMessage(nextPayload),
        }];
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

  const currentIndex = useMemo(() => {
    if (!workflowState) return 0;
    const index = UI_STAGES.findIndex((stage) => stage.stages.includes(workflowState.currentStage));
    return index >= 0 ? index : 0;
  }, [workflowState]);

  const blockerCount = workflowState?.blockers.length ?? 0;
  const progress = workflowState
    ? Math.min(100, ((currentIndex + (workflowState.currentStage === 'finalize' ? 1 : 0)) / UI_STAGES.length) * 100)
    : 0;

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
        </div>
      </div>

      <div className="workflow-timeline">
        {UI_STAGES.map((stage, index) => {
          const stageState = index < currentIndex ? 'completed' : index === currentIndex ? 'active' : 'pending';
          return (
            <div key={stage.id} className={`workflow-stage ${stageState}`}>
              <div className="stage-node">
                <span className="stage-name">{stage.label}</span>
              </div>
              {index < UI_STAGES.length - 1 && <div className="stage-connector" />}
            </div>
          );
        })}
      </div>

      <div className="workflow-progress">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="progress-text">
          <span>{workflowState?.currentStage || 'preflight'}</span>
          <span>{Math.round(progress)}%</span>
        </div>
      </div>

      {activeAgents.length > 0 && (
        <div className="workflow-active-agents">
          {activeAgents.slice(0, 3).map((agent) => (
            <div key={agent.role} className="agent-activity">
              <div className={`agent-activity-avatar ${agent.role.replace(/(_agent|rdc-)/g, '').replace(/_/g, '-')}`}>
                {(AGENT_DISPLAY_NAMES[agent.role] || agent.role).charAt(0)}
              </div>
              <div className="agent-activity-info">
                <span className="agent-activity-name">{AGENT_DISPLAY_NAMES[agent.role] || agent.role}</span>
                <span className="agent-activity-status">{agent.message}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WorkflowPanel;
