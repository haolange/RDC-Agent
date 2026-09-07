import type { ConversationMessage } from '@shared/types/conversation';

export const stopWorkTrace = (message: ConversationMessage): ConversationMessage => {
  const stoppedAt = Date.now();
  if (!message.workTrace) {
    return {
      ...message,
      status: 'stopped',
      updatedAt: stoppedAt,
    };
  }

  return {
    ...message,
    status: 'stopped',
    updatedAt: stoppedAt,
    workTrace: {
      ...message.workTrace,
      status: 'stopped',
      summary: message.workTrace.summary || 'Request stopped.',
      updatedAt: stoppedAt,
      blocks: (message.workTrace.blocks ?? []).map((block) => (
        block.status === 'running'
          ? { ...block, status: 'complete', completedAt: stoppedAt }
          : block
      )),
    },
  };
};
