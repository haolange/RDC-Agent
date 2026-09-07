import type { ConversationWorkBlock } from '@shared/types/conversation';
import type { WorkProcessRowStatus } from './workProcessTypes';

export const isActiveWorkProcessStatus = (status: WorkProcessRowStatus): boolean => (
  status === 'running' || status === 'pending'
);

export const isActiveThinkingStatus = (
  thinkingStatus: ConversationWorkBlock['thinkingStatus'] | undefined,
  rowStatus: WorkProcessRowStatus,
): boolean => (
  thinkingStatus === 'streaming' || isActiveWorkProcessStatus(rowStatus)
);
