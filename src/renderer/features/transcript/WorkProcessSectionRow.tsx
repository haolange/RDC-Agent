import React from 'react';
import { MeasuredWorkRows } from './MeasuredWorkRows';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';
import type { WorkProcessRow } from './workProcessTypes';

interface WorkProcessSectionRowProps {
  row: Extract<WorkProcessRow, { type: 'section' }>;
  renderRow: (row: WorkProcessRow) => React.ReactNode;
}

/** A model response keeps one ordered list, including text that changes phase while streaming. */
export const WorkProcessSectionRow: React.FC<WorkProcessSectionRowProps> = ({ row, renderRow }) => {
  return (
    <li className={`work-process-step work-process-section kind-section status-${row.status}`}
      data-testid="work-process-section">
      <WorkProcessRailIcon row={row} />
      <div className="work-process-step-content">
        <MeasuredWorkRows className="work-process-steps work-process-section-list" rows={row.visibleSteps} renderRow={renderRow} />
      </div>
    </li>
  );
};
