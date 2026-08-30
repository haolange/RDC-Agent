import React, { useState } from 'react';
import { useI18n } from '../../../i18n';
import { TaskStatusMarker } from '../../../ui/TaskStatusMarker';
import type { WorkProcessRow } from './workProcessPresentation';
import { WorkProcessIcon } from './WorkProcessIcons';

export const TaskSnapshotCard: React.FC<{ row: Extract<WorkProcessRow, { type: 'taskSnapshot' }> }> = ({ row }) => {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);
  return (
    <li className={`work-process-step is-appear status-${row.status} kind-task-snapshot`} data-testid="work-process-task-snapshot">
      <div className="work-process-step-content">
        <div className={`work-process-task-snapshot${expanded ? ' is-expanded' : ''}`}>
          <button
            type="button"
            className="work-process-tool-card-header"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
          >
            <span className="work-process-tool-card-title">
              <WorkProcessIcon icon="taskList" className="work-process-tool-card-icon" />
              <span className="work-process-tool-card-verb">
                {t('chat.workProcessTaskSnapshotCount', { completed: row.completed, total: row.total })}
              </span>
            </span>
            <span className="work-process-tool-card-meta">
              {row.duration ? <span>{row.duration}</span> : null}
              <span className={`work-process-row-caret${expanded ? ' is-open' : ''}`} aria-hidden="true" />
            </span>
          </button>
          {expanded ? (
            <ul className="work-process-task-snapshot-list">
              {row.items.map((item) => (
                <li
                  key={item.taskId}
                  className={`work-process-task-snapshot-item task-${item.status}`}
                  data-work-process-task-id={item.taskId}
                  data-work-process-task-status={item.status}
                >
                  <TaskStatusMarker status={item.status} order={item.order} />
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
