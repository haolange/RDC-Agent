import type { DelegationTraceHeader } from '@shared/types/delegationTrace';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import type { TranslationKey } from '../../i18n/messages';
import type { WorkProcessRow } from './workProcessTypes';

export type SubagentWorkRow = Extract<WorkProcessRow, { type: 'subagent' }>;

/** A delegation's state: the child's own execution status when it runs in the background, else its trace or row. */
export function subagentStatus(row: SubagentWorkRow, header: DelegationTraceHeader | null): string {
  const executionStatus = header?.mode === 'background' ? header.executionStatus : undefined;
  const raw = executionStatus ?? header?.status ?? (row.status === 'error' ? 'failed'
    : row.status === 'complete' ? 'complete' : row.status === 'cancelled' || row.status === 'skipped' ? 'cancelled'
      : row.status === 'pending' ? 'queued' : 'running');
  return raw === 'completed' ? 'complete' : raw;
}

export const isActiveSubagentStatus = (status: string): boolean => (
  status === 'queued' || status === 'running' || status === 'waiting' || status === 'cancelling');

/** The child's steps read as a work trace of their own, so they render with the parent's Working components. */
export function subagentTraceStatus(status: string): ConversationWorkTrace['status'] {
  if (isActiveSubagentStatus(status)) return 'running';
  if (status === 'complete') return 'complete';
  return status === 'cancelled' || status === 'interrupted' || status === 'partial' || status === 'blocked' ? 'stopped' : 'error';
}

const STATUS_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  queued: 'chat.subagentQueued',
  waiting: 'chat.subagentWaiting',
  cancelling: 'chat.subagentCancelling',
  partial: 'chat.subagentPartial',
  blocked: 'chat.subagentBlocked',
  interrupted: 'chat.subagentInterrupted',
  cancelled: 'chat.subagentCancelled',
  complete: 'chat.subagentComplete',
  failed: 'chat.subagentFailed',
};

/** The status word on the card header; a running delegation says what a running row says. */
export function subagentStatusLabelKey(status: string): TranslationKey | null {
  return STATUS_LABEL_KEYS[status] ?? null;
}
