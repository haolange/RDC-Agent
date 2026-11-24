import React from 'react';
import { SubagentRow } from './SubagentRow';
import { TaskSnapshotCard } from './TaskSnapshotCard';
import {
  ApprovalRow,
  DiagnosticRow,
  PlanReviewRow,
  SummaryRow,
  ToolRow,
  UserInputRow,
} from './WorkProcessRows';
import { WorkProcessSectionRow } from './WorkProcessSectionRow';
import { WorkProcessImageRow } from './WorkProcessImageRow';
import { WorkProcessOutputRow } from './WorkProcessOutputRow';
import { WorkProcessThinkingRow } from './WorkProcessThinking';
import { WebGroupRow } from './WorkProcessWebParts';
import type { WorkProcessRow } from './workProcessTypes';

export function createWorkProcessRowRenderer(
  sessionId?: string | null,
  renderToolDetail?: (row: Extract<WorkProcessRow, { type: 'tool' }>) => React.ReactNode,
  density: 'normal' | 'compact' = 'normal',
) {
  const renderRow = (row: WorkProcessRow): React.ReactNode => {
    if (row.type === 'thinking') return <WorkProcessThinkingRow key={row.id} row={row} />;
    if (row.type === 'output') return <WorkProcessOutputRow key={row.id} row={row} />;
    if (row.type === 'tool' && row.imageCalls) return <WorkProcessImageRow key={row.id} row={row} renderToolDetail={renderToolDetail} />;
    if (row.type === 'tool') return <ToolRow key={row.id} row={row} extraDetail={renderToolDetail?.(row)} density={density} />;
    // Each member of a read group keeps its own card, receipt included, behind the group's disclosure.
    if (row.type === 'webGroup') {
      return <WebGroupRow key={row.id} row={row} renderMember={(member) => (
        <ToolRow key={member.id} row={member} extraDetail={renderToolDetail?.(member)} density="compact" grouped />
      )} />;
    }
    if (row.type === 'userInput') return <UserInputRow key={row.id} row={row} />;
    if (row.type === 'planReview') return <PlanReviewRow key={row.id} row={row} />;
    if (row.type === 'approval') return <ApprovalRow key={row.id} row={row} />;
    if (row.type === 'diagnostic') return <DiagnosticRow key={row.id} row={row} density={density} />;
    if (row.type === 'subagent') return <SubagentRow key={row.id} row={row} sessionId={sessionId} />;
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
