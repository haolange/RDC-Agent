import React from 'react';
import type { ProgressTask } from '@shared/types/trace';
import { TASK_STATUS_REASONS } from '@shared/constants/taskStatusReasons';
import { Button } from '../../ui/Button';
import { TaskStatusMarker } from '../../ui/TaskStatusMarker';
import { useI18n } from '../../i18n';
import { useSessionWorkStop } from './useSessionWorkStop';
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

export const RightRailProgressList: React.FC<{ tasks: ProgressTask[]; locateLabel: string; stopLabel: string }> = React.memo(({ tasks, locateLabel, stopLabel }) => {
  const { t } = useI18n();
  const sessionId = tasks.find((task) => task.status === 'in_progress')?.sessionId;
  const { stopping, error, stop } = useSessionWorkStop(sessionId);
  const displayReason = (reason: string): string => {
    if (reason === TASK_STATUS_REASONS.parentTurnStopped) return t('control.rightRail.progress.reason.parentTurnStopped');
    if (reason === TASK_STATUS_REASONS.createdTurnStopped) return t('control.rightRail.progress.reason.createdTurnStopped');
    return reason;
  };
  return <>
    {sessionId ? <Button size="sm" variant="danger" disabled={stopping} onClick={() => void stop()}>{stopLabel}</Button> : null}
    {error ? <small role="status" className="right-rail-task-stop-error">{error}</small> : null}
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
