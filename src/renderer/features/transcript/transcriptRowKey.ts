import type { ConversationMessage } from '@shared/types/conversation';

/**
 * The identity a transcript row keeps for its whole life. A request's optimistic user and assistant placeholders and
 * the messages main returns for them share the request id and role, so each row (its DOM, measured height and
 * disclosure memory) carries over when main's message replaces the placeholder. Every other message is its own id.
 */
export const transcriptRowKey = (message: Pick<ConversationMessage, 'id'> & Partial<Pick<ConversationMessage, 'requestId' | 'role'>>): string =>
  message.requestId && (message.role === 'user' || message.role === 'assistant')
    ? `request:${message.requestId}:${message.role}`
    : message.id;
