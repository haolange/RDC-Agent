import React, { useMemo } from 'react';
import type { HarnessTask } from '@shared/types/harness';
import type { DebugPlan, WorkflowState } from '@shared/types/workflow';
import type { RunSummary } from '@shared/types/session';
import { useSessionStore } from '../../../stores/sessionStore';

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

export const TaskBoard: React.FC = () => {
  const currentRun = useSessionStore((state) => state.currentRun);
  const workflowState = useSessionStore((state) => state.workflowState);
  const currentDebugPlan = useSessionStore((state) => state.currentDebugPlan);
  const reasoningSummaries = useSessionStore((state) => state.reasoningSummaries);
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

  if (!hasApprovedTaskBoardState(currentRun, workflowState, debugPlan)) {
    return null;
  }

  return (
    <div className="task-board" data-testid="task-board">
      <div className="task-board-overview">
        <div>
          <span className="task-board-kicker">Task Board</span>
          <strong className="task-board-title">{activeTask?.title ?? 'Task Board'}</strong>
        </div>
        <span className={`task-board-status ${blockerCount > 0 ? 'blocked' : 'active'}`}>
          {blockerCount > 0 ? `${blockerCount} blocker${blockerCount === 1 ? '' : 's'}` : currentRun?.status ?? 'active'}
        </span>
      </div>

      <div className="task-board-list">
        {boardItems.map((item) => (
          <div key={item.id} className={`task-board-item ${item.status}`}>
            <span className="task-board-item-marker" aria-hidden="true" />
            <span className="task-board-item-copy">
              <span className="task-board-item-title">{item.title}</span>
              <span className="task-board-item-detail">{item.detail}</span>
              <span className="task-board-item-meta">
                {item.evidenceCount} evidence · {item.approval}
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
