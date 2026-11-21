import React from 'react';
import { MeasuredWorkRows } from './MeasuredWorkRows';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';
import { workProcessSectionModel } from './workProcessSectionModel';
import type { WorkProcessRow } from './workProcessTypes';

interface WorkProcessSectionRowProps {
  row: Extract<WorkProcessRow, { type: 'section' }>;
  renderRow: (row: WorkProcessRow) => React.ReactNode;
}

/**
 * One model loop, laid out flat: its thinking and commentary lead, then its tool cards, delegations and task
 * snapshots follow in the order they happened. Nothing in a step folds; each card keeps its own disclosure.
 * Folding Working hides thinking and commentary but never the reply text in the same list.
 */
export const WorkProcessSectionRow: React.FC<WorkProcessSectionRowProps> = ({ row, renderRow }) => {
  const model = workProcessSectionModel(row);
  return (
    <li className={`work-process-step work-process-section kind-section lead-${model.lead} status-${row.status}`}
      data-testid="work-process-section" data-section-lead={model.lead}>
      <WorkProcessRailIcon row={row} />
      <div className="work-process-step-content">
        {model.leadRows.length > 0 ? (
          <ol className="work-process-steps work-process-section-lead">{model.leadRows.map(renderRow)}</ol>
        ) : null}
        {model.actionRows.length > 0 ? (
          <MeasuredWorkRows className="work-process-steps work-process-section-list" rows={model.actionRows} renderRow={renderRow} />
        ) : null}
      </div>
    </li>
  );
};
