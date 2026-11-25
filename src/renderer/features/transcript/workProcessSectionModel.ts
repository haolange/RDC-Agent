import type { WorkProcessRow } from './workProcessTypes';

/** Every action a step took, including Task changes that render as snapshots instead of tool rows. */
export function countWorkActions(rows: readonly WorkProcessRow[]): number {
  return rows.reduce((total, row) => {
    if (row.type === 'section') return total + countWorkActions(row.visibleSteps);
    if (row.type === 'tool') return total + (row.imageCalls?.length ?? 1);
    if (row.type === 'thinking' || row.type === 'output' || row.type === 'summary' || row.type === 'diagnostic') return total;
    return total + 1;
  }, 0);
}

/**
 * Actions that failed, counted the way countWorkActions counts them (each grouped image or page on its own). A declined
 * approval is a decision and a stopped action is cancelled; neither counts here.
 */
export function countFailedActions(rows: readonly WorkProcessRow[]): number {
  return rows.reduce((total, row) => {
    if (row.type === 'section') return total + countFailedActions(row.visibleSteps);
    if (row.type === 'tool') return total + (row.imageCalls ?? [row]).filter((call) => call.status === 'error').length;
    if (row.type === 'webGroup') return total + row.members.filter((member) => member.status === 'error').length;
    if (row.type === 'subagent' || row.type === 'userInput' || row.type === 'planReview') return total + (row.status === 'error' ? 1 : 0);
    return total;
  }, 0);
}
