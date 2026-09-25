import React from 'react';
import type { WorkProcessRow } from './workProcessTypes';
import { useWorkProcessLabel } from './workProcessUseLabel';
import { ToolRow } from './WorkProcessRows';
import { useScopedWorkDisclosure } from './ScopedWorkDisclosure';

type ToolAggregateRowModel = Extract<WorkProcessRow, { type: 'toolAggregate' }>;

export const ToolAggregateRow: React.FC<{ row: ToolAggregateRowModel;
  renderToolDetail?: (row: Extract<WorkProcessRow, { type: 'tool' }>) => React.ReactNode;
  density?: 'normal' | 'compact';
}> = ({ row, renderToolDetail, density }) => {
  const label = useWorkProcessLabel();
  const [expanded, toggle] = useScopedWorkDisclosure(`aggregate-${row.id}`, false);

  return (
    <li
      className={`work-process-step work-process-tool-aggregate status-${row.status}`}
      data-testid="work-process-tool-aggregate"
    >
      <div className="work-process-step-content work-process-tool-aggregate-content">
        <details className="work-process-tool-aggregate-details" open={expanded}>
          <summary className="work-process-tool-aggregate-summary" onClick={(event) => { event.preventDefault(); toggle(); }}>
            <span className="work-process-row-caret work-process-aggregate-caret" aria-hidden="true" />
            <span className="work-process-tool-aggregate-text">{label(row.summary)}</span>
            {row.duration ? <span className="work-process-tool-inline-meta">{row.duration}</span> : null}
          </summary>
          <ul className="work-process-steps work-process-tool-aggregate-body">
            {row.children.map((child) => (
              <ToolRow key={child.id} row={child} extraDetail={renderToolDetail?.(child)} density={density} />
            ))}
          </ul>
        </details>
      </div>
    </li>
  );
};
