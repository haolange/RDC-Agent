import React, { useMemo } from 'react';
import type { AgentMode } from '@shared/types/layout';
import type { ConversationMessage } from '@shared/types/conversation';
import { useConversationStore } from '../../../stores/conversationStore';
import { EmptyWorkbenchPrompt } from '../../../patterns/EmptyWorkbenchPrompt';
import { MessageBubble } from './MessageBubble';

interface ConversationThreadProps {
  mode: AgentMode;
}

const sortByCreatedAt = (left: ConversationMessage, right: ConversationMessage): number => {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt;
  }
  const lUpdated = left.updatedAt ?? left.createdAt;
  const rUpdated = right.updatedAt ?? right.createdAt;
  return lUpdated - rUpdated;
};

export const ConversationThread: React.FC<ConversationThreadProps> = ({ mode }) => {
  const messages = useConversationStore((state) => state.conversationMessages);

  const orderedMessages = useMemo(
    () => messages.slice().sort(sortByCreatedAt),
    [messages],
  );

  if (orderedMessages.length === 0) {
    return (
      <div
        className="conversation-thread conversation-thread-empty"
        data-testid="conversation-thread"
      >
        <EmptyWorkbenchPrompt mode={mode} />
      </div>
    );
  }

  return (
    <ol
      className="conversation-thread"
      data-testid="conversation-thread"
      data-message-count={orderedMessages.length}
    >
      {orderedMessages.map((message) => (
        <li
          key={message.id}
          className="conversation-thread-item"
          data-message-role={message.role}
          data-message-status={message.status ?? 'complete'}
        >
          <MessageBubble message={message} />
        </li>
      ))}
    </ol>
  );
};

export default ConversationThread;
