import type { ConversationMessage } from '@shared/types/conversation';
import { cancelWorkTrace } from '@shared/conversation/cancelWorkTrace';

export const stopWorkTrace = (message: ConversationMessage): ConversationMessage => {
  if (message.status !== 'draft' && message.status !== 'streaming') return message;
  return {
    ...message, status: 'stopped',
    // Keep the source revision so main's authoritative terminal message can replace it.
    updatedAt: message.updatedAt ?? message.createdAt,
    workTrace: message.workTrace ? cancelWorkTrace(message.workTrace, Date.now()) : message.workTrace,
  };
};
