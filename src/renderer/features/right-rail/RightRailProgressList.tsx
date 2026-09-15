import React from 'react';
import type { ProgressTask } from '@shared/types/trace';
import { Button } from '../../ui/Button';
import { TaskStatusMarker } from '../../ui/TaskStatusMarker';
import { useSessionWorkStop } from './useSessionWorkStop';

const focusWorkProcessTask = (taskId: string): void => {
  const escaped = window.CSS?.escape ? window.CSS.escape(taskId) : taskId;
  const target = document.querySelector<HTMLElement>(`[data-work-process-task-id="${escaped}"]`) ?? document.querySelector<HTMLElement>('[data-work-process-block-id="runtime-tasks"]');
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.focus({ preventScroll: true });
  target.classList.remove('is-trace-flash');
  void target.offsetWidth;
  target.classList.add('is-trace-flash');
  window.setTimeout(() => target.classList.remove('is-trace-flash'), 1600);
};

export const RightRailProgressList: React.FC<{ tasks: ProgressTask[]; locateLabel: string; stopLabel: string }> = React.memo(({ tasks, locateLabel, stopLabel }) => {
  const sessionId = tasks.find((task) => task.status === 'in_progress')?.sessionId;
  const { stopping, error, stop } = useSessionWorkStop(sessionId);
  return <>
    {sessionId ? <Button size="sm" variant="danger" disabled={stopping} onClick={() => void stop()}>{stopLabel}</Button> : null}
    {error ? <small role="status" className="right-rail-task-stop-error">{error}</small> : null}
    <ol className="right-rail-progress">{tasks.map((task) => (
      <li key={task.id} className={`right-rail-task-row status-${task.status}`}>
        <button type="button" onClick={() => focusWorkProcessTask(task.id)} title={locateLabel}>
          <TaskStatusMarker status={task.status} order={task.order} />
          <span className="right-rail-task-copy"><strong>{task.title}</strong>{task.blockerSummary ? <small>{task.blockerSummary}</small> : null}</span>
        </button>
      </li>
    ))}</ol>
  </>;
});
