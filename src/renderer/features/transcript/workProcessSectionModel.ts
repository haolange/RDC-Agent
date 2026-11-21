import type { WorkProcessRow } from './workProcessTypes';

type SectionRow = Extract<WorkProcessRow, { type: 'section' }>;

/** What a step leads with. */
export type WorkProcessSectionLead = 'thinking' | 'thinking+commentary' | 'commentary' | 'actions';

export interface WorkProcessSectionModel {
  lead: WorkProcessSectionLead;
  /**
   * Thinking and every text item in display order. Text stays in this one list whatever its phase, so a
   * streamed item keeps its DOM node when the provider later declares it commentary or answer.
   */
  leadRows: WorkProcessRow[];
  /** Tools, delegations, task snapshots and interactions, in the order they happened. */
  actionRows: WorkProcessRow[];
}

const isCommentary = (row: WorkProcessRow): boolean => row.type === 'output' && row.phase === 'commentary';

/** Every action a step took, including Task changes that render as snapshots instead of tool rows. */
export function countWorkActions(rows: readonly WorkProcessRow[]): number {
  return rows.reduce((total, row) => {
    if (row.type === 'section') return total + countWorkActions(row.visibleSteps);
    if (row.type === 'toolAggregate') return total + row.children.length;
    if (row.type === 'tool') return total + (row.imageCalls?.length ?? 1);
    if (row.type === 'thinking' || row.type === 'output' || row.type === 'summary' || row.type === 'diagnostic') return total;
    return total + 1;
  }, 0);
}

export function workProcessSectionModel(row: SectionRow): WorkProcessSectionModel {
  const leadRows = row.visibleSteps.filter(step => step.type === 'thinking' || step.type === 'output');
  const actionRows = row.visibleSteps.filter(step => step.type !== 'thinking' && step.type !== 'output');
  const thinking = leadRows.some(step => step.type === 'thinking');
  const commentary = leadRows.some(isCommentary);
  const lead: WorkProcessSectionLead = thinking && commentary ? 'thinking+commentary'
    : thinking ? 'thinking' : commentary ? 'commentary' : 'actions';
  return { lead, leadRows, actionRows };
}
