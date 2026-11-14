import type { WorkProcessRow } from './workProcessTypes';

export const hasTrackNarrative = (row: Extract<WorkProcessRow, { type: 'section' }>): boolean => (
  Boolean(row.proseText || row.thinkingLabel || row.thinkingExpandable)
);

/** The answer shares the ordered DOM with the process, but does not extend its track. */
export function isProcessTrackRow(row: WorkProcessRow): boolean {
  if (row.type === 'section') return hasTrackNarrative(row) || row.visibleSteps.some(isProcessTrackRow);
  return row.type !== 'output' || row.phase !== 'final_answer';
}

export function firstTrackEvent(rows: WorkProcessRow[]): string | undefined {
  return rows.find(isProcessTrackRow)?.id;
}

export function isTrackActivity(row: WorkProcessRow): boolean {
  if (row.type === 'section') return row.proseStreaming || row.thinkingStatus === 'streaming' || Boolean(row.hasActiveTools)
    || row.visibleSteps.some(isTrackActivity);
  if (row.type === 'tool') return row.status === 'running' && (!row.approval || row.approval.status === 'approved');
  if (row.type === 'output') return row.status === 'running';
  if (row.type === 'thinking') return row.thinkingStatus === 'streaming';
  if (row.type === 'subagent') return row.status === 'running';
  return false;
}
