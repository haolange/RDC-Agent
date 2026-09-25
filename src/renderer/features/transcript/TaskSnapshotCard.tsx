import React, { useId } from 'react';
import { WorkCardHeader } from './WorkCardHeader';
import { useI18n } from '../../i18n';
import { TaskStatusMarker } from '../../ui/TaskStatusMarker';
import { useScopedWorkDisclosure } from './ScopedWorkDisclosure';
import type { WorkProcessRow } from './workProcessTypes';
import { WorkProcessIcon } from './WorkProcessIcons';

export const TaskSnapshotCard: React.FC<{
  row: Extract<WorkProcessRow, { type: 'taskSnapshot' }>;
  isLatest: boolean;
}> = ({ row, isLatest }) => {
  const { t } = useI18n();
  const [expanded, toggle] = useScopedWorkDisclosure(`task-snapshot-${row.id}`, isLatest);
  const listId = useId();
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
                  <TaskStatusMarker status={item.status} order={item.order} variant="snapshot"
                    label={t(`chat.workProcessTaskStatus.${item.status}`)} />
                  <span className="work-process-task-snapshot-copy">
                    <span className="work-process-task-snapshot-title">{item.title}</span>
                    {item.status === 'blocked' && item.statusReason ? (
                      <small className="work-process-task-snapshot-reason">{item.statusReason}</small>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </li>
  );
};
