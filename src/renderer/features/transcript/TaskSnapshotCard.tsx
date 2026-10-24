import React, { useId } from 'react';
import { WorkCardHeader } from './WorkCardHeader';
import { useI18n } from '../../i18n';
import { TaskStatusMarker } from '../../ui/TaskStatusMarker';
import { useScopedWorkDisclosure } from './ScopedWorkDisclosure';
import type { WorkProcessRow } from './workProcessTypes';
import { TASK_STATUS_REASONS } from '@shared/constants/taskStatusReasons';
import { WorkProcessIcon } from './WorkProcessIcons';

export const TaskSnapshotCard: React.FC<{
  row: Extract<WorkProcessRow, { type: 'taskSnapshot' }>;
  isLatest: boolean;
}> = ({ row, isLatest }) => {
  const { t } = useI18n();
  const [expanded, toggle] = useScopedWorkDisclosure(`task-snapshot-${row.id}`, isLatest);
  const listId = useId();
  const reasonText = (reason: string) => reason === TASK_STATUS_REASONS.parentTurnStopped
    ? t('control.rightRail.progress.reason.parentTurnStopped') : reason === TASK_STATUS_REASONS.createdTurnStopped
      ? t('control.rightRail.progress.reason.createdTurnStopped') : reason;
  const title = row.change === 'created' ? t('chat.workProcessTaskSnapshotCreated')
    : row.change === 'updated' ? t('chat.workProcessTaskSnapshotUpdated')
      : t('chat.workProcessTaskSnapshotList');
  return (
    <li className={`work-process-step is-appear status-${row.status} kind-task-snapshot`}
      data-testid="work-process-task-snapshot" data-work-process-block-id={row.id}>
      <div className="work-process-step-content">
        <div className={`work-process-task-snapshot${expanded ? ' is-expanded' : ''}`}>
          <WorkCardHeader onClick={toggle} expanded={expanded} controls={listId}
            icon={<WorkProcessIcon icon="taskList" className="work-process-tool-card-icon" />}
            title={title}
            status={<span className="work-process-task-snapshot-count">{t('chat.workProcessTaskSnapshotCount', { completed: row.completed, total: row.total })}</span>} />
          {expanded ? (
            <ul id={listId} className="work-process-task-snapshot-list">
              {row.items.map((item) => (
                <li
                  key={item.taskId}
                  className={`work-process-task-snapshot-item task-${item.status}`}
                  data-work-process-task-id={item.taskId}
                  data-work-process-task-status={item.status}
                  tabIndex={-1}
                >
                  <TaskStatusMarker status={item.status}
                    label={t(`chat.workProcessTaskStatus.${item.status}`)} />
                  {item.statusReason ? <details className="work-process-task-snapshot-copy">
                    <summary className="work-process-task-snapshot-title">{item.title}</summary>
                    <p className="work-process-task-snapshot-reason">{reasonText(item.statusReason)}</p>
                  </details> : <span className="work-process-task-snapshot-title">{item.title}</span>}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </li>
  );
};
