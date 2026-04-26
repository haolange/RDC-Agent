import React from 'react';
import type { HarnessTask } from '@shared/types/harness';
import type { ReasoningSummary, WorkflowStage, WorkflowState } from '@shared/types/workflow';
import type { RunSummary } from '@shared/types/session';
import { AGENT_DISPLAY_NAMES } from '@shared/constants/agents';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n';
import { useSessionStore } from '../../stores/sessionStore';

const ACTIVE_RUN_STATUSES: RunSummary['status'][] = [
  'planning',
  'awaiting_input',
  'awaiting_approval',
  'queued',
  'running',
  'stopping',
];

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

export interface SessionProgressSnapshot {
  isActive: boolean;
  isIdle: boolean;
  progress: number;
  blockerCount: number;
  currentStageLabel: string;
  statusLabel: string;
  recentReasoning: ReasoningSummary[];
  stages: Array<{
    id: string;
    label: string;
    status: 'completed' | 'active' | 'pending';
  }>;
}

type TaskMonitorStatus = 'completed' | 'active' | 'pending' | 'blocked' | 'cancelled';

interface TaskMonitorItem {
  id: string;
  title: string;
  detail?: string;
  meta?: string;
  status: TaskMonitorStatus;
}

const mapTaskStatus = (task: HarnessTask): TaskMonitorStatus => {
  if (task.status === 'completed') return 'completed';
  if (task.status === 'in_progress') return 'active';
  if (task.status === 'blocked' || task.status === 'rejected') return 'blocked';
  if (task.status === 'cancelled') return 'cancelled';
  return 'pending';
};

const buildTaskMonitorItems = (
  currentRun: RunSummary | null,
  workflowState: WorkflowState | null,
  reasoningSummaries: ReasoningSummary[],
): TaskMonitorItem[] => {
  const debugPlan = workflowState?.debugPlan ?? null;
  const harnessTasks = workflowState?.harnessTasks ?? [];
  const items: TaskMonitorItem[] = harnessTasks.map((task) => ({
    id: task.taskId,
    title: task.title,
    detail: task.acceptanceCriteria[0] ?? task.objective,
    meta: `${task.evidenceRefs.length} evidence · ${task.userApproval}`,
    status: mapTaskStatus(task),
  }));

  if (items.length === 0 && debugPlan?.expectedDeliverables.length) {
    debugPlan.expectedDeliverables.forEach((deliverable, index) => {
      items.push({
        id: `deliverable-${index}`,
        title: deliverable,
        detail: index === 0 ? debugPlan.scope : undefined,
        meta: debugPlan.recommendedSpecialists.length > 0
          ? debugPlan.recommendedSpecialists.join(' · ')
          : undefined,
        status: currentRun?.status === 'completed'
          ? 'completed'
          : currentRun && ACTIVE_RUN_STATUSES.includes(currentRun.status) && index === 0
            ? 'active'
            : 'pending',
      });
    });
  }

  if (items.length === 0 && currentRun) {
    items.push({
      id: `run-${currentRun.runId}`,
      title: STAGE_LABELS[(currentRun.lastStage as WorkflowStage) || 'preflight'] ?? currentRun.lastStage,
      detail: currentRun.goal,
      meta: currentRun.status,
      status: currentRun.status === 'completed'
        ? 'completed'
        : currentRun.status === 'cancelled'
          ? 'cancelled'
          : ACTIVE_RUN_STATUSES.includes(currentRun.status)
            ? 'active'
            : 'pending',
    });
  }

  for (const blocker of workflowState?.blockers ?? []) {
    items.push({
      id: `blocker-${blocker.code}-${items.length}`,
      title: blocker.code,
      detail: blocker.reason,
      meta: blocker.refs.join(' · '),
      status: 'blocked',
    });
  }

  const latestReasoning = reasoningSummaries[reasoningSummaries.length - 1];
  if (latestReasoning && items.length > 0) {
    items.push({
      id: `reasoning-${latestReasoning.summaryId}`,
      title: AGENT_DISPLAY_NAMES[latestReasoning.agentId] || latestReasoning.agentId,
      detail: latestReasoning.summary,
      meta: STAGE_LABELS[latestReasoning.stage] ?? latestReasoning.stage,
      status: currentRun && ACTIVE_RUN_STATUSES.includes(currentRun.status) ? 'active' : 'completed',
    });
  }

  return items.slice(0, 12);
};

