import React from 'react';
import { useI18n } from '../../i18n';
import { MeasuredWorkRows } from './MeasuredWorkRows';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';
import { isTrackActivity } from './workProcessTrack';
import type { WorkProcessRow } from './workProcessTypes';

interface WorkProcessSectionRowProps {
  row: Extract<WorkProcessRow, { type: 'section' }>;
  renderRow: (row: WorkProcessRow) => React.ReactNode;
}

/**
 * One model loop's steps. A loop that acted gets a heading that names the group and carries its rail
 * node, so tool-only groups read as one unit instead of hanging the node on their first card.
 */
export const WorkProcessSectionRow: React.FC<WorkProcessSectionRowProps> = ({
  row,
  renderRow,
}) => {
  const { t } = useI18n();
  const hasError = row.status === 'error' || row.steps.some((step) => step.status === 'error');
  const visibleSteps = row.visibleSteps;
  const running = isTrackActivity(row);
  const actions = t(row.stepCount === 1 ? 'chat.workProcessActionOne' : 'chat.workProcessActions', { count: row.stepCount });
  const heading = running
    ? t('chat.workProcessSectionRunning', { actions })
    : row.duration ? t('chat.workProcessSectionDone', { actions, duration: row.duration }) : actions;
  return (
    <li className={`work-process-step work-process-section kind-section status-${row.status}`} data-testid="work-process-section">
      <WorkProcessRailIcon row={row} />
      <div className="work-process-step-content">
        {row.stepCount > 0 ? (
          <p className={`work-process-section-heading${running ? ' is-running' : ''}`} data-work-node-heading>{heading}</p>
        ) : null}
        {visibleSteps.length > 0 ? (
          <MeasuredWorkRows className={`work-process-steps work-process-section-list ${hasError || row.defaultOpen ? 'is-open' : ''}`}
            rows={visibleSteps} renderRow={renderRow} />
        ) : null}
      </div>
    </li>
  );
};
