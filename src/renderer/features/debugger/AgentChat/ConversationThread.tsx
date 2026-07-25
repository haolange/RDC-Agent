import React, { useCallback } from 'react';
import type { AgentMode } from '@shared/types/layout';
import type { ConversationMessage } from '@shared/types/conversation';
import {
  selectOrderedConversationMessages,
  useConversationStore,
} from '../../../stores/conversationStore';
import { EmptyWorkbenchPrompt } from '../../../patterns/EmptyWorkbenchPrompt';
import { VirtualMessageList } from '../VirtualMessageList';
import { MessageBubble } from './MessageBubble';

interface ConversationThreadProps {
  mode: AgentMode;
}

export const ConversationThread: React.FC<ConversationThreadProps> = ({ mode }) => {
  // Write-side sort already applied in conversationStore; selector stays shallow-stable.
  const orderedMessages = useConversationStore(selectOrderedConversationMessages);

  const renderMessage = useCallback(
    (message: ConversationMessage) => <MessageBubble message={message} />,
    [],
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
    <VirtualMessageList
      messages={orderedMessages}
      renderMessage={renderMessage}
      className="conversation-thread"
      data-testid="conversation-thread"
    />
  );
};

export default ConversationThread;
