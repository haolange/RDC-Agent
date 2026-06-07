import React, { useMemo } from 'react';
import type { HarnessTask } from '@shared/types/harness';
import type { DebugPlan, WorkflowState } from '@shared/types/workflow';
import type { RunSummary } from '@shared/types/session';
import { useConversationStore } from '../../../stores/conversationStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useWorkflowStore } from '../../../stores/workflowStore';
import { TaskHistory } from './TaskHistory';

type BoardItemStatus = 'completed' | 'active' | 'pending' | 'blocked';

interface BoardItem {
  id: string;
  title: string;
  detail: string;
  status: BoardItemStatus;
  evidenceCount: number;
  approval: string;
}

export const hasApprovedTaskBoardState = (
  currentRun: RunSummary | null,
  workflowState: WorkflowState | null,
  debugPlan: DebugPlan | null,
): boolean => {
  if (!debugPlan) {
    return false;
  }

  return workflowState?.approvalState === 'approved'
    || (currentRun ? ['queued', 'running', 'stopping', 'completed'].includes(currentRun.status) : false);
};

const buildBoardItems = (
  debugPlan: DebugPlan,
  tasks: HarnessTask[],
): BoardItem[] => {
  if (tasks.length === 0) {
    return [{
      id: 'plan',
      title: 'Plan',
      detail: debugPlan.targetCapture?.fileName ?? debugPlan.scope,
      status: 'completed',
      evidenceCount: 0,
      approval: 'approved',
    }];
  }

  return tasks.map((task) => ({
    id: task.taskId,
    title: task.title,
    detail: task.acceptanceCriteria[0] ?? task.objective,
    status: task.status === 'completed'
      ? 'completed'
      : task.status === 'blocked' || task.status === 'rejected'
        ? 'blocked'
        : task.status === 'in_progress'
          ? 'active'
          : 'pending',
    evidenceCount: task.evidenceRefs.length,
    approval: task.userApproval,
  }));
};

const HISTORICAL_STATUSES = new Set<RunSummary['status']>([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

export const TaskBoard: React.FC = () => {
  const currentRun = useSessionStore((state) => state.currentRun);
  const runs = useSessionStore((state) => state.runs);
  const workflowState = useWorkflowStore((state) => state.workflowState);
  const currentDebugPlan = useWorkflowStore((state) => state.currentDebugPlan);
  const reasoningSummaries = useConversationStore((state) => state.reasoningSummaries);
  const debugPlan = currentDebugPlan ?? workflowState?.debugPlan ?? null;
  const harnessTasks = workflowState?.harnessTasks ?? [];
  const blockerCount = workflowState?.blockers.length ?? 0;
  const activeTask = harnessTasks.find((task) => task.status === 'in_progress')
    ?? harnessTasks.find((task) => task.status === 'blocked')
    ?? harnessTasks.find((task) => task.status === 'pending')
    ?? harnessTasks[harnessTasks.length - 1];

  const boardItems = useMemo(
    () => (debugPlan ? buildBoardItems(debugPlan, harnessTasks) : []),
    [debugPlan, harnessTasks],
  );

  const completedCount = useMemo(
    () => boardItems.filter((item) => item.status === 'completed').length,
    [boardItems],
  );
  const totalCount = boardItems.length;

  const historicalRuns = useMemo(
    () => runs.filter((run) => (
      run.runId !== currentRun?.runId && HISTORICAL_STATUSES.has(run.status)
    )),
    [runs, currentRun?.runId],
  );

  if (!hasApprovedTaskBoardState(currentRun, workflowState, debugPlan)) {
    return null;
  }

  const hasBlocker = blockerCount > 0;
  const hasProgress = totalCount > 0;
  const progressLabel = hasProgress ? `${completedCount}/${totalCount} completed` : '';

  return (
    <div className="task-board" data-testid="task-board">
      <div className="task-board-overview">
        <div className="task-board-overview-copy">
          <span className="task-board-kicker">Task Board</span>
          <strong className="task-board-title">{activeTask?.title ?? 'Task Board'}</strong>
          {hasProgress ? (
            <span
              className="task-board-progress"
              data-testid="task-board-progress"
              aria-label={`Progress ${progressLabel}`}
            >
              <span className="task-board-progress-track" aria-hidden="true">
                <span
                  className="task-board-progress-fill"
                  style={{ width: `${(completedCount / Math.max(totalCount, 1)) * 100}%` }}
                />
              </span>
              <span className="task-board-progress-label">{progressLabel}</span>
            </span>
          ) : null}
        </div>
        <span className={`task-board-status ${hasBlocker ? 'blocked' : 'active'}`}>
          {hasBlocker
            ? `${blockerCount} blocker${blockerCount === 1 ? '' : 's'}`
            : currentRun?.status ?? 'active'}
        </span>
      </div>

      <TaskHistory runs={historicalRuns} />

      <div className="task-board-list" data-testid="task-board-list">
        {boardItems.map((item) => (
          <div key={item.id} className={`task-board-item ${item.status}`} data-task-status={item.status}>
            <span className="task-board-item-marker" aria-hidden="true">
              {item.status === 'completed' ? (
                <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                  <path
                    d="M2.5 6.2 L5 8.6 L9.6 3.6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : null}
              {item.status === 'active' ? <span className="task-board-item-pulse" aria-hidden="true" /> : null}
            </span>
            <span className="task-board-item-copy">
              <span className="task-board-item-title">{item.title}</span>
              <span className="task-board-item-detail">{item.detail}</span>
              <span className="task-board-item-meta">
                <span className="task-board-item-meta-pill">{item.evidenceCount} evidence</span>
                <span className="task-board-item-meta-dot" aria-hidden="true">·</span>
                <span className="task-board-item-meta-approval">{item.approval}</span>
              </span>
            </span>
          </div>
        ))}
      </div>

      {reasoningSummaries.length > 0 ? (
        <div className="task-board-updates">
          <span className="task-board-updates-title">Latest update</span>
          <span className="task-board-update-copy">{reasoningSummaries[reasoningSummaries.length - 1].summary}</span>
        </div>
      ) : null}
    </div>
  );
};

export default TaskBoard;
