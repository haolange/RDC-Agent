import React from 'react';
import type { WorkProcessRow } from './workProcessPresentation';
import { SubagentRow } from './SubagentRow';
import { TaskRow } from './TaskRow';
import {
  ApprovalRow,
  DiagnosticRow,
  SummaryRow,
  ToolGroupRow,
  ToolRow,
  UserInputRow,
} from './WorkProcessRows';
import { ResponseRow } from './WorkProcessResponseRow';
import { WorkProcessReasoningIndicatorRow } from './WorkProcessReasoningIndicatorRow';
import { WorkProcessSectionRow } from './WorkProcessSectionRow';

export function createWorkProcessRowRenderer(showLoopMeta: boolean) {
  const renderRow = (row: WorkProcessRow): React.ReactNode => {
    if (row.type === 'toolGroup') return <ToolGroupRow key={row.id} row={row} renderRow={renderRow} />;
    if (row.type === 'tool') return <ToolRow key={row.id} row={row} />;
    if (row.type === 'userInput') return <UserInputRow key={row.id} row={row} />;
    if (row.type === 'approval') return <ApprovalRow key={row.id} row={row} />;
    if (row.type === 'diagnostic') return <DiagnosticRow key={row.id} row={row} />;
    if (row.type === 'subagent') return <SubagentRow key={row.id} row={row} />;
    if (row.type === 'task') return <TaskRow key={row.id} row={row} />;
    if (row.type === 'response') return <ResponseRow key={row.id} row={row} />;
    if (row.type === 'reasoningIndicator') {
      return <WorkProcessReasoningIndicatorRow key={row.id} row={row} />;
    }
    if (row.type === 'section') {
      return (
        <WorkProcessSectionRow
          key={row.id}
          row={row}
          showLoopMeta={showLoopMeta}
          renderRow={renderRow}
        />
      );
    }
    return <SummaryRow key={row.id} row={row} />;
  };

  return renderRow;
}
