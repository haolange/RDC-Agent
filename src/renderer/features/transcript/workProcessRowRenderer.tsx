import React from 'react';
import type { WorkProcessRow } from './workProcessTypes';
import { SubagentRow } from './SubagentRow';
import { TaskSnapshotCard } from './TaskSnapshotCard';
import {
  ApprovalRow,
  DiagnosticRow,
  SummaryRow,
  ToolRow,
  PlanReviewRow,
  UserInputRow,
} from './WorkProcessRows';
import { WorkProcessSectionRow } from './WorkProcessSectionRow';
import { ToolAggregateRow } from './ToolAggregateRow';

export function createWorkProcessRowRenderer() {
  const renderRow = (row: WorkProcessRow): React.ReactNode => {
    if (row.type === 'tool') return <ToolRow key={row.id} row={row} />;
    if (row.type === 'toolAggregate') return <ToolAggregateRow key={row.id} row={row} />;
    if (row.type === 'userInput') return <UserInputRow key={row.id} row={row} />;
    if (row.type === 'planReview') return <PlanReviewRow key={row.id} row={row} />;
    if (row.type === 'approval') return <ApprovalRow key={row.id} row={row} />;
    if (row.type === 'diagnostic') return <DiagnosticRow key={row.id} row={row} />;
    if (row.type === 'subagent') return <SubagentRow key={row.id} row={row} />;
    if (row.type === 'taskSnapshot') return <TaskSnapshotCard key={row.id} row={row} />;
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