export const getSessionProgressSnapshot = (
  currentRun: RunSummary | null,
  workflowState: WorkflowState | null,
  reasoningSummaries: ReasoningSummary[],
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): SessionProgressSnapshot => {
  const currentStage = (currentRun?.lastStage as WorkflowStage | undefined) || workflowState?.currentStage || 'preflight';
  const currentIndex = UI_STAGES.findIndex((stage) => stage.stages.includes(currentStage));
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const isActive = Boolean(currentRun && ACTIVE_RUN_STATUSES.includes(currentRun.status));
  const blockerCount = workflowState?.blockers.length ?? 0;
  const baseProgress = Math.min(
    100,
    Math.round(((safeIndex + (currentStage === 'finalize' ? 1 : 0)) / UI_STAGES.length) * 100),
  );
  const isIdle = !currentRun && reasoningSummaries.length === 0 && blockerCount === 0;

  let progress = 0;
  let statusLabel = t('control.sessionProgressReady');
  if (currentRun) {
    if (currentRun.status === 'completed') {
      progress = 100;
      statusLabel = t('control.sessionProgressCompleted');
    } else if (isActive) {
      progress = Math.max(baseProgress, 12);
      statusLabel = STAGE_LABELS[currentStage] ?? currentStage;
    } else {
      progress = Math.max(baseProgress, 12);
      statusLabel = t('control.sessionProgressPaused');
    }
  }

  return {
    isActive,
    isIdle,
    progress,
    blockerCount,
    currentStageLabel: STAGE_LABELS[currentStage] ?? currentStage,
    statusLabel,
    recentReasoning: reasoningSummaries.slice(-3).reverse(),
    stages: UI_STAGES.map((stage, index) => ({
      id: stage.id,
      label: stage.label,
      status: index < safeIndex ? 'completed' : index === safeIndex ? 'active' : 'pending',
    })),
  };
};

export const SessionProgressPanel: React.FC = () => {
  const { t } = useI18n();
  const currentRun = useSessionStore((state) => state.currentRun);
  const workflowState = useSessionStore((state) => state.workflowState);
  const reasoningSummaries = useSessionStore((state) => state.reasoningSummaries);
  const snapshot = getSessionProgressSnapshot(currentRun, workflowState, reasoningSummaries, t);
  const taskItems = buildTaskMonitorItems(currentRun, workflowState, reasoningSummaries);

  return (
    <div className="session-progress-panel" data-testid="session-progress-panel">
      {snapshot.isIdle ? (
        <div className="session-progress-idle-state">
          <div className="session-progress-idle-steps" aria-hidden="true">
            <span className="session-progress-idle-step completed" />
            <span className="session-progress-idle-link" />
            <span className="session-progress-idle-step completed" />
            <span className="session-progress-idle-link" />
            <span className="session-progress-idle-step" />
          </div>
          <div className="session-progress-idle-copy">{t('control.sessionProgressIdleCompact')}</div>
        </div>
      ) : (
        <div className="session-task-monitor" data-testid="session-task-monitor">
          <div className="session-task-monitor-summary">
            <span className={`session-task-monitor-dot ${snapshot.blockerCount > 0 ? 'blocked' : snapshot.isActive ? 'active' : ''}`} />
            <span className="session-task-monitor-title">{snapshot.statusLabel}</span>
            <span className="session-task-monitor-meta">{snapshot.progress}%</span>
          </div>
          <div className="session-task-monitor-list">
            {taskItems.map((item) => (
              <div key={item.id} className={`session-task-monitor-item ${item.status}`}>
                <span className="session-task-monitor-marker" aria-hidden="true" />
                <span className="session-task-monitor-copy">
                  <span className="session-task-monitor-item-title">{item.title}</span>
                  {item.detail ? <span className="session-task-monitor-item-detail">{item.detail}</span> : null}
                  {item.meta ? <span className="session-task-monitor-item-meta">{item.meta}</span> : null}
                </span>
              </div>
            ))}
          </div>
          {taskItems.length === 0 ? (
            <div className="session-progress-empty">{t('control.sessionProgressNoUpdates')}</div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default SessionProgressPanel;
