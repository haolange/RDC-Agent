import React from 'react';
import { useI18n } from '../../i18n';
import { Disclosure } from '../../ui/Disclosure';
import { MeasuredWorkRows } from './MeasuredWorkRows';
import { useScopedWorkDisclosure } from './ScopedWorkDisclosure';
import { useWorkProcessExpansion } from './WorkProcessExpansion';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';
import { workProcessSectionModel } from './workProcessSectionModel';
import type { WorkProcessRow } from './workProcessTypes';

interface WorkProcessSectionRowProps {
  row: Extract<WorkProcessRow, { type: 'section' }>;
  renderRow: (row: WorkProcessRow) => React.ReactNode;
}

/**
 * One model loop. Its thinking and commentary lead and stay visible; its actions fold behind one
 * "N actions · time" line whose default follows the Working expansion preference, while a user's own
 * toggle wins across streaming updates and remounts. Folding Working hides thinking and commentary but
 * never the reply text in the same list.
 */
export const WorkProcessSectionRow: React.FC<WorkProcessSectionRowProps> = ({ row, renderRow }) => {
  const { t } = useI18n();
  const model = workProcessSectionModel(row, t);
  const expansion = useWorkProcessExpansion();
  const defaultOpen = model.hasError || expansion.preference === 'all' || (expansion.active && expansion.latestSectionId === row.id);
  const [open, toggle] = useScopedWorkDisclosure(`section-${row.id}`, defaultOpen);
  return (
    <li className={`work-process-step work-process-section kind-section lead-${model.lead} status-${row.status}`}
      data-testid="work-process-section" data-section-lead={model.lead}>
      <WorkProcessRailIcon row={row} />
      <div className="work-process-step-content">
        {model.leadRows.length > 0 ? (
          <ol className="work-process-steps work-process-section-lead">{model.leadRows.map(renderRow)}</ol>
        ) : null}
        {model.actionRows.length > 0 ? (
          <Disclosure
            className="work-process-section-actions"
            triggerClassName={`work-process-section-toggle${model.running ? ' is-running' : ''}`}
            open={open}
            onOpenChange={toggle}
            summary={<span className="work-process-section-label" data-work-node-heading>{model.actionsLabel}</span>}
          >
            <MeasuredWorkRows className="work-process-steps work-process-section-list" rows={model.actionRows} renderRow={renderRow} />
          </Disclosure>
        ) : null}
      </div>
    </li>
  );
};
