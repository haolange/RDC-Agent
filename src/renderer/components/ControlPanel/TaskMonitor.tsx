import React, { useMemo } from 'react';
import type { WorkflowStage } from '@shared/types/workflow';
import { AGENT_DISPLAY_NAMES } from '@shared/constants/agents';
import { useSessionStore } from '../../stores/sessionStore';

const UI_STAGES: Array<{ id: string; label: string; stages: WorkflowStage[] }> = [
  { id: 'planner', label: '规划', stages: ['preflight', 'entry_gate', 'intake_gate', 'plan', 'speclist'] },
  { id: 'generator', label: '执行', stages: ['dispatch', 'investigate'] },
  { id: 'evaluator', label: '验证', stages: ['fix_verify', 'skepti', 'curate', 'finalize'] },
];

const STAGE_LABELS: Partial<Record<WorkflowStage, string>> = {
  preflight: '预检',
  entry_gate: '入口校验',
  intake_gate: '任务 intake',
  plan: '计划审批',
  speclist: '任务拆分',
  dispatch: '分派 specialists',
  investigate: '证据调查',
  fix_verify: '修复验证',
  skepti: '质疑复核',
  curate: '整理交付',
  finalize: '完成',
  blocked: '阻塞',
  awaiting_user_input: '等待用户输入',
};

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
  const currentStageLabel = currentRun ? (STAGE_LABELS[currentStage] ?? currentStage) : '待命';

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
            <span>最近推理</span>
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
                  <span className="task-agent-status">{summary.summary.slice(0, 56)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="task-summary">
        <div className="task-summary-item">
          <span className="task-summary-label">阻塞项</span>
          <span className={`task-summary-value ${blockerCount > 0 ? 'error' : ''}`}>{blockerCount}</span>
        </div>
        <div className="task-summary-item">
          <span className="task-summary-label">当前阶段</span>
          <span className="task-summary-value active">{currentStageLabel}</span>
        </div>
      </div>
    </div>
  );
};

export default TaskMonitor;
