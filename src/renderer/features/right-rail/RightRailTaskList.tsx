import React, { useState } from 'react';
import { useI18n } from '../../i18n';
import { useDynStyle } from '../../lib/useDynStyle';
import { WORK_PROCESS_LOCATE_TASK_EVENT, type WorkProcessTaskLocationRequest } from '../../lib/workProcessTaskLocation';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { Badge } from '../../ui/Badge';
import { Chevron } from '../../ui/Chevron';
import { TaskStatusMarker } from '../../ui/TaskStatusMarker';
import type { TaskRailItem } from '@shared/types/trace';
import './RightRailTasks.css';

/** Long lists fold their finished work into one row; short lists stay whole. */
const FOLD_COMPLETED_AFTER = 6;

const focusWorkProcessTask = (taskId: string): void => {
  const candidates: WorkProcessTaskLocationRequest['candidates'] = [];
  document.dispatchEvent(new CustomEvent<WorkProcessTaskLocationRequest>(WORK_PROCESS_LOCATE_TASK_EVENT, {
    detail: { taskId, candidates },
  }));
  const latest = candidates.sort((left, right) =>
    left.element.compareDocumentPosition(right.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1).at(-1);
  latest?.reveal();
};

const TaskProgress: React.FC<{ done: number; total: number }> = ({ done, total }) => {
  const { t } = useI18n();
  const fill = useDynStyle({ '--right-rail-task-progress': `${total ? (done / total) * 100 : 0}%` });
  return (
    <div className="right-rail-task-progress">
      <span className="right-rail-task-progress-label">{t('control.rightRail.tasks.count', { done, total })}</span>
      <span className="right-rail-task-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}
        aria-label={t('control.rightRail.tasks.count', { done, total })}>
        <span className="right-rail-task-progress-fill" {...fill} />
      </span>
    </div>
  );
};

/** Who ran the current execution and how, when that differs from the turn's own direct work. */
function useExecutionFacts(task: TaskRailItem): string[] {
  const { t } = useI18n();
  const agentName = useAppSettingsStore((state) => state.settings.agents.definitions.find((agent) => agent.id === task.execution?.agentId)?.name);
  const execution = task.execution;
  if (!execution) return [];
  const delegated = execution.mode !== 'direct';
  return [
    ...(execution.dispatch === 'background' ? [t('control.rightRail.tasks.background')] : []),
    ...(delegated && execution.agentId ? [agentName ?? execution.agentId] : []),
    ...(delegated && execution.model ? [execution.model.modelId] : []),
  ];
}

const TaskRow: React.FC<{ task: TaskRailItem; locateLabel: string }> = ({ task, locateLabel }) => {
  const { t } = useI18n();
  const facts = useExecutionFacts(task);
  const waiting = task.status === 'pending' && Boolean(task.waitingOn?.length);
  const stateLabel = waiting ? t('chat.taskWaitingDependencies') : t(`chat.workProcessTaskStatus.${task.displayState}`);
  return (
    <li className={`right-rail-task-row status-${task.displayState}`}>
      <button type="button" onClick={() => focusWorkProcessTask(task.id)} title={`${task.title} — ${stateLabel} — ${locateLabel}`}>
        <span className="right-rail-task-order">{task.order + 1}</span>
        <TaskStatusMarker size="sm" status={task.displayState} label={stateLabel} />
        <span className="right-rail-task-copy">
          <span className="right-rail-task-title">{task.title}</span>
          {facts.length ? (
            <span className="right-rail-task-facts">
              {facts.map((fact) => <Badge key={fact} variant="outline">{fact}</Badge>)}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
};

export const RightRailTaskList: React.FC<{ tasks: TaskRailItem[]; locateLabel: string }> = React.memo(({ tasks, locateLabel }) => {
  const { t } = useI18n();
  const [showCompleted, setShowCompleted] = useState(false);
  const done = tasks.filter((task) => task.status === 'completed').length;
  const foldable = tasks.length > FOLD_COMPLETED_AFTER && done >= 2;
  const visible = foldable && !showCompleted ? tasks.filter((task) => task.status !== 'completed') : tasks;
  return <>
    <TaskProgress done={done} total={tasks.length} />
    {foldable ? (
      <button type="button" className="right-rail-task-fold" aria-expanded={showCompleted} onClick={() => setShowCompleted(!showCompleted)}>
        <Chevron direction="down" open={showCompleted} size={12} />
        <span>{t(showCompleted ? 'control.rightRail.tasks.hideCompleted' : 'control.rightRail.tasks.showCompleted', { count: done })}</span>
      </button>
    ) : null}
    <ol className="right-rail-tasks">
      {visible.map((task) => <TaskRow key={task.id} task={task} locateLabel={locateLabel} />)}
    </ol>
  </>;
});
