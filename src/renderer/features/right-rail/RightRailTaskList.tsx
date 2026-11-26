import React, { useState } from 'react';
import { useI18n } from '../../i18n';
import { WORK_PROCESS_LOCATE_TASK_EVENT, type WorkProcessTaskLocationRequest } from '../../lib/workProcessTaskLocation';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useModelDisplayLabel } from '../../hooks/useModelDisplayLabel';
import { Chevron } from '../../ui/Chevron';
import { ProgressBar } from '../../ui/ProgressBar';
import { TaskStatusMarker } from '../../ui/TaskStatusMarker';
import { PlainButton } from '../../ui/PlainButton';
import type { TaskRailItem } from '@shared/types/trace';
import './RightRailTasks.css';

/** Long lists fold their finished work into one row; short lists stay whole. */
const FOLD_COMPLETED_AFTER = 6;

const focusWorkProcessTask = (taskId: string): void => {
  const candidates: WorkProcessTaskLocationRequest['candidates'] = [];
  document.dispatchEvent(
    new CustomEvent<WorkProcessTaskLocationRequest>(WORK_PROCESS_LOCATE_TASK_EVENT, {
      detail: { taskId, candidates },
    }),
  );
  const latest = candidates
    .sort((left, right) =>
      left.element.compareDocumentPosition(right.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    )
    .at(-1);
  latest?.reveal();
};

/** The bar is the count: done / total is read on hover and by screen readers, never repeated as text beside it. */
const TaskProgress: React.FC<{ done: number; total: number }> = ({ done, total }) => {
  const { t } = useI18n();
  return (
    <div className="right-rail-task-progress">
      <ProgressBar
        value={done}
        max={total}
        tone="done"
        standalone
        label={t('control.rightRail.tasks.count', { done, total })}
      />
    </div>
  );
};

/** Who ran the current execution and how, when that differs from the turn's own direct work: the row's hover text. */
function useExecutionFacts(task: TaskRailItem): string[] {
  const { t } = useI18n();
  const execution = task.execution;
  const agentName = useAppSettingsStore(
    (state) => state.settings.agents.definitions.find((agent) => agent.id === execution?.agentId)?.name,
  );
  const modelLabel = useModelDisplayLabel(execution?.model?.providerId, execution?.model?.modelId);
  if (!execution) return [];
  const delegated = execution.mode !== 'direct';
  return [
    ...(execution.dispatch === 'background' ? [t('control.rightRail.tasks.background')] : []),
    ...(delegated && agentName ? [agentName] : []),
    ...(delegated && modelLabel ? [modelLabel] : []),
  ];
}

const TaskRow: React.FC<{ task: TaskRailItem; locateLabel: string }> = ({ task, locateLabel }) => {
  const { t } = useI18n();
  const facts = useExecutionFacts(task);
  const waiting = task.status === 'pending' && Boolean(task.waitingOn?.length);
  const stateLabel = waiting ? t('chat.taskWaitingDependencies') : t(`chat.workProcessTaskStatus.${task.displayState}`);
  return (
    <li className={`right-rail-task-row status-${task.displayState}`}>
      <PlainButton
        onClick={() => focusWorkProcessTask(task.id)}
        aria-label={`${task.title} · ${locateLabel}`}
        data-tooltip={[task.title, stateLabel, ...facts].join(' · ')}
      >
        <TaskStatusMarker size="sm" status={task.displayState} label={stateLabel} />
        <span className="right-rail-task-title">{task.title}</span>
      </PlainButton>
    </li>
  );
};

export const RightRailTaskList: React.FC<{ tasks: TaskRailItem[]; locateLabel: string }> = React.memo(
  ({ tasks, locateLabel }) => {
    const { t } = useI18n();
    const [showCompleted, setShowCompleted] = useState(false);
    const done = tasks.filter((task) => task.status === 'completed').length;
    const foldable = tasks.length > FOLD_COMPLETED_AFTER && done >= 2;
    const visible = foldable && !showCompleted ? tasks.filter((task) => task.status !== 'completed') : tasks;
    return (
      <>
        <TaskProgress done={done} total={tasks.length} />
        {foldable ? (
          <PlainButton
            className="right-rail-task-fold"
            aria-expanded={showCompleted}
            onClick={() => setShowCompleted(!showCompleted)}
          >
            <Chevron direction="down" open={showCompleted} size={12} />
            <span>
              {t(showCompleted ? 'control.rightRail.tasks.hideCompleted' : 'control.rightRail.tasks.showCompleted', {
                count: done,
              })}
            </span>
          </PlainButton>
        ) : null}
        <ol className="right-rail-tasks">
          {visible.map((task) => (
            <TaskRow key={task.id} task={task} locateLabel={locateLabel} />
          ))}
        </ol>
      </>
    );
  },
);
