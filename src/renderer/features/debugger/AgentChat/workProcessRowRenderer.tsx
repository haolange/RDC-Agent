import React from 'react';
import type { WorkProcessRow } from './workProcessPresentation';
import { SubagentRow } from './SubagentRow';
import { TaskRow } from './TaskRow';
import {
  ApprovalRow,
  DiagnosticRow,
  SummaryRow,
  ToolRow,
  UserInputRow,
} from './WorkProcessRows';
import { WorkProcessReasoningIndicatorRow } from './WorkProcessReasoningIndicatorRow';
import { WorkProcessSectionRow } from './WorkProcessSectionRow';
import { ToolAggregateRow } from './ToolAggregateRow';

export function createWorkProcessRowRenderer() {
  const renderRow = (row: WorkProcessRow): React.ReactNode => {
    if (row.type === 'tool') return <ToolRow key={row.id} row={row} />;
    if (row.type === 'toolAggregate') return <ToolAggregateRow key={row.id} row={row} />;
    if (row.type === 'userInput') return <UserInputRow key={row.id} row={row} />;
    if (row.type === 'approval') return <ApprovalRow key={row.id} row={row} />;
    if (row.type === 'diagnostic') return <DiagnosticRow key={row.id} row={row} />;
    if (row.type === 'subagent') return <SubagentRow key={row.id} row={row} />;
    if (row.type === 'task') return <TaskRow key={row.id} row={row} />;
    if (row.type === 'reasoningIndicator') {
      return <WorkProcessReasoningIndicatorRow key={row.id} row={row} />;
    }
    if (row.type === 'section') {
      return (
        <WorkProcessSectionRow
          key={row.id}
          row={row}
          renderRow={renderRow}
        />
      );
    }
    return <SummaryRow key={row.id} row={row} />;
  };

  return renderRow;
}
