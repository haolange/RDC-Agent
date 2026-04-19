import React from 'react';
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
        <>
          <div className="session-progress-hero">
            <div className="session-progress-hero-copy">
              <span className="session-progress-kicker">{t('control.sessionProgressStatus')}</span>
              <strong className="session-progress-headline">{snapshot.statusLabel}</strong>
              <span className="session-progress-description">
                {snapshot.isActive ? t('control.sessionProgressActiveHint') : t('control.sessionProgressIdleHint')}
              </span>
            </div>
            <div className="session-progress-meter" aria-label={`${snapshot.progress}%`}>
              <span>{snapshot.progress}%</span>
            </div>
          </div>

          <div className="session-progress-stage-strip">
            {snapshot.stages.map((stage) => (
              <div key={stage.id} className={`session-progress-stage ${stage.status}`}>
                <span className="session-progress-stage-dot" />
                <span className="session-progress-stage-label">{stage.label}</span>
              </div>
            ))}
          </div>

          <div className="session-progress-facts">
            <div className="session-progress-fact">
              <span className="session-progress-fact-label">{t('control.sessionProgressCurrentStage')}</span>
              <span className="session-progress-fact-value">{snapshot.currentStageLabel}</span>
            </div>
            <div className="session-progress-fact">
              <span className="session-progress-fact-label">{t('control.sessionProgressBlockers')}</span>
              <span className={`session-progress-fact-value ${snapshot.blockerCount > 0 ? 'warning' : ''}`}>
                {snapshot.blockerCount}
              </span>
            </div>
          </div>

          {snapshot.recentReasoning.length > 0 ? (
            <div className="session-progress-updates">
              <div className="session-progress-updates-title">{t('control.sessionProgressRecentUpdates')}</div>
              <div className="session-progress-update-list">
                {snapshot.recentReasoning.map((summary) => (
                  <div key={summary.summaryId} className="session-progress-update">
                    <span className="session-progress-update-agent">
                      {AGENT_DISPLAY_NAMES[summary.agentId] || summary.agentId}
                    </span>
                    <span className="session-progress-update-copy">{summary.summary}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="session-progress-empty">{t('control.sessionProgressNoUpdates')}</div>
          )}
        </>
      )}
    </div>
  );
};

export default SessionProgressPanel;
