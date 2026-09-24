import type { ConversationMessage, ConversationWorkBlock } from '@shared/types/conversation';

export function findToolCallMessage(messages: ConversationMessage[], scope: { projectId: string; sessionId: string; toolCallId: string }) {
  const includes = (blocks: ConversationWorkBlock[]): boolean => blocks.some((block) =>
    block.toolCalls.some((call) => call.id === scope.toolCallId));
  return messages.findIndex((message) => message.projectId === scope.projectId && message.sessionId === scope.sessionId
    && includes(message.workTrace?.blocks ?? []));
}
