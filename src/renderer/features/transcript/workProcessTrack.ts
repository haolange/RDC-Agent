import type { WorkProcessRow } from './workProcessTypes';

export const hasTrackNarrative = (row: Extract<WorkProcessRow, { type: 'section' }>): boolean => (
  Boolean(row.proseText || row.thinkingLabel || row.thinkingExpandable)
);

/** Model turns remain intact; only user-visible entries receive structural nodes. */
export function firstTrackEvent(rows: WorkProcessRow[]): string | undefined {
  for (const row of rows) {
    if (row.type !== 'section' || hasTrackNarrative(row)) return row.id;
    const child = firstTrackEvent(row.visibleSteps);
    if (child) return child;
  }
  return undefined;
}

export function isTrackActivity(row: WorkProcessRow): boolean {
  if (row.type === 'section') return row.proseStreaming || row.thinkingStatus === 'streaming';
  if (row.type === 'tool') return row.status === 'running' && (!row.approval || row.approval.status === 'approved');
  if (row.type === 'subagent') return row.status === 'running';
  return false;
}

export const runningToolCount = (rows: Extract<WorkProcessRow, { type: 'tool' }>[]): number => rows.filter(isTrackActivity).length;
