import React from 'react';
import type { ProgressTask } from '@shared/types/trace';
import { TASK_STATUS_REASONS } from '@shared/constants/taskStatusReasons';
import { TaskStatusMarker } from '../../ui/TaskStatusMarker';
import { useI18n } from '../../i18n';
import { WORK_PROCESS_LOCATE_TASK_EVENT, type WorkProcessTaskLocationRequest } from '../../lib/workProcessTaskLocation';

const focusWorkProcessTask = (taskId: string): void => {
  const candidates: WorkProcessTaskLocationRequest['candidates'] = [];
  document.dispatchEvent(new CustomEvent<WorkProcessTaskLocationRequest>(WORK_PROCESS_LOCATE_TASK_EVENT, {
    detail: { taskId, candidates },
  }));
  const latest = candidates.sort((left, right) =>
    left.element.compareDocumentPosition(right.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1).at(-1);
  latest?.reveal();
};

export const RightRailProgressList: React.FC<{ tasks: ProgressTask[]; locateLabel: string }> = React.memo(({ tasks, locateLabel }) => {
  const { t } = useI18n();
  const displayReason = (reason: string): string => {
    if (reason === TASK_STATUS_REASONS.parentTurnStopped) return t('control.rightRail.progress.reason.parentTurnStopped');
    if (reason === TASK_STATUS_REASONS.createdTurnStopped) return t('control.rightRail.progress.reason.createdTurnStopped');
    return reason;
  };
  return <>
    <ol className="right-rail-progress">{tasks.map((task) => (
      <li key={task.id} className={`right-rail-task-row status-${task.status}`}>
        <button type="button" onClick={() => focusWorkProcessTask(task.id)} title={locateLabel}>
          <TaskStatusMarker status={task.status} order={task.order} />
          <span className="right-rail-task-copy"><strong>{task.title}</strong>{task.blockerSummary ? <small>{displayReason(task.blockerSummary)}</small> : null}</span>
        </button>
      </li>
    ))}</ol>
  </>;
});
