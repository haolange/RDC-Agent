import type { ConversationThinkingStatus } from '@shared/types/conversation';
import type { WorkProcessRowStatus } from './workProcessTypes';

export const isActiveWorkProcessStatus = (status: WorkProcessRowStatus): boolean => (
  status === 'running' || status === 'pending'
);

export const isActiveThinkingStatus = (
  thinkingStatus: ConversationThinkingStatus | undefined,
  rowStatus: WorkProcessRowStatus,
): boolean => (
  thinkingStatus === 'streaming'
  || (thinkingStatus === undefined && isActiveWorkProcessStatus(rowStatus))
);
