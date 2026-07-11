import React from 'react';
import type { WorkProcessRow } from './workProcessPresentation';
import { useWorkProcessLabel } from './workProcessUseLabel';
import { ToolRow } from './WorkProcessRows';

type ToolAggregateRowModel = Extract<WorkProcessRow, { type: 'toolAggregate' }>;

export const ToolAggregateRow: React.FC<{ row: ToolAggregateRowModel }> = ({ row }) => {
  const label = useWorkProcessLabel();

  return (
    <li
      className={`work-process-step work-process-tool-aggregate status-${row.status}`}
      data-testid="work-process-tool-aggregate"
    >
      <div className="work-process-step-content work-process-tool-aggregate-content">
        <details className="work-process-tool-aggregate-details">
          <summary className="work-process-tool-aggregate-summary">
            <span className="work-process-row-caret work-process-aggregate-caret" aria-hidden="true" />
            <span className="work-process-tool-aggregate-text">{label(row.summary)}</span>
            {row.duration ? <span className="work-process-tool-inline-meta">{row.duration}</span> : null}
          </summary>
          <ul className="work-process-steps work-process-tool-aggregate-body">
            {row.children.map((child) => (
              <ToolRow key={child.id} row={child} />
            ))}
          </ul>
        </details>
      </div>
    </li>
  );
};
