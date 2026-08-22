import React, { useState } from 'react';
import { useI18n } from '../../../i18n';
import type { WorkProcessRow } from './workProcessPresentation';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';

export const TaskSnapshotCard: React.FC<{ row: Extract<WorkProcessRow, { type: 'taskSnapshot' }> }> = ({ row }) => {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);
  return (
    <li className={`work-process-step is-appear status-${row.status} kind-task-snapshot`} data-testid="work-process-task-snapshot">
      <WorkProcessRailIcon variant="step" status={row.status} />
      <div className="work-process-step-content">
        <div className={`work-process-task-snapshot${expanded ? ' is-expanded' : ''}`}>
          <button
            type="button"
            className="work-process-tool-card-header"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
          >
            <span className="work-process-tool-card-verb">
              {t('chat.workProcessTaskSnapshotCount', { completed: row.completed, total: row.total })}
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
                  <span className="work-process-task-snapshot-mark" aria-hidden="true" />
                  <span className="work-process-task-snapshot-title">{item.title}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </li>
  );
};
