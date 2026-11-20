import { isTrackActivity } from './workProcessTrack';
import type { Translator } from '../../i18n/messages';
import type { WorkProcessRow } from './workProcessTypes';

type SectionRow = Extract<WorkProcessRow, { type: 'section' }>;

/** What a step leads with; the actions line is the only thing that folds. */
export type WorkProcessSectionLead = 'thinking' | 'thinking+commentary' | 'commentary' | 'actions';

export interface WorkProcessSectionModel {
  lead: WorkProcessSectionLead;
  /**
   * Thinking and every text item in display order. Text stays in this one list whatever its phase, so a
   * streamed item keeps its DOM node when the provider later declares it commentary or answer.
   */
  leadRows: WorkProcessRow[];
  /** Tools, delegations, task snapshots and interactions behind the actions line. */
  actionRows: WorkProcessRow[];
  /** "N actions · 3.2s", or "Working · N actions" while a step's actions run. */
  actionsLabel: string;
  running: boolean;
  hasError: boolean;
}

const isCommentary = (row: WorkProcessRow): boolean => row.type === 'output' && row.phase === 'commentary';

export function workProcessSectionModel(row: SectionRow, t: Translator): WorkProcessSectionModel {
  const leadRows = row.visibleSteps.filter(step => step.type === 'thinking' || step.type === 'output');
  const actionRows = row.visibleSteps.filter(step => step.type !== 'thinking' && step.type !== 'output');
  const thinking = leadRows.some(step => step.type === 'thinking');
  const commentary = leadRows.some(isCommentary);
  const lead: WorkProcessSectionLead = thinking && commentary ? 'thinking+commentary'
    : thinking ? 'thinking' : commentary ? 'commentary' : 'actions';
  const running = isTrackActivity(row);
  const actions = t(row.stepCount === 1 ? 'chat.workProcessActionOne' : 'chat.workProcessActions', { count: row.stepCount });
  const actionsLabel = running
    ? t('chat.workProcessSectionRunning', { actions })
    : row.duration ? t('chat.workProcessSectionDone', { actions, duration: row.duration }) : actions;
  const hasError = row.status === 'error' || row.steps.some(step => step.status === 'error');
  return { lead, leadRows, actionRows, actionsLabel, running, hasError };
}
