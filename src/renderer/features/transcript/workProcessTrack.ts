import type { WorkProcessRow } from './workProcessTypes';

/** The answer shares the ordered DOM with the process, but does not extend its track. */
export function isProcessTrackRow(row: WorkProcessRow): boolean {
  if (row.type === 'section') return row.stepCount > 0 || row.visibleSteps.some(isProcessTrackRow);
  return row.type !== 'output' || row.phase !== 'final_answer';
}

export function firstTrackEvent(rows: WorkProcessRow[]): string | undefined {
  return rows.find(isProcessTrackRow)?.id;
}

export function isTrackActivity(row: WorkProcessRow): boolean {
  if (row.type === 'section') return Boolean(row.hasActiveTools) || row.visibleSteps.some(isTrackActivity);
  // A plan under review and an unapproved call are waiting on the user, not executing.
  if (row.type === 'tool') return row.status === 'running' && !row.planReview && (!row.approval || row.approval.status === 'approved');
  if (row.type === 'output') return row.status === 'running';
  if (row.type === 'thinking') return row.thinkingStatus === 'streaming';
  if (row.type === 'subagent') return row.status === 'running';
  if (row.type === 'webGroup') return row.members.some(isTrackActivity);
  return false;
}
