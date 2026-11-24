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
